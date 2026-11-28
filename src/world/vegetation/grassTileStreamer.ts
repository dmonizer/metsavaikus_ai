import * as THREE from 'three';
import {
  buildDeterministicShuffle,
  createTileSampleBuffer,
  computeGrassClumpScale,
  computeMossCarpetScale,
  computeOpennessFactor,
  computeRoadVergeCoverage,
  computeRoadVergeFillerCoverage,
  computeShortGrassScale,
  computeTallUndergrowthScale,
  fillTileSamples,
  shouldKeepMossCarpet,
  shouldKeepTallUndergrowth,
} from '../grassScatter';
import { ShelterGeometry, containsFootprint } from '../shelterGeometry';
import {
  SWAMP_WATER_Y,
  WORLD_HALF,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getStreamSampleAt,
  getTerrainHeight,
  getWaterSurfaceAt,
  sampleTerrainSurface,
  smoothNoise,
} from '../terrainMath';
import {
  BakedSlab,
  EMPTY_GRASS_TILE,
  EMPTY_SLAB,
  GRASS_TILE_SAMPLES,
  GRASS_TILE_SIZE,
  GrassTileBaked,
  MOSS_TILE_SAMPLES,
  SHORT_GRASS_TILE_SAMPLES,
  TALL_TILE_SAMPLES,
} from './vegetationTypes';

const _bakeDummy = new THREE.Object3D();
const _upVec = new THREE.Vector3(0, 1, 0);
const _tmpQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _slopeNormal = new THREE.Vector3();

// The baker runs synchronously. Only shuffled, independently owned slabs leave it.
function createLayerScratch(count: number) {
  return {
    points: createTileSampleBuffer(count),
    matrices: new Float32Array(count * 16),
    colors: new Float32Array(count * 3),
  };
}

const bladeScratch = createLayerScratch(GRASS_TILE_SAMPLES);
const shortScratch = createLayerScratch(SHORT_GRASS_TILE_SAMPLES);
const mossScratch = createLayerScratch(MOSS_TILE_SAMPLES);
const tallScratch = createLayerScratch(TALL_TILE_SAMPLES);

export function bakeGrassTile(
  tx: number,
  tz: number,
  shelters: ShelterGeometry
): GrassTileBaked {
  const minX = tx * GRASS_TILE_SIZE;
  const minZ = tz * GRASS_TILE_SIZE;
  const maxX = minX + GRASS_TILE_SIZE;
  const maxZ = minZ + GRASS_TILE_SIZE;
  const minWorld = -WORLD_HALF + 2;
  const maxWorld = WORLD_HALF - 2;
  if (maxX < minWorld || minX > maxWorld || maxZ < minWorld || minZ > maxWorld) {
    return EMPTY_GRASS_TILE;
  }

  const tileCx = minX + GRASS_TILE_SIZE * 0.5;
  const tileCz = minZ + GRASS_TILE_SIZE * 0.5;
  const localBuildings = shelters.footprints.filter((area) => {
    if (area.temporary) return false;
    const reach = Math.hypot(area.halfW, area.halfD) + GRASS_TILE_SIZE * 0.72 + 1.2;
    return Math.hypot(tileCx - area.x, tileCz - area.z) <= reach;
  });

  const bp = getActiveBlueprint();
  const randSeed = bp.seed | 0;
  const tileOverlapsStreams = bp.streams.some(
    (st) => maxX >= st.minX && minX <= st.maxX && maxZ >= st.minZ && minZ <= st.maxZ
  );
  const tileOverlapsFreshwater =
    tileOverlapsStreams ||
    bp.lakes.some((lk) => maxX >= lk.minX && minX <= lk.maxX && maxZ >= lk.minZ && minZ <= lk.maxZ);
  const tileCenterVillage = getDistanceToNearestVillage(tileCx, tileCz, bp);
  const tileNearVillage = tileCenterVillage.dist < tileCenterVillage.clearingRadius + 36;
  fillTileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, 13, bladeScratch.points);
  fillTileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, 41, shortScratch.points);
  fillTileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, 73, mossScratch.points);
  fillTileSamples(tx, tz, randSeed, GRASS_TILE_SIZE, 97, tallScratch.points);

  const rawMat = bladeScratch.matrices;
  const rawCol = bladeScratch.colors;
  let grassCount = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  const grassSamples = bladeScratch.points;
  for (let i = 0; i < grassSamples.lx.length; i++) {
    const px = minX + grassSamples.lx[i];
    const pz = minZ + grassSamples.lz[i];
    const r1 = grassSamples.r1[i];
    const r2 = grassSamples.r2[i];
    const r3 = grassSamples.r3[i];
    const r4 = grassSamples.r4[i];
    if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
    if (localBuildings.some((area) => containsFootprint(area, px, pz, 1.2))) continue;

    const roadInfo = distToRoadDetail(px, pz, bp);
    const vergeJitter =
      (smoothNoise(px * 0.42, pz * 0.42) * 0.65 + smoothNoise(px * 1.15, pz * 1.15) * 0.35) * 2 - 1;
    const verge = computeRoadVergeCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, r4, false);
    if (!verge.keep) continue;

    const surf = sampleTerrainSurface(px, pz, bp);
    const py = surf.y;
    if (py < SWAMP_WATER_Y + 0.12) continue;
    if (tileOverlapsFreshwater && getWaterSurfaceAt(px, pz, bp, py).hasWater) continue;
    if (tileOverlapsStreams) {
      const st = getStreamSampleAt(px, pz, bp);
      if (st && st.dist < st.halfWidth + 0.30) continue;
    }

    if (py < minY) minY = py;
    if (py > maxY) maxY = py;

    const islandMask = surf.islandMask;
    const swamp = islandMask > 0.35 ? 0 : surf.swamp;
    const nearVillage = tileNearVillage ? getDistanceToNearestVillage(px, pz, bp) : tileCenterVillage;
    const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
    const openness = computeOpennessFactor(
      nearVillage.dist,
      nearVillage.clearingRadius,
      roadInfo.dist,
      roadInfo.isTrail,
      swamp,
      islandMask,
      gladeNoise
    );
    const patchNoise = smoothNoise(px * 0.11, pz * 0.11);
    const { sxz, sy } = computeGrassClumpScale(
      swamp,
      patchNoise,
      r1,
      r2,
      r3,
      verge.heightScale,
      openness
    );

    _bakeDummy.position.set(px, py - 0.03, pz);
    _bakeDummy.rotation.set((r4 - 0.5) * 0.24, r1 * Math.PI * 2, (r2 - 0.5) * 0.24);
    _bakeDummy.scale.set(sxz, sy, sxz);
    _bakeDummy.updateMatrix();
    _bakeDummy.matrix.toArray(rawMat, grassCount * 16);

    const cOff = grassCount * 3;
    const tone = 0.74 + r2 * 0.34;
    if (swamp > 0.35) {
      rawCol[cOff] = tone * (0.98 + r4 * 0.12);
      rawCol[cOff + 1] = tone * (0.84 + r3 * 0.1);
      rawCol[cOff + 2] = tone * 0.5;
    } else {
      rawCol[cOff] = tone * (0.78 + r1 * 0.2);
      rawCol[cOff + 1] = tone * (0.9 + r3 * 0.18);
      rawCol[cOff + 2] = tone * (0.58 + r4 * 0.12);
    }
    grassCount++;
  }

  const rawShortMat = shortScratch.matrices;
  const rawShortCol = shortScratch.colors;
  let shortCount = 0;

  const shortSamples = shortScratch.points;
  for (let i = 0; i < shortSamples.lx.length; i++) {
    const px = minX + shortSamples.lx[i];
    const pz = minZ + shortSamples.lz[i];
    const r1 = shortSamples.r1[i];
    const r2 = shortSamples.r2[i];
    const r3 = shortSamples.r3[i];
    const r4 = shortSamples.r4[i];
    if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
    if (localBuildings.some((area) => containsFootprint(area, px, pz, 1.1))) continue;

    const roadInfo = distToRoadDetail(px, pz, bp);
    const vergeJitter =
      (smoothNoise(px * 0.45 + 3.1, pz * 0.45 - 2.4) * 0.65 +
        smoothNoise(px * 1.25 - 1.7, pz * 1.25 + 4.2) * 0.35) *
        2 -
      1;
    const verge = computeRoadVergeFillerCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, r4);
    if (!verge.keep) continue;

    const surf = sampleTerrainSurface(px, pz, bp);
    const py = surf.y;
    if (py < SWAMP_WATER_Y + 0.1) continue;
    if (tileOverlapsFreshwater && getWaterSurfaceAt(px, pz, bp, py).hasWater) continue;
    if (tileOverlapsStreams) {
      const st = getStreamSampleAt(px, pz, bp);
      if (st && st.dist < st.halfWidth + 0.18) continue;
    }

    if (py < minY) minY = py;
    if (py > maxY) maxY = py;

    const islandMask = surf.islandMask;
    const swamp = islandMask > 0.35 ? 0 : surf.swamp;
    const nearVillage = tileNearVillage ? getDistanceToNearestVillage(px, pz, bp) : tileCenterVillage;
    const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
    const openness = computeOpennessFactor(
      nearVillage.dist,
      nearVillage.clearingRadius,
      roadInfo.dist,
      roadInfo.isTrail,
      swamp,
      islandMask,
      gladeNoise
    );
    const patchNoise = smoothNoise(px * 0.14 + 4.7, pz * 0.14 - 3.3);
    const { sxz, sy } = computeShortGrassScale(
      swamp,
      patchNoise,
      r1,
      r2,
      r3,
      verge.heightScale,
      openness
    );

    _bakeDummy.position.set(px, py - 0.02, pz);
    _bakeDummy.rotation.set((r4 - 0.5) * 0.22, r1 * Math.PI * 2, (r2 - 0.5) * 0.22);
    _bakeDummy.scale.set(sxz, sy, sxz);
    _bakeDummy.updateMatrix();
    _bakeDummy.matrix.toArray(rawShortMat, shortCount * 16);

    const cOff = shortCount * 3;
    const tone = 0.72 + r2 * 0.32;
    if (swamp > 0.35) {
      rawShortCol[cOff] = tone * (0.94 + r4 * 0.12);
      rawShortCol[cOff + 1] = tone * (0.86 + r3 * 0.1);
      rawShortCol[cOff + 2] = tone * 0.52;
    } else {
      rawShortCol[cOff] = tone * (0.76 + r1 * 0.18);
      rawShortCol[cOff + 1] = tone * (0.92 + r3 * 0.16);
      rawShortCol[cOff + 2] = tone * (0.56 + r4 * 0.12);
    }
    shortCount++;
  }

  const rawMossMat = mossScratch.matrices;
  const rawMossCol = mossScratch.colors;
  let mossCount = 0;

  const mossSamples = mossScratch.points;
  for (let i = 0; i < mossSamples.lx.length; i++) {
    const px = minX + mossSamples.lx[i];
    const pz = minZ + mossSamples.lz[i];
    const r1 = mossSamples.r1[i];
    const r2 = mossSamples.r2[i];
    const r3 = mossSamples.r3[i];
    const r4 = mossSamples.r4[i];
    if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
    if (localBuildings.some((area) => containsFootprint(area, px, pz, 1.1))) continue;

    const roadInfo = distToRoadDetail(px, pz, bp);
    const vergeJitter =
      (smoothNoise(px * 0.4 - 6.2, pz * 0.4 + 2.1) * 0.65 +
        smoothNoise(px * 1.1 + 3.8, pz * 1.1 - 5.1) * 0.35) *
        2 -
      1;
    const verge = computeRoadVergeFillerCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, r4);
    if (!verge.keep) continue;

    const surf = sampleTerrainSurface(px, pz, bp);
    const py = surf.y;
    if (py < SWAMP_WATER_Y + 0.08) continue;
    if (tileOverlapsFreshwater && getWaterSurfaceAt(px, pz, bp, py).hasWater) continue;
    if (tileOverlapsStreams) {
      const st = getStreamSampleAt(px, pz, bp);
      if (st && st.dist < st.halfWidth + 0.65) continue;
    }

    const islandMask = surf.islandMask;
    const swamp = islandMask > 0.35 ? 0 : surf.swamp;
    const nearVillage = tileNearVillage ? getDistanceToNearestVillage(px, pz, bp) : tileCenterVillage;
    const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
    const openness = computeOpennessFactor(
      nearVillage.dist,
      nearVillage.clearingRadius,
      roadInfo.dist,
      roadInfo.isTrail,
      swamp,
      islandMask,
      gladeNoise
    );

    const mossNoise =
      smoothNoise(px * 0.13 + 11.4, pz * 0.13 - 8.2) * 0.64 +
      smoothNoise(px * 0.34 - 4.5, pz * 0.34 + 6.7) * 0.36;
    if (!shouldKeepMossCarpet(openness, mossNoise, swamp, r1, r4)) continue;

    if (py < minY) minY = py;
    if (py > maxY) maxY = py;

    const { sxz, sy } = computeMossCarpetScale(
      swamp,
      mossNoise,
      r1,
      r2,
      r3,
      verge.heightScale,
      openness
    );
    const slopeX = (getTerrainHeight(px - 0.35, pz) - getTerrainHeight(px + 0.35, pz)) / 0.7;
    const slopeZ = (getTerrainHeight(px, pz - 0.35) - getTerrainHeight(px, pz + 0.35)) / 0.7;
    _slopeNormal
      .set(Math.max(-0.48, Math.min(0.48, slopeX)), 1, Math.max(-0.48, Math.min(0.48, slopeZ)))
      .normalize();
    _tmpQuat.setFromUnitVectors(_upVec, _slopeNormal);
    _yawQuat.setFromAxisAngle(_upVec, r1 * Math.PI * 2);

    _bakeDummy.position.set(px, py - 0.028, pz);
    _bakeDummy.quaternion.copy(_tmpQuat).multiply(_yawQuat);
    _bakeDummy.scale.set(sxz, sy, sxz * (0.86 + r3 * 0.28));
    _bakeDummy.updateMatrix();
    _bakeDummy.matrix.toArray(rawMossMat, mossCount * 16);

    const cOff = mossCount * 3;
    const tone = 0.78 + r2 * 0.3;
    if (swamp > 0.32) {
      rawMossCol[cOff] = tone * (0.98 + r3 * 0.16);
      rawMossCol[cOff + 1] = tone * (0.92 + r1 * 0.12);
      rawMossCol[cOff + 2] = tone * (0.54 + r4 * 0.1);
    } else {
      rawMossCol[cOff] = tone * (0.78 + r3 * 0.22);
      rawMossCol[cOff + 1] = tone * (0.96 + r1 * 0.16);
      rawMossCol[cOff + 2] = tone * (0.54 + r4 * 0.14);
    }
    mossCount++;
  }

  const rawTallMat = tallScratch.matrices;
  const rawTallCol = tallScratch.colors;
  let tallCount = 0;

  const tallSamples = tallScratch.points;
  for (let i = 0; i < tallSamples.lx.length; i++) {
    const px = minX + tallSamples.lx[i];
    const pz = minZ + tallSamples.lz[i];
    const r1 = tallSamples.r1[i];
    const r2 = tallSamples.r2[i];
    const r3 = tallSamples.r3[i];
    const r4 = tallSamples.r4[i];
    if (px < minWorld || px > maxWorld || pz < minWorld || pz > maxWorld) continue;
    if (localBuildings.some((area) => containsFootprint(area, px, pz, 1.35))) continue;

    const roadInfo = distToRoadDetail(px, pz, bp);
    const vergeJitter =
      (smoothNoise(px * 0.38, pz * 0.38) * 0.65 + smoothNoise(px * 1.05, pz * 1.05) * 0.35) * 2 - 1;
    const verge = computeRoadVergeCoverage(roadInfo.dist, roadInfo.isTrail, vergeJitter, r4, true);
    if (!verge.keep) continue;

    const surf = sampleTerrainSurface(px, pz, bp);
    const py = surf.y;
    if (py < SWAMP_WATER_Y + 0.16) continue;
    if (tileOverlapsFreshwater && getWaterSurfaceAt(px, pz, bp, py).hasWater) continue;
    if (tileOverlapsStreams) {
      const st = getStreamSampleAt(px, pz, bp);
      if (st && st.dist < st.halfWidth + 0.45) continue;
    }

    const islandMask = surf.islandMask;
    const swamp = islandMask > 0.35 ? 0 : surf.swamp;
    if (swamp > 0.42) continue;

    const nearVillage = tileNearVillage ? getDistanceToNearestVillage(px, pz, bp) : tileCenterVillage;
    const gladeNoise = smoothNoise(px * 0.045 - 5.3, pz * 0.045 + 3.7);
    const openness = computeOpennessFactor(
      nearVillage.dist,
      nearVillage.clearingRadius,
      roadInfo.dist,
      roadInfo.isTrail,
      swamp,
      islandMask,
      gladeNoise
    );

    const driftNoise =
      smoothNoise(px * 0.095 + 7.2, pz * 0.095 - 4.1) * 0.62 +
      smoothNoise(px * 0.25 - 2.5, pz * 0.25 + 9.4) * 0.38;
    if (!shouldKeepTallUndergrowth(openness, driftNoise, r1, r4)) continue;
    if (roadInfo.dist < 4.6 && r2 > 0.48) continue;

    if (py < minY) minY = py;
    if (py > maxY) maxY = py;

    const { sxz, sy } = computeTallUndergrowthScale(
      driftNoise,
      r1,
      r2,
      r3,
      verge.heightScale,
      openness
    );
    _bakeDummy.position.set(px, py - 0.035, pz);
    _bakeDummy.rotation.set((r4 - 0.5) * 0.22, r2 * Math.PI * 2, (r3 - 0.5) * 0.22);
    _bakeDummy.scale.set(sxz, sy, sxz);
    _bakeDummy.updateMatrix();
    _bakeDummy.matrix.toArray(rawTallMat, tallCount * 16);

    const cOff = tallCount * 3;
    const tone = 0.76 + r3 * 0.32;
    const goldenShift = r4 > 0.72 ? 0.12 : 0;
    rawTallCol[cOff] = tone * (0.82 + r1 * 0.16 + goldenShift);
    rawTallCol[cOff + 1] = tone * (0.92 + r2 * 0.14);
    rawTallCol[cOff + 2] = tone * (0.56 + r4 * 0.1);
    tallCount++;
  }

  if (grassCount === 0 && shortCount === 0 && mossCount === 0 && tallCount === 0) {
    return EMPTY_GRASS_TILE;
  }

  const shuffleSeed = (tx * 73856093) ^ (tz * 19349663) ^ randSeed;
  const packShuffled = (
    matSrc: Float32Array,
    colSrc: Float32Array,
    count: number,
    seedOffset: number
  ): BakedSlab => {
    if (count === 0) return EMPTY_SLAB;
    const order = buildDeterministicShuffle(count, shuffleSeed + seedOffset);
    const matrices = new Float32Array(count * 16);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const srcIdx = order[i];
      const sM = srcIdx * 16;
      const dM = i * 16;
      for (let k = 0; k < 16; k++) matrices[dM + k] = matSrc[sM + k];
      const sC = srcIdx * 3;
      const dC = i * 3;
      colors[dC] = colSrc[sC];
      colors[dC + 1] = colSrc[sC + 1];
      colors[dC + 2] = colSrc[sC + 2];
    }
    return { count, matrices, colors, bounds: new Float32Array(0) };
  };

  const cy = (minY + maxY) * 0.5 + 0.45;
  const halfY = (maxY - minY) * 0.5 + 1.25;
  const halfXZ = GRASS_TILE_SIZE * 0.5 + 0.8;
  return {
    slab: packShuffled(rawMat, rawCol, grassCount, 1),
    shortSlab: packShuffled(rawShortMat, rawShortCol, shortCount, 3),
    mossSlab: packShuffled(rawMossMat, rawMossCol, mossCount, 5),
    tallSlab: packShuffled(rawTallMat, rawTallCol, tallCount, 2),
    cx: tileCx,
    cy,
    cz: tileCz,
    r: Math.hypot(halfXZ, halfY, halfXZ),
  };
}

export function appendShuffledSlab(
  slab: BakedSlab,
  dstMat: Float32Array,
  dstCol: Float32Array,
  curCount: number,
  cap: number,
  ring: number,
  step: number,
  camX: number,
  camZ: number,
  camForward?: THREE.Vector3
): number {
  if (slab.count === 0) return curCount;
  const avail = cap - curCount;
  if (avail <= 0) return curCount;

  // Ring 0 (0-16m): full shuffled density, culling only clumps >2.2m behind camera
  if (ring === 0 && camForward) {
    const fx = camForward.x;
    const fz = camForward.z;
    const srcM = slab.matrices;
    const srcC = slab.colors;
    let outCount = curCount;
    for (let i = 0; i < slab.count && outCount < cap; i++) {
      const mOff = i * 16;
      const gx = srcM[mOff + 12] - camX;
      const gz = srcM[mOff + 14] - camZ;
      if (gx * fx + gz * fz < -1.8 && gx * gx + gz * gz > 4.84) continue;
      const dstM = outCount * 16;
      for (let k = 0; k < 16; k++) dstMat[dstM + k] = srcM[mOff + k];
      const cOff = i * 3;
      const dstC = outCount * 3;
      dstCol[dstC] = srcC[cOff];
      dstCol[dstC + 1] = srcC[cOff + 1];
      dstCol[dstC + 2] = srcC[cOff + 2];
      outCount++;
    }
    return outCount;
  }

  // Pre-shuffled slab: taking floor(count / step) contiguous entries yields 100% stripe-free 2D random thinning
  const desired = step > 1 ? Math.max(1, Math.floor(slab.count / step)) : slab.count;
  const take = desired <= avail ? desired : avail;
  dstMat.set(take === slab.count ? slab.matrices : slab.matrices.subarray(0, take * 16), curCount * 16);
  dstCol.set(take === slab.count ? slab.colors : slab.colors.subarray(0, take * 3), curCount * 3);
  return curCount + take;
}

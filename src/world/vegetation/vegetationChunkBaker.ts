import * as THREE from 'three';
import type { CircleCollider } from '../architectureAndProps';
import { classifySpruceGrowthForm } from '../botanicalGeometry';
import { computeOpennessFactor } from '../grassScatter';
import {
  CHUNK_SIZE,
  SWAMP_WATER_Y,
  WORLD_HALF,
  distToRoadDetail,
  getActiveBlueprint,
  getDistanceToNearestVillage,
  getNearestSwampIsland,
  getSwampFactor,
  getTerrainHeight,
  getThicketFactor,
  isDryLandForPlanting,
  smoothNoise,
} from '../terrainMath';
import {
  BakedSlab,
  ChunkBucketBaked,
  DeadfallLogTarget,
  EMPTY_SLAB,
  InstanceRecord,
  SubCellBaked,
  hashChunkSeed,
  seededRand,
} from './vegetationTypes';

const _bakeDummy = new THREE.Object3D();

export function bakeRecords(
  records: InstanceRecord[],
  centerYOffset: number,
  boundRadius: number
): BakedSlab {
  const n = records.length;
  if (n === 0) return EMPTY_SLAB;
  const matrices = new Float32Array(n * 16);
  const colors = new Float32Array(n * 3);
  const bounds = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const rec = records[i];
    _bakeDummy.position.set(rec.x, rec.y, rec.z);
    _bakeDummy.rotation.set(0, rec.rotY, 0);
    _bakeDummy.scale.setScalar(rec.scale);
    _bakeDummy.updateMatrix();
    _bakeDummy.matrix.toArray(matrices, i * 16);
    colors[i * 3] = rec.r;
    colors[i * 3 + 1] = rec.g;
    colors[i * 3 + 2] = rec.b;
    const bOff = i * 4;
    bounds[bOff] = rec.x;
    bounds[bOff + 1] = rec.y + centerYOffset * rec.scale;
    bounds[bOff + 2] = rec.z;
    bounds[bOff + 3] = boundRadius * rec.scale;
  }
  return { count: n, matrices, colors, bounds };
}

export function partitionByQuadrant(
  records: InstanceRecord[],
  midX: number,
  midZ: number
): [InstanceRecord[], InstanceRecord[], InstanceRecord[], InstanceRecord[]] {
  const q: [InstanceRecord[], InstanceRecord[], InstanceRecord[], InstanceRecord[]] = [
    [],
    [],
    [],
    [],
  ];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const idx = (rec.z >= midZ ? 2 : 0) + (rec.x >= midX ? 1 : 0);
    q[idx].push(rec);
  }
  return q;
}

export function bakeVegetationChunk(
  vcx: number,
  vcz: number,
  isInsideBuilding: (x: number, z: number) => boolean,
  brokenDeadfallIds: ReadonlySet<string>,
  deadfallKicksRemaining: ReadonlyMap<string, number>
): ChunkBucketBaked {
  const minX = vcx * CHUNK_SIZE;
  const minZ = vcz * CHUNK_SIZE;
  const bp = getActiveBlueprint();
  const rand = seededRand(hashChunkSeed(bp.seed, vcx, vcz));

  const birch: InstanceRecord[] = [];
  const pine: InstanceRecord[] = [];
  const bogPine: InstanceRecord[] = [];
  const spruce: InstanceRecord[] = [];
  const loneSpruce: InstanceRecord[] = [];
  const spruceCandidates: Array<{
    rec: InstanceRecord;
    openness: number;
    thicket: number;
  }> = [];
  const sapling: InstanceRecord[] = [];
  const hazelBush: InstanceRecord[] = [];
  const juniperBush: InstanceRecord[] = [];
  const fern: InstanceRecord[] = [];
  const shrub: InstanceRecord[] = [];
  const mossHummock: InstanceRecord[] = [];
  const reed: InstanceRecord[] = [];
  const boulder: InstanceRecord[] = [];
  const boulderOutcrop: InstanceRecord[] = [];
  const deadfall: InstanceRecord[] = [];
  const colliders: CircleCollider[] = [];

  const centerX = minX + CHUNK_SIZE * 0.5;
  const centerZ = minZ + CHUNK_SIZE * 0.5;
  if (
    Math.abs(centerX) > WORLD_HALF + CHUNK_SIZE * 0.5 ||
    Math.abs(centerZ) > WORLD_HALF + CHUNK_SIZE * 0.5
  ) {
    return {
      cells: [],
      colliders: [],
      deadfallLogs: [],
    };
  }

  // 1. Dense Estonian Forest Trees
  const treeSamples = 46;
  for (let i = 0; i < treeSamples; i++) {
    const tx = minX + rand() * CHUNK_SIZE;
    const tz = minZ + rand() * CHUNK_SIZE;
    if (Math.abs(tx) > WORLD_HALF - 4 || Math.abs(tz) > WORLD_HALF - 4) continue;
    if (distToRoadDetail(tx, tz).dist < 4.2) continue;

    const nearV = getDistanceToNearestVillage(tx, tz);
    if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.72) continue;
    if (isInsideBuilding(tx, tz)) continue;

    const thicket = getThicketFactor(tx, tz);
    const isl = getNearestSwampIsland(tx, tz);
    const onIsland = isl.island !== null && isl.islandMask > 0.42;
    const swamp = onIsland ? 0 : getSwampFactor(tx, tz);
    const y = getTerrainHeight(tx, tz);

    if (swamp > 0.35) {
      if (isDryLandForPlanting(tx, tz, 0.24, 1.1) && rand() < 0.45) {
        const s = 0.65 + rand() * 0.6;
        bogPine.push({
          x: tx,
          y: y - 0.06,
          z: tz,
          scale: s,
          rotY: rand() * Math.PI * 2,
          r: 0.85 + rand() * 0.16,
          g: 0.9 + rand() * 0.14,
          b: 0.82 + rand() * 0.12,
        });
        colliders.push({ x: tx, z: tz, r: 0.24 * s });
      }
      continue;
    }

    if (!isDryLandForPlanting(tx, tz, 0.34, 1.5)) continue;
    if (onIsland && isl.island!.hut && isl.dist < 6.8) continue;

    const groveNoise = smoothNoise(tx * 0.032, tz * 0.032);
    const s = 0.82 + rand() * 0.56;
    const tint = 0.84 + rand() * 0.24;
    const rec: InstanceRecord = {
      x: tx,
      y: y - 0.12,
      z: tz,
      scale: s,
      rotY: rand() * Math.PI * 2,
      r: tint * (0.94 + rand() * 0.12),
      g: tint * (0.96 + rand() * 0.1),
      b: tint * (0.88 + rand() * 0.1),
    };

    if (groveNoise > 0.56) {
      birch.push(rec);
      colliders.push({ x: tx, z: tz, r: 0.24 * s });
    } else if (groveNoise > 0.3 && thicket < 0.65) {
      pine.push(rec);
      colliders.push({ x: tx, z: tz, r: 0.26 * s });
    } else {
      const roadInfo = distToRoadDetail(tx, tz);
      const gladeNoise = smoothNoise(tx * 0.048 + 3.1, tz * 0.048 - 2.7);
      const openness = computeOpennessFactor(
        nearV.dist,
        nearV.village ? nearV.village.clearingRadius : 0,
        roadInfo.dist,
        roadInfo.isTrail,
        swamp,
        onIsland ? isl.islandMask : 0,
        gladeNoise
      );
      spruceCandidates.push({ rec, openness, thicket });
      colliders.push({ x: tx, z: tz, r: 0.28 * s });
    }
  }

  // 2. Thicket Density Boost & Solid Woodland Bushes (Põõsad)
  const bushAttempts = 28;
  for (let i = 0; i < bushAttempts; i++) {
    const bx = minX + rand() * CHUNK_SIZE;
    const bz = minZ + rand() * CHUNK_SIZE;
    if (Math.abs(bx) > WORLD_HALF - 4 || Math.abs(bz) > WORLD_HALF - 4) continue;
    if (distToRoadDetail(bx, bz).dist < 3.4) continue;
    const nearV = getDistanceToNearestVillage(bx, bz);
    if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.66) continue;
    if (isInsideBuilding(bx, bz)) continue;

    const isl = getNearestSwampIsland(bx, bz);
    const onIsland = isl.island !== null && isl.islandMask > 0.36;
    if (onIsland && isl.island!.hut && isl.dist < 5.5) continue;
    const swamp = onIsland ? 0 : getSwampFactor(bx, bz);
    if (swamp > 0.38) continue;

    const thicket = getThicketFactor(bx, bz);
    if (thicket < 0.45 && rand() > 0.55) continue;

    const by = getTerrainHeight(bx, bz);
    if (!isDryLandForPlanting(bx, bz, 0.24, 0.95)) continue;
    const s = 0.78 + rand() * 0.65;

    const roll = rand();
    if (roll < 0.48) {
      hazelBush.push({
        x: bx,
        y: by - 0.04,
        z: bz,
        scale: s,
        rotY: rand() * Math.PI * 2,
        r: 0.85 + rand() * 0.2,
        g: 0.92 + rand() * 0.14,
        b: 0.78 + rand() * 0.12,
      });
      colliders.push({ x: bx, z: bz, r: 0.68 * s });
    } else if (roll < 0.76) {
      juniperBush.push({
        x: bx,
        y: by - 0.03,
        z: bz,
        scale: s,
        rotY: rand() * Math.PI * 2,
        r: 0.82 + rand() * 0.18,
        g: 0.92 + rand() * 0.14,
        b: 0.76 + rand() * 0.12,
      });
      colliders.push({ x: bx, z: bz, r: 0.58 * s });
    } else {
      sapling.push({
        x: bx,
        y: by - 0.05,
        z: bz,
        scale: 0.75 + rand() * 0.85,
        rotY: rand() * Math.PI * 2,
        r: 0.84 + rand() * 0.18,
        g: 0.94 + rand() * 0.14,
        b: 0.78 + rand() * 0.12,
      });
      if (thicket > 0.62) {
        colliders.push({ x: bx, z: bz, r: 0.45 * s });
      }
    }
  }

  if (getThicketFactor(centerX, centerZ) > 0.58) {
    for (let i = 0; i < 24; i++) {
      const tx = minX + rand() * CHUNK_SIZE;
      const tz = minZ + rand() * CHUNK_SIZE;
      if (distToRoadDetail(tx, tz).dist < 3.6) continue;
      const nearV = getDistanceToNearestVillage(tx, tz);
      if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.7) continue;
      if (isInsideBuilding(tx, tz)) continue;
      if (getSwampFactor(tx, tz) > 0.36) continue;
      if (!isDryLandForPlanting(tx, tz, 0.32, 1.35)) continue;
      const ty = getTerrainHeight(tx, tz);
      const s = 0.85 + rand() * 0.55;
      if (i % 2 === 0) {
        spruce.push({
          x: tx,
          y: ty - 0.1,
          z: tz,
          scale: s * 0.82,
          rotY: rand() * Math.PI * 2,
          r: 0.82 + rand() * 0.18,
          g: 0.9 + rand() * 0.16,
          b: 0.76 + rand() * 0.14,
        });
        colliders.push({ x: tx, z: tz, r: 0.38 * s });
      } else {
        hazelBush.push({
          x: tx,
          y: ty - 0.04,
          z: tz,
          scale: s,
          rotY: rand() * Math.PI * 2,
          r: 0.84 + rand() * 0.2,
          g: 0.9 + rand() * 0.16,
          b: 0.76 + rand() * 0.12,
        });
        colliders.push({ x: tx, z: tz, r: 0.74 * s });
      }
    }
  }

  const neighborRadiusSq = 9.0 * 9.0;
  for (let i = 0; i < spruceCandidates.length; i++) {
    const cand = spruceCandidates[i];
    const cx = cand.rec.x;
    const cz = cand.rec.z;
    let nearbyTall = 0;
    for (let j = 0; j < birch.length; j++) {
      const dx = birch[j].x - cx;
      const dz = birch[j].z - cz;
      if (dx * dx + dz * dz < neighborRadiusSq) nearbyTall++;
    }
    for (let j = 0; j < pine.length; j++) {
      const dx = pine[j].x - cx;
      const dz = pine[j].z - cz;
      if (dx * dx + dz * dz < neighborRadiusSq) nearbyTall++;
    }
    for (let j = 0; j < spruce.length; j++) {
      const dx = spruce[j].x - cx;
      const dz = spruce[j].z - cz;
      if (dx * dx + dz * dz < neighborRadiusSq) nearbyTall++;
    }
    for (let j = 0; j < spruceCandidates.length; j++) {
      if (i === j) continue;
      const dx = spruceCandidates[j].rec.x - cx;
      const dz = spruceCandidates[j].rec.z - cz;
      if (dx * dx + dz * dz < neighborRadiusSq) nearbyTall++;
    }
    if (classifySpruceGrowthForm(cand.openness, nearbyTall, cand.thicket) === 'lone') {
      loneSpruce.push(cand.rec);
    } else {
      spruce.push(cand.rec);
    }
  }

  // 3. Multi-Layered Forest Understory
  for (let i = 0; i < 200; i++) {
    const gx = minX + rand() * CHUNK_SIZE;
    const gz = minZ + rand() * CHUNK_SIZE;
    if (Math.abs(gx) > WORLD_HALF - 3 || Math.abs(gz) > WORLD_HALF - 3) continue;
    if (distToRoadDetail(gx, gz).dist < 2.1) continue;
    if (isInsideBuilding(gx, gz)) continue;

    const gy = getTerrainHeight(gx, gz);
    if (gy < SWAMP_WATER_Y - 0.12) continue;

    const isl = getNearestSwampIsland(gx, gz);
    const onIsland = isl.island !== null && isl.islandMask > 0.35;
    const swamp = onIsland ? 0 : getSwampFactor(gx, gz);
    const patch = smoothNoise(gx * 0.09, gz * 0.09);

    if (swamp > 0.36) {
      if (gy <= SWAMP_WATER_Y + 0.35 && rand() < 0.68) {
        reed.push({
          x: gx,
          y: gy - 0.04,
          z: gz,
          scale: 0.72 + rand() * 0.92,
          rotY: rand() * Math.PI * 2,
          r: 0.74 + rand() * 0.22,
          g: 0.72 + rand() * 0.18,
          b: 0.42 + rand() * 0.12,
        });
      } else if (gy > SWAMP_WATER_Y + 0.14 && rand() < 0.26) {
        mossHummock.push({
          x: gx,
          y: gy - 0.05,
          z: gz,
          scale: 0.8 + rand() * 0.78,
          rotY: rand() * Math.PI * 2,
          r: 0.85,
          g: 0.88,
          b: 0.7,
        });
      }
      continue;
    }

    if (gy < SWAMP_WATER_Y + 0.16) continue;

    if (patch > 0.5 && rand() < 0.58) {
      fern.push({
        x: gx,
        y: gy - 0.03,
        z: gz,
        scale: 0.72 + rand() * 0.92,
        rotY: rand() * Math.PI * 2,
        r: 0.8 + rand() * 0.22,
        g: 0.9 + rand() * 0.16,
        b: 0.72 + rand() * 0.14,
      });
    } else if (rand() < 0.62) {
      shrub.push({
        x: gx,
        y: gy - 0.03,
        z: gz,
        scale: 0.78 + rand() * 0.94,
        rotY: rand() * Math.PI * 2,
        r: 0.84 + rand() * 0.22,
        g: 0.92 + rand() * 0.18,
        b: 0.76 + rand() * 0.14,
      });
    } else if (rand() < 0.42 && getDistanceToNearestVillage(gx, gz).dist > 14) {
      mossHummock.push({
        x: gx,
        y: gy - 0.04,
        z: gz,
        scale: 0.78 + rand() * 0.78,
        rotY: rand() * Math.PI * 2,
        r: 0.8 + rand() * 0.18,
        g: 0.9 + rand() * 0.14,
        b: 0.68 + rand() * 0.12,
      });
    }
  }

  // 4. Deadfall logs & Glacial Granite Boulders
  const deadfallIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const dx = minX + rand() * CHUNK_SIZE;
    const dz = minZ + rand() * CHUNK_SIZE;
    if (distToRoadDetail(dx, dz).dist < 4.4) continue;
    if (isInsideBuilding(dx, dz)) continue;
    const nearV = getDistanceToNearestVillage(dx, dz);
    if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.7) continue;
    if (getSwampFactor(dx, dz) > 0.32) continue;
    if (!isDryLandForPlanting(dx, dz, 0.24, 1.15)) continue;
    const dy = getTerrainHeight(dx, dz);
    const scale = 0.75 + rand() * 0.55;
    const rotY = rand() * Math.PI * 2;
    const rCol = 0.72 + rand() * 0.2;
    const gCol = 0.78 + rand() * 0.22;
    const bCol = 0.64 + rand() * 0.14;
    const logId = `${vcx}_${vcz}_${i}`;
    if (brokenDeadfallIds.has(logId)) continue;
    deadfallIds.push(logId);
    deadfall.push({
      x: dx,
      y: dy - 0.04,
      z: dz,
      scale,
      rotY,
      r: rCol,
      g: gCol,
      b: bCol,
    });
  }

  for (let i = 0; i < 5; i++) {
    const bx = minX + rand() * CHUNK_SIZE;
    const bz = minZ + rand() * CHUNK_SIZE;
    if (distToRoadDetail(bx, bz).dist < 4.5) continue;
    if (isInsideBuilding(bx, bz)) continue;
    const nearV = getDistanceToNearestVillage(bx, bz);
    if (nearV.village && nearV.dist < nearV.village.clearingRadius * 0.68) continue;
    const by = getTerrainHeight(bx, bz);
    if (by < SWAMP_WATER_Y + 0.18) continue;
    const s = 0.56 + rand() * 0.96;
    const isOutcrop = rand() < 0.45;
    const rec: InstanceRecord = {
      x: bx,
      y: by - 0.05,
      z: bz,
      scale: s,
      rotY: rand() * Math.PI * 2,
      r: 0.86 + rand() * 0.16,
      g: 0.88 + rand() * 0.14,
      b: 0.84 + rand() * 0.14,
    };
    if (isOutcrop) {
      boulderOutcrop.push(rec);
    } else {
      boulder.push(rec);
    }
    if (s > 0.68) colliders.push({ x: bx, z: bz, r: s * (isOutcrop ? 0.86 : 0.78) });
  }

  // Partition into 2x2 spatial sub-cells (24x24m quadrants) for hierarchical frustum culling
  const qBirch = partitionByQuadrant(birch, centerX, centerZ);
  const qPine = partitionByQuadrant(pine, centerX, centerZ);
  const qBogPine = partitionByQuadrant(bogPine, centerX, centerZ);
  const qSpruce = partitionByQuadrant(spruce, centerX, centerZ);
  const qLoneSpruce = partitionByQuadrant(loneSpruce, centerX, centerZ);
  const qSapling = partitionByQuadrant(sapling, centerX, centerZ);
  const qHazel = partitionByQuadrant(hazelBush, centerX, centerZ);
  const qJuniper = partitionByQuadrant(juniperBush, centerX, centerZ);
  const qFern = partitionByQuadrant(fern, centerX, centerZ);
  const qShrub = partitionByQuadrant(shrub, centerX, centerZ);
  const qMoss = partitionByQuadrant(mossHummock, centerX, centerZ);
  const qReed = partitionByQuadrant(reed, centerX, centerZ);
  const qBoulder = partitionByQuadrant(boulder, centerX, centerZ);
  const qBoulderOutcrop = partitionByQuadrant(boulderOutcrop, centerX, centerZ);
  const qDeadfall: [InstanceRecord[], InstanceRecord[], InstanceRecord[], InstanceRecord[]] = [
    [],
    [],
    [],
    [],
  ];
  const qDeadfallIds: [string[], string[], string[], string[]] = [[], [], [], []];
  for (let i = 0; i < deadfall.length; i++) {
    const rec = deadfall[i];
    const idx = (rec.z >= centerZ ? 2 : 0) + (rec.x >= centerX ? 1 : 0);
    qDeadfall[idx].push(rec);
    qDeadfallIds[idx].push(deadfallIds[i]);
  }

  const quarter = CHUNK_SIZE * 0.25;
  const cells: SubCellBaked[] = [];
  const deadfallLogs: DeadfallLogTarget[] = [];
  for (let q = 0; q < 4; q++) {
    const sBirch = bakeRecords(qBirch[q], 6.6, 8.4);
    const sPine = bakeRecords(qPine[q], 8.0, 9.4);
    const sBogPine = bakeRecords(qBogPine[q], 1.6, 2.5);
    const sSpruce = bakeRecords(qSpruce[q], 7.2, 8.8);
    const sLoneSpruce = bakeRecords(qLoneSpruce[q], 7.0, 9.4);
    const sSapling = bakeRecords(qSapling[q], 1.3, 2.0);
    const sHazel = bakeRecords(qHazel[q], 1.1, 1.9);
    const sJuniper = bakeRecords(qJuniper[q], 0.9, 1.6);
    const sFern = bakeRecords(qFern[q], 0.4, 1.2);
    const sShrub = bakeRecords(qShrub[q], 0.35, 1.1);
    const sMoss = bakeRecords(qMoss[q], 0.25, 1.2);
    const sReed = bakeRecords(qReed[q], 0.7, 1.4);
    const sBoulder = bakeRecords(qBoulder[q], 0.4, 1.8);
    const sBoulderOutcrop = bakeRecords(qBoulderOutcrop[q], 0.35, 1.9);
    const sDeadfall = bakeRecords(qDeadfall[q], 0.35, 2.2);

    const totalInstances =
      sBirch.count +
      sPine.count +
      sBogPine.count +
      sSpruce.count +
      sLoneSpruce.count +
      sSapling.count +
      sHazel.count +
      sJuniper.count +
      sFern.count +
      sShrub.count +
      sMoss.count +
      sReed.count +
      sBoulder.count +
      sBoulderOutcrop.count +
      sDeadfall.count;
    if (totalInstances === 0) continue;

    const cellIdx = cells.length;
    for (let di = 0; di < qDeadfall[q].length; di++) {
      const rec = qDeadfall[q][di];
      const id = qDeadfallIds[q][di];
      deadfallLogs.push({
        id,
        vcx,
        vcz,
        cellIdx,
        slabIdx: di,
        x: rec.x,
        y: rec.y,
        z: rec.z,
        scale: rec.scale,
        rotY: rec.rotY,
        kicksRemaining: deadfallKicksRemaining.get(id) ?? 2,
        broken: false,
      });
    }

    const qx = minX + ((q & 1) ? quarter * 3 : quarter);
    const qz = minZ + ((q & 2) ? quarter * 3 : quarter);
    const baseH = getTerrainHeight(qx, qz);
    const hasTallTrees = sBirch.count + sPine.count + sSpruce.count + sLoneSpruce.count > 0;
    const cy = baseH + (hasTallTrees ? 7.5 : 1.5);
    const r = hasTallTrees ? 22.5 : 18.5;

    cells.push({
      cx: qx,
      cy,
      cz: qz,
      r,
      birch: sBirch,
      pine: sPine,
      bogPine: sBogPine,
      spruce: sSpruce,
      loneSpruce: sLoneSpruce,
      sapling: sSapling,
      hazelBush: sHazel,
      juniperBush: sJuniper,
      fern: sFern,
      shrub: sShrub,
      mossHummock: sMoss,
      reed: sReed,
      boulder: sBoulder,
      boulderOutcrop: sBoulderOutcrop,
      deadfall: sDeadfall,
      totalInstances,
    });
  }

  return {
    cells,
    colliders,
    deadfallLogs,
  };
}

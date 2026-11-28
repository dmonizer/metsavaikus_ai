import * as THREE from 'three';
import { TerrainChunkManager } from '../src/world/terrainChunkManager';
import { TerrainChunkPrefetch, type PrefetchJob } from '../src/world/terrainChunkPrefetch';
import { buildTerrainChunk, type TerrainLod } from '../src/world/terrainChunkGeometry';
import { getActiveBlueprint, getTerrainHeight, setActiveWorldSeed } from '../src/world/terrainMath';
import { ComputeEngine } from '../src/world/wasmCompute';

// Compare every transferred attribute against an independent, uncached main-thread build.
export async function verifyTerrainWorker(): Promise<number> {
  const originalSeed = getActiveBlueprint().seed;
  let verified = 0;
  try {
    for (const seed of [2026, 7013]) {
      const bp = setActiveWorldSeed(seed);
      const compute = await ComputeEngine.create();
      const jobs: PrefetchJob[] = [];
      const stream = bp.streams[0];
      for (const [x, z] of [[bp.spawnX, bp.spawnZ], [stream.minX, stream.minZ], [bp.bogPools[0].x, bp.bogPools[0].z]]) {
        for (const lod of [0, 1, 2] as TerrainLod[]) {
          const vcx = Math.floor(x / 48), vcz = Math.floor(z / 48);
          jobs.push({vcx, vcz, lod, key: `${vcx}_${vcz}_${lod}`, priority: jobs.length});
        }
      }
      let mismatch = '';
      const worker = new TerrainChunkPrefetch(seed, compute.isWasmActive, () => false, (job, result) => {
        const expected = buildTerrainChunk(compute, job);
        for (const attribute of ['positions', 'normals', 'colors', 'uvs', 'splats'] as const) {
          const src = new Uint8Array(expected[attribute].buffer);
          const got = new Uint8Array(result[attribute].buffer);
          if (got.length !== src.length || src.some((byte, i) => got[i] !== byte)) {
            mismatch = `Seed ${seed} chunk ${job.key} ${attribute} differs`;
          }
        }
        if (result.segs !== expected.segs) mismatch = 'Terrain topology differs';
        verified++;
      });
      try {
        worker.schedule(jobs);
        await worker.whenIdle();
        if (!worker.available) throw new Error('Terrain worker unavailable');
        if (mismatch) throw new Error(mismatch);
      } finally {
        worker.dispose();
      }
    }
    // Spawn, turn around and cross a prewarmed LOD boundary. Every visible
    // request should hit the worker cache even when the first camera turns away.
    const bp = getActiveBlueprint();
    const texture = new THREE.Texture();
    const manager = new TerrainChunkManager(await ComputeEngine.create(), texture);
    try {
      await manager.prewarmAround(bp.spawnX, bp.spawnZ, 118, 40, 80);
      const initial = manager.consumeDiagnostics();
      if (!initial.workerBuilds || initial.geoBuilds !== initial.workerBuilds) {
        throw new Error('Spawn terrain did not come from the worker');
      }
      const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 150);
      for (let i = 0; i < 8; i++) {
        const x = bp.spawnX + i;
        camera.position.set(x, getTerrainHeight(x, bp.spawnZ) + 1.7, bp.spawnZ);
        camera.rotation.y = i * Math.PI / 4;
        manager.update(camera, undefined, 118, 40, 80);
        if (!manager.group.children.some(mesh => mesh.visible)) throw new Error('Empty terrain view');
      }
      if (manager.consumeDiagnostics().geoBuilds) throw new Error('Unexpected synchronous terrain build');
      // Retire a world with a job still in flight and a startup waiter attached.
      const pending = manager.prewarmAround(bp.spawnX + 240, bp.spawnZ);
      manager.dispose();
      await pending;
      if (manager.consumeDiagnostics().cacheSize) throw new Error('Retired terrain cache repopulated');
    } finally {
      manager.dispose();
      texture.dispose();
    }
  } finally {
    setActiveWorldSeed(originalSeed);
  }
  if (verified !== 18) throw new Error(`Expected 18 worker builds, received ${verified}`);
  return verified;
}

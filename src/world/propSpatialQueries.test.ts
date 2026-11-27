import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArchitectureAndProps, type InteractiveEntry } from './architectureAndProps';
import { setActiveWorldSeed } from './terrainMath';
import { sphereIntersectsFrustum } from './forestFrustumCuller';
import type { WorldTextures } from './proceduralTextures';
import type { SoundEngine } from './soundEngine';

function makeWorld() {
  setActiveWorldSeed(2026);
  const scene = new THREE.Scene(), texture = new THREE.Texture();
  const textures = new Proxy({}, { get: () => texture }) as WorldTextures;
  const sound = { playImpact() {}, playGatherMushroom() {} } as unknown as SoundEngine;
  return { scene, props: buildArchitectureAndProps(scene, textures, sound, () => {}, false) };
}

test('real prop candidates match a full scan after spawning, moving, opening, collecting and packing', () => {
  const { props } = makeWorld();
  const found: InteractiveEntry[] = [], worldPosition = new THREE.Vector3();
  const verify = (x: number, z: number) => {
    props.queryInteractiveObjects(x, z, 6.5, found);
    const expected = props.interactiveObjects.filter(entry => {
      entry.mesh.getWorldPosition(worldPosition);
      return !entry.gathered && entry.mesh.visible && (worldPosition.x - x) ** 2 + (worldPosition.z - z) ** 2 <= 6.5 ** 2;
    });
    assert.deepEqual(new Set(found), new Set(expected));
  };
  try {
    for (const [x, z] of [[0, 0], [-100, -100], [300, 100]]) {
      props.updateDynamicProps(0, x, z);
      verify(x, z);
    }
    const dynamic = props.dynamicObjects[0];
    dynamic.mesh.position.set(-100, 2, -100);
    props.updateInteractivePosition(dynamic);
    verify(-100, -100); assert.ok(found.includes(dynamic));
    dynamic.mesh.position.x += 30;
    props.updateInteractivePosition(dynamic);
    verify(-100, -100); assert.ok(!found.includes(dynamic));
    verify(-70, -100); assert.ok(found.includes(dynamic));
    const door = props.interactiveObjects.find(e => e.mesh.userData.debugLayer === 'door')!;
    door.onUse!();
    door.mesh.getWorldPosition(worldPosition); verify(worldPosition.x, worldPosition.z);
    assert.ok(found.includes(door));
    props.spawnPickupItemAt(-100, -100, 'firewood');
    const wood = props.interactiveObjects.at(-1)!;
    verify(-100, -100); assert.ok(found.includes(wood));
    props.collectPickupItem(wood);
    verify(-100, -100); assert.ok(!found.includes(wood));
    const tent = props.placePlayerTent(-100, -100, Math.PI / 3).tent!;
    assert.ok(tent);
    verify(tent.x, tent.z);
    const tentEntry = found.find(e => e.mesh.position.x === tent.x && e.mesh.position.z === tent.z && e.onUse)!;
    assert.ok(tentEntry);
    props.packUpPlayerTent(tent.id);
    verify(tent.x, tent.z); assert.ok(!found.includes(tentEntry));
  } finally { props.dispose(); }
  props.queryInteractiveObjects(0, 0, 1000, found);
  assert.equal(found.length, 0);
});

test('local mushroom visibility, fade and frustum match the full-scan rule after camera/quality changes', () => {
  const { props } = makeWorld();
  const out: InteractiveEntry[] = [];
  try {
    props.spawnMushroomAt(-100, -100, 'kukeseen');
    const mushroom = props.interactiveObjects.at(-1)!;
    const planes = new Float32Array(24);
    for (let i = 0; i < 6; i++) planes[i * 4 + 3] = -1000;
    for (const [x, z, distance, frustum] of [
      [-100, -100, 38, undefined], [-130, -100, 38, undefined],
      [300, 300, 38, undefined], [-100, -100, 10, undefined],
      [-120, -100, 38, planes], [-100, -100, 38, planes],
    ] as const) {
      props.updateDynamicProps(0, x, z, undefined, frustum, 225, 'clear', distance);
      for (const entry of props.interactiveObjects.filter(e => e.gatherable)) {
        const pos = entry.mesh.position, dSq = (pos.x - x) ** 2 + (pos.z - z) ** 2;
        const expected = !entry.gathered && dSq < distance ** 2 &&
          (!frustum || dSq <= 25 || sphereIntersectsFrustum(frustum, pos.x, pos.y + 0.25, pos.z, 1.2));
        assert.equal(entry.mesh.visible, expected);
        if (expected) {
          const start = Math.max(8, distance - 10);
          const t = Math.min(1, Math.max(0, (distance - Math.sqrt(dSq)) / Math.max(1, distance - start)));
          const scale = dSq <= start ** 2 ? 1 : 0.05 + 0.95 * t * t * (3 - 2 * t);
          assert.equal(entry.mesh.scale.x, scale);
        }
      }
    }
    props.gatherMushroom(mushroom);
    props.updateDynamicProps(0, -100, -100);
    props.queryInteractiveObjects(-100, -100, 6.5, out);
    assert.ok(!out.includes(mushroom)); assert.equal(mushroom.mesh.visible, false);
  } finally { props.dispose(); }
});

test('campfire [F] secondary action invokes throw firewood handler instead of falling back to push', () => {
  setActiveWorldSeed(2026);
  const scene = new THREE.Scene(), texture = new THREE.Texture();
  const textures = new Proxy({}, { get: () => texture }) as WorldTextures;
  let sparkBursts = 0;
  let logImpacts = 0;
  let throwCalls = 0;
  const sound = {
    playImpact() {},
    playGatherMushroom() {},
    playFireSparkBurst() { sparkBursts++; },
    playFireLogCatch() {},
  } as unknown as SoundEngine;

  const props = buildArchitectureAndProps(scene, textures, sound, () => {}, false, {
    hasFirewoodInPack: () => true,
    onThrowFirewoodAtCampfire: (cf) => {
      throwCalls++;
      props.throwFirewoodAtCampfire(cf.id, cf.x + 1.2, cf.y + 1.4, cf.z);
    },
    onCampfireLogImpact: () => {
      logImpacts++;
    },
  });

  try {
    const primary = props.getCampfires().find((c) => c.lit)!;
    assert.ok(primary, 'Expected primary lit campfire');
    const out: InteractiveEntry[] = [];
    props.queryInteractiveObjects(primary.x, primary.z, 3.0, out);
    const cfEntry = out.find((e) => e.mesh.userData.debugLayer === 'campfire');
    assert.ok(cfEntry, 'Campfire InteractiveEntry should be registered');
    assert.ok(cfEntry.getSecondaryActionLabel?.(), 'Campfire should show secondary [F] label when carrying wood');
    assert.equal(typeof cfEntry.onSecondaryAction, 'function', 'registerInteractive must preserve onSecondaryAction');

    cfEntry.onSecondaryAction!();
    assert.equal(throwCalls, 1);

    const thrownWood = props.dynamicObjects.at(-1)!;
    assert.equal(thrownWood.pickupItemId, 'firewood');
    assert.equal(thrownWood.resting, false);

    // Move thrown log to pit center as ballistic arc completes and absorb it
    thrownWood.mesh.position.set(primary.x, primary.y + 0.18, primary.z);
    const hits = props.feedDynamicFirewoodIntoCampfires();
    assert.equal(hits.length, 1);
    assert.equal(hits[0].lit, true);
    assert.equal(sparkBursts, 1);
    assert.equal(logImpacts, 1);
    assert.equal(thrownWood.gathered, true);
  } finally {
    props.dispose();
  }
});

test('pooled point lights update shadows on movement/reassignment without redundant stationary updates', () => {
  const { scene, props } = makeWorld();
  try {
    const lights = scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
    assert.equal(lights.length, 2);

    const primary = props.getCampfires().find((c) => c.lit)!;
    assert.ok(primary);

    // First update near lit primary campfire assigns light slots and marks shadow update
    props.updateDynamicProps(1, primary.x + 1.5, primary.z + 1.5);
    assert.equal(props.needsLightShadowUpdate(), true);
    const primaryLight = lights.find(
      (l) =>
        l.intensity > 0 &&
        Math.abs(l.position.x - primary.x) < 0.01 &&
        Math.abs(l.position.z - primary.z) < 0.01
    );
    assert.ok(primaryLight, 'Primary lit campfire should be bound to a pooled PointLight');

    // Clear renderer shadow flags and advance a stationary frame -> must not re-dirty shadows
    for (const l of lights) l.shadow.needsUpdate = false;
    props.updateDynamicProps(1.016, primary.x + 1.6, primary.z + 1.6);
    assert.equal(props.needsLightShadowUpdate(), false);

    // Light a movable storm lantern nearby and move it -> must update light position & mark shadow dirty
    const lantern = props.dynamicObjects.find(
      (d) => d.name.includes('Lantern') || (d.getName?.().includes('Lantern') ?? false)
    )!;
    assert.ok(lantern);
    lantern.mesh.position.set(primary.x + 0.5, primary.y + 0.4, primary.z + 0.5);
    if (lights.every((l) => l.position.distanceTo(lantern.mesh.position) > 0.2)) {
      lantern.onUse?.();
    }
    props.updateDynamicProps(1.032, primary.x + 0.5, primary.z + 0.5);
    assert.equal(props.needsLightShadowUpdate(), true);

    for (const l of lights) l.shadow.needsUpdate = false;
    lantern.mesh.position.x += 1.25;
    props.updateDynamicProps(1.048, lantern.mesh.position.x, lantern.mesh.position.z);
    assert.equal(props.needsLightShadowUpdate(), true);
    assert.ok(
      lights.some((l) => Math.abs(l.position.x - lantern.mesh.position.x) < 0.01),
      'Moved lit lantern should update assigned pooled PointLight position'
    );
  } finally {
    props.dispose();
  }
});



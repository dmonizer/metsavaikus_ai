import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArchitectureAndProps } from './architectureAndProps';
import { getActiveBlueprint, setActiveWorldSeed } from './terrainMath';
import type { WorldTextures } from './proceduralTextures';
import type { SoundEngine } from './soundEngine';
import { moveSphere } from './spatialPhysics';
import { ShelterGeometry, containsFootprint } from './shelterGeometry';
import { ITEM_CATALOG } from '../game/itemCatalog';

function makeWorld() {
  setActiveWorldSeed(2026);
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const textures = new Proxy({}, { get: () => texture }) as WorldTextures;
  const sound = { playImpact() {} } as unknown as SoundEngine;
  return { scene, props: buildArchitectureAndProps(scene, textures, sound, () => {}, false) };
}

test('fire requested inside a pitched tent is placed beyond its front doorway', () => {
  const { props } = makeWorld();
  try {
    const result = props.placePlayerTent(-100, -100, Math.PI / 3);
    assert.ok(result.tent);
    const tent = result.tent;
    const fire = props.placePlayerCampfire(tent.x, tent.z).campfire!;
    assert.ok(fire);
    const dx = fire.x - tent.x,
      dz = fire.z - tent.z;
    assert.ok(Math.abs(dx * Math.cos(tent.yaw) - dz * Math.sin(tent.yaw)) < 0.01);
    assert.ok(dx * Math.sin(tent.yaw) + dz * Math.cos(tent.yaw) >= 3.5);
  } finally {
    props.dispose();
  }
});

test('real house walls bounce indoor/outdoor throws and the door opens a usable passage', () => {
  const { props } = makeWorld();
  try {
    const village = getActiveBlueprint().villages[0],
      house = village.buildings[0];
    const x = village.x + house.offsetX,
      z = village.z + house.offsetZ;
    const floor = props.shelters.floorHeight(x, z, -Infinity);
    for (const side of [-1, 1]) {
      const pos = new THREE.Vector3(x + house.w / 2 + side, floor + 1, z);
      const vel = new THREE.Vector3(-side * 40, 0, 0);
      moveSphere(pos, vel, 0.08, 0.22, props.boxColliders);
      assert.ok((pos.x - x - house.w / 2) * side > 0);
      assert.ok(vel.x * side > 0);
    }
    const door = props.interactiveObjects.find(
      (entry) =>
        entry.mesh.parent?.parent?.position.x === x &&
        entry.mesh.parent?.parent?.position.z === z &&
        entry.onUse &&
        entry.mesh.parent?.position.z === house.d / 2 - 0.14
    )!;
    assert.ok(door);
    const start = new THREE.Vector3(x, floor + 1, z + house.d / 2 + 1);
    const closed = start.clone(),
      vel = new THREE.Vector3(0, 0, -20);
    moveSphere(closed, vel, 0.1, 0.22, props.boxColliders);
    assert.ok(closed.z > z + house.d / 2);
    door.onUse!();
    const open = start.clone();
    moveSphere(open, new THREE.Vector3(0, 0, -20), 0.1, 0.22, props.boxColliders);
    assert.ok(open.z < z + house.d / 2);
  } finally {
    props.dispose();
  }
});

test('shelter coverage matches rotated floors and disappears when a tent is packed', () => {
  const { props } = makeWorld();
  try {
    const tent = props.placePlayerTent(-100, -100, Math.PI / 3).tent!;
    assert.ok(tent);
    const tx = tent.x + Math.sin(tent.yaw) * 1.1,
      tz = tent.z + Math.cos(tent.yaw) * 1.1;
    assert.equal(props.getEnvironmentStateAt(tx, tz).shelter, 'tent');
    assert.ok(props.shelters.blocksRain(tx, tent.y + 0.5, tz));
    assert.ok(props.shelters.excludesVegetation(tx, tz));
    assert.ok(props.shelters.floorHeight(tent.x, tent.z, tent.y) > tent.y);
    assert.ok(props.packUpPlayerTent(tent.id));
    assert.equal(props.shelters.blocksRain(tx, tent.y + 0.5, tz), false);
    assert.equal(props.shelters.excludesVegetation(tx, tz), false);
    for (const village of getActiveBlueprint().villages)
      for (const house of village.buildings) {
        const x = village.x + house.offsetX,
          z = village.z + house.offsetZ;
        assert.equal(props.shelters.blocksRain(x, 0, z), house.decayState === 'intact');
      }
  } finally {
    props.dispose();
  }
});

test('rotated rectangular footprints use the same inverse transform as Three.js', () => {
  const shelters = new ShelterGeometry();
  const area = {
    id: 'diagonal',
    x: 12,
    z: 21,
    yaw: Math.PI / 3,
    halfW: 4,
    halfD: 1,
    floorY: 2,
    roof: { eaveY: 4, rise: 2, axis: 'z' as const },
  };
  shelters.add(area);
  const world = new THREE.Vector3(3.5, 0, 0)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), area.yaw)
    .add(new THREE.Vector3(area.x, 0, area.z));
  assert.ok(containsFootprint(area, world.x, world.z));
  assert.ok(shelters.blocksRain(world.x, 5, world.z));
  assert.equal(shelters.blocksRain(world.x, 7, world.z), false);
  assert.equal(shelters.blocksRain(100, 0, 100), false);
  assert.equal(shelters.uniforms.uShelterCount.value, 1);
  shelters.remove(area.id);
  assert.equal(shelters.uniforms.uShelterCount.value, 0);
  shelters.dispose();
});

test('occupied farmhouses contain three visible, individually collectable pantry provisions', () => {
  const { props, scene } = makeWorld();
  try {
    const pantries: THREE.Object3D[] = [];
    scene.traverse((node) => {
      if (node.name === 'pantry') pantries.push(node);
    });
    assert.ok(pantries.length > 0);
    for (const pantry of pantries) {
      const parent = pantry.parent!;
      const village = getActiveBlueprint().villages.find((v) =>
        v.buildings.some(
          (b) => v.x + b.offsetX === parent.position.x && v.z + b.offsetZ === parent.position.z
        )
      )!;
      const house = village.buildings.find(
        (b) =>
          village.x + b.offsetX === parent.position.x && village.z + b.offsetZ === parent.position.z
      )!;
      assert.equal(house.abandoned, false);
      const food = props.interactiveObjects.filter(
        (entry) => entry.mesh.parent === pantry && entry.pickupItemId
      );
      assert.equal(food.length, 3);
      for (const entry of food) {
        assert.ok(ITEM_CATALOG[entry.pickupItemId!].food);
        assert.equal(props.collectPickupItem(entry), entry.pickupItemId);
        assert.equal(entry.mesh.visible, false);
        assert.equal(props.collectPickupItem(entry), null);
      }
    }
  } finally {
    props.dispose();
  }
});

test('pooled lantern/fire lights cast shadows and refresh after a door changes', () => {
  const { props, scene } = makeWorld();
  try {
    const village = getActiveBlueprint().villages[0];
    props.updateDynamicProps(0, village.x, village.z);
    const lights = scene.children.filter(
      (node) => node instanceof THREE.PointLight
    ) as THREE.PointLight[];
    assert.equal(lights.length, 2);
    assert.ok(lights.every((light) => light.castShadow));
    assert.ok(props.needsLightShadowUpdate());
    for (const light of lights) light.shadow.needsUpdate = false;
    props.updateDynamicProps(1, village.x, village.z);
    assert.equal(props.needsLightShadowUpdate(), false);
    props.interactiveObjects.find(
      (entry) =>
        entry.mesh.parent?.parent?.position.x === village.x + village.buildings[0].offsetX &&
        entry.mesh.parent?.position.z === village.buildings[0].d / 2 - 0.14 &&
        entry.onUse
    )!.onUse!();
    props.updateDynamicProps(2, village.x, village.z);
    assert.ok(props.needsLightShadowUpdate());
  } finally {
    props.dispose();
  }
});

test('intact roof coverage reaches the underside of its ridge', () => {
  const { props } = makeWorld();
  try {
    const village = getActiveBlueprint().villages[0];
    const house = village.buildings[0];
    const x = village.x + house.offsetX;
    const z = village.z + house.offsetZ;
    const floor = props.shelters.floorHeight(x, z, -Infinity);
    const roofRise = house.roofStyle === 'thatch' ? 2.95 : 2.55;
    const ridgeY = floor - 0.43 + 0.4 + house.h + roofRise - 0.16;
    assert.equal(props.shelters.blocksRain(x, ridgeY - 0.2, z), true);
    assert.equal(props.shelters.blocksRain(x, ridgeY + 0.2, z), false);
  } finally {
    props.dispose();
  }
});

test('campfires exclude woodland foliage in a clean circle without acting as a floor or shelter', () => {
  const { props } = makeWorld();
  try {
    const placed = props.placePlayerCampfire(-115, -115);
    assert.ok(placed.ok && placed.campfire);
    const fire = placed.campfire;
    assert.equal(props.shelters.excludesVegetation(fire.x, fire.z), true);
    assert.equal(props.shelters.excludesVegetation(fire.x + 1.2, fire.z + 0.4), true);
    assert.equal(props.shelters.excludesVegetation(fire.x + 3.0, fire.z), false);
    assert.equal(props.shelters.floorHeight(fire.x, fire.z, -50), -50);
    assert.equal(props.shelters.blocksRain(fire.x, fire.y + 0.5, fire.z), false);
    assert.equal(props.getEnvironmentStateAt(fire.x, fire.z).shelter, 'outdoor');
  } finally {
    props.dispose();
  }
});

test('intact house overhangs, spring well roofs, and pitched tents block rain and thrown objects', () => {
  const { props } = makeWorld();
  try {
    const village = getActiveBlueprint().villages[0];
    const house = village.buildings.find((b) => b.decayState === 'intact')!;
    const hx = village.x + house.offsetX;
    const hz = village.z + house.offsetZ;
    const hy = props.shelters.floorHeight(hx, hz, -Infinity) - 0.43;

    // Under eaves overhang outside front wall still blocks rain without extending elevated floor
    const overhangZ = hz + house.d / 2 + 0.45;
    assert.equal(props.shelters.blocksRain(hx, hy + 1.5, overhangZ), true);
    assert.equal(props.shelters.floorHeight(hx, overhangZ, -50), -50);

    // Pitched tent rainfly blocks falling/thrown objects, and packing removes its roof colliders
    const tent = props.placePlayerTent(-100, -100, Math.PI / 4).tent!;
    const boxCountWithTent = props.boxColliders.length;
    const dropOnTent = new THREE.Vector3(tent.x, tent.y + 1.8, tent.z);
    const dropVel = new THREE.Vector3(0, -16, 0);
    const hitTent = moveSphere(dropOnTent, dropVel, 0.14, 0.22, props.boxColliders);
    assert.equal(hitTent, true, 'Object dropped onto pitched tent roof must collide with tent rainfly');
    assert.ok(dropOnTent.y > tent.y + 0.5, 'Object must bounce off tent roof rather than passing through');

    assert.equal(props.packUpPlayerTent(tent.id), true);
    assert.ok(props.boxColliders.length < boxCountWithTent, 'Packing tent must remove its roof colliders');
  } finally {
    props.dispose();
  }
});



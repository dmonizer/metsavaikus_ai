import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArchitectureAndProps } from './architectureAndProps';
import { selectUnobstructedInteractiveHit } from './interactionTargeting';
import { getActiveBlueprint, getTerrainHeight, setActiveWorldSeed } from './terrainMath';
import type { WorldTextures } from './proceduralTextures';
import type { SoundEngine } from './soundEngine';
import { findNearestColliderObstructionDistance, moveSphere } from './spatialPhysics';

function makeWorld() {
  setActiveWorldSeed(2026);
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const textures = new Proxy({}, { get: () => texture }) as WorldTextures;
  const sound = { playImpact() {}, playPhysicalImpactFallback() {} } as unknown as SoundEngine;
  return { scene, props: buildArchitectureAndProps(scene, textures, sound, () => {}, false) };
}

function raycastEntry(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  meshes: THREE.Object3D[],
  boxes: ReturnType<typeof makeWorld>['props']['boxColliders']
) {
  const dir = target.clone().sub(origin).normalize();
  const raycaster = new THREE.Raycaster(origin, dir, 0, 12);
  const hits = raycaster.intersectObjects(meshes, true);
  return {
    rawHits: hits,
    selected: selectUnobstructedInteractiveHit(origin, hits, boxes),
  };
}

test('solid walls and closed doors block beds/pickups while open doorways and closed doors themselves remain selectable', () => {
  const { props } = makeWorld();
  try {
    const bp = getActiveBlueprint();
    const village = bp.villages[0];
    const house = village.buildings[0];
    const hx = village.x + house.offsetX;
    const hz = village.z + house.offsetZ;
    const hy = getTerrainHeight(hx, hz);

    // Find this house's door and bed in interactiveObjects
    const door = props.interactiveObjects.find(
      (entry) =>
        entry.ownCollider &&
        entry.mesh.parent?.parent?.position.x === hx &&
        entry.mesh.parent?.parent?.position.z === hz
    )!;
    assert.ok(door, 'Expected house door with ownCollider');

    const bed = props.interactiveObjects.find(
      (entry) =>
        entry.mesh.parent?.position.x === hx &&
        entry.mesh.parent?.position.z === hz &&
        entry.name.toLowerCase().includes('bed')
    )!;
    assert.ok(bed, 'Expected house bed inside building');

    // Place a pickup inside the house near the center-right
    const pickupResult = props.spawnPickupItemAt(hx + 1.2, hz, 'rye_bread');
    const pickupEntry = props.interactiveObjects.find(
      (e) =>
        e.pickupItemId === 'rye_bread' &&
        Math.hypot(e.mesh.position.x - pickupResult.x, e.mesh.position.z - pickupResult.z) < 0.1
    )!;
    assert.ok(pickupEntry);
    const pickupWorldPos = new THREE.Vector3();
    pickupEntry.mesh.getWorldPosition(pickupWorldPos);

    // 1. Standing outside looking straight through the SOLID BACK WALL at the bed inside -> BLOCKED
    const bedWorldPos = new THREE.Vector3();
    bed.mesh.getWorldPosition(bedWorldPos);
    const outsideBackCam = new THREE.Vector3(bedWorldPos.x, hy + 1.65, hz - house.d / 2 - 1.5);
    const throughWall = raycastEntry(outsideBackCam, bedWorldPos, [bed.mesh], props.boxColliders);
    assert.ok(throughWall.rawHits.length > 0, 'Ray without occlusion check would hit bed behind wall');
    assert.equal(throughWall.selected, null, 'Solid wall must block targeting bed behind it');

    // 2. Standing outside looking through SOLID FRONT-RIGHT WALL at the indoor pickup -> BLOCKED
    const outsideFrontWallCam = new THREE.Vector3(pickupWorldPos.x, hy + 1.65, hz + house.d / 2 + 1.5);
    const pickupThroughWall = raycastEntry(
      outsideFrontWallCam,
      pickupWorldPos,
      [pickupEntry.mesh],
      props.boxColliders
    );
    assert.ok(pickupThroughWall.rawHits.length > 0);
    assert.equal(pickupThroughWall.selected, null, 'Solid front wall must block indoor pickup');

    // 3. Standing in front of CLOSED door: door itself IS selectable, bed directly behind closed door is BLOCKED
    const doorWorldPos = new THREE.Vector3();
    door.mesh.getWorldPosition(doorWorldPos);
    const inFrontOfDoorCam = new THREE.Vector3(hx, hy + 1.65, hz + house.d / 2 + 1.4);
    const closedDoorSelf = raycastEntry(
      inFrontOfDoorCam,
      doorWorldPos,
      props.interactiveMeshes,
      props.boxColliders
    );
    assert.equal(closedDoorSelf.selected, door, 'Closed door itself must remain selectable to open');
    const bedThroughClosedDoor = raycastEntry(
      inFrontOfDoorCam,
      bedWorldPos,
      [bed.mesh],
      props.boxColliders
    );
    assert.equal(bedThroughClosedDoor.selected, null, 'Closed door collider must block bed behind it');

    // 4. Open the door -> looking through the open doorway selects objects inside unobstructed!
    door.onUse!();
    const indoorInFrontOfDoor = props.spawnPickupItemAt(hx, hz + 0.5, 'chocolate_bar');
    const indoorCenterEntry = props.interactiveObjects.find(
      (e) =>
        e.pickupItemId === 'chocolate_bar' &&
        Math.hypot(e.mesh.position.x - indoorInFrontOfDoor.x, e.mesh.position.z - indoorInFrontOfDoor.z) < 0.1
    )!;
    const indoorCenterPos = new THREE.Vector3();
    indoorCenterEntry.mesh.getWorldPosition(indoorCenterPos);
    const throughOpenDoor = raycastEntry(
      inFrontOfDoorCam,
      indoorCenterPos,
      [indoorCenterEntry.mesh],
      props.boxColliders
    );
    assert.equal(throughOpenDoor.selected, indoorCenterEntry, 'Open doorway must allow selecting reachable indoor pickup');
  } finally {
    props.dispose();
  }
});

test('rotated buildings, above/below collider height, and solid roofs respect 3D oriented geometry', () => {
  const { props } = makeWorld();
  try {
    // Spawn a rotated intact hut at 45 degrees (pi/4)
    const rotYaw = Math.PI / 4;
    const hx = -130;
    const hz = -130;
    const hut = props.spawnHutAt(hx, hz, rotYaw, 'intact', 'Rotated Test Hut');
    const cosR = Math.cos(rotYaw);
    const sinR = Math.sin(rotYaw);
    const toWorld = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(
        hx + lx * cosR + lz * sinR,
        hut.y + ly,
        hz - lx * sinR + lz * cosR
      );

    // Find rotated hut's bed
    const bed = props.interactiveObjects.find(
      (e) =>
        e.mesh.parent?.position.x === hx &&
        e.mesh.parent?.position.z === hz &&
        e.name.includes('Rotated Test Hut') &&
        e.name.toLowerCase().includes('bed')
    )!;
    assert.ok(bed);
    const bedWorld = new THREE.Vector3();
    bed.mesh.getWorldPosition(bedWorld);

    // Outside rotated back wall -> blocked
    const behindRotatedBackWall = toWorld(bed.mesh.position.x, 1.65, -4.2);
    const blockedRot = raycastEntry(behindRotatedBackWall, bedWorld, [bed.mesh], props.boxColliders);
    assert.equal(blockedRot.selected, null, 'Rotated wall collider must block bed behind it');

    // Targets ABOVE / BELOW collider height:
    // A low 0.92m fence collider blocks ground-level raycast, but looking ABOVE it passes unobstructed
    const lowWallPos = new THREE.Vector3(-85, getTerrainHeight(-85, -85), -85);
    const fencePickup = props.spawnPickupItemAt(lowWallPos.x, lowWallPos.z - 1.5, 'matches');
    const matchEntry = props.interactiveObjects.find(
      (e) =>
        e.pickupItemId === 'matches' &&
        Math.hypot(e.mesh.position.x - fencePickup.x, e.mesh.position.z - fencePickup.z) < 0.1
    )!;
    const matchPos = new THREE.Vector3();
    matchEntry.mesh.getWorldPosition(matchPos);
    const lowWallCollider = {
      minX: lowWallPos.x - 1,
      maxX: lowWallPos.x + 1,
      minZ: lowWallPos.z - 0.15,
      maxZ: lowWallPos.z + 0.15,
      groundY: lowWallPos.y,
      heightAboveGround: 0.92,
      jumpable: true,
      active: true,
    };
    const crouchCam = new THREE.Vector3(lowWallPos.x, lowWallPos.y + 0.35, lowWallPos.z + 1.5);
    assert.equal(
      raycastEntry(crouchCam, matchPos, [matchEntry.mesh], [lowWallCollider]).selected,
      null,
      'Ray passing through low wall collider height must be blocked'
    );
    // Target perched above collider height (y + 1.4m) is unobstructed over the 0.92m wall
    matchEntry.mesh.position.y = lowWallPos.y + 1.4;
    matchEntry.mesh.updateMatrixWorld(true);
    matchEntry.mesh.getWorldPosition(matchPos);
    const standingCam = new THREE.Vector3(lowWallPos.x, lowWallPos.y + 1.65, lowWallPos.z + 1.5);
    assert.equal(
      raycastEntry(standingCam, matchPos, [matchEntry.mesh], [lowWallCollider]).selected,
      matchEntry,
      'Ray passing above collider height must remain selectable'
    );

    // Deadfall obstruction check helper: ray through hut wall is obstructed
    const dir = bedWorld.clone().sub(behindRotatedBackWall).normalize();
    const obsDist = findNearestColliderObstructionDistance(
      behindRotatedBackWall,
      dir,
      6.0,
      props.boxColliders
    );
    assert.ok(obsDist !== null && obsDist < behindRotatedBackWall.distanceTo(bedWorld));

    // Solid roof collision: thrown crate inside rotated intact hut bounces off sloped roof instead of passing through
    const floorY = props.shelters.floorHeight(hx, hz, -Infinity);
    const cratePos = new THREE.Vector3(hx, floorY + 2.2, hz);
    const crateVel = new THREE.Vector3(0, 32, 0);
    const collidedUp = moveSphere(cratePos, crateVel, 0.15, 0.25, props.boxColliders);
    assert.equal(collidedUp, true, 'Thrown crate rising inside intact house must hit solid roof');
    assert.ok(crateVel.y < 0, 'Crate must bounce downward off roof underside');
    assert.ok(cratePos.y < hut.y + 0.4 + 2.75 + 2.95, 'Crate must not escape above intact house ridge');

    // Dropped crate above rotated house roof bounces off top slope instead of falling straight into room
    const aboveRoof = toWorld(0, 0.4 + 2.75 + 2.2, 1.2);
    const dropVel = new THREE.Vector3(0, -18, 0);
    const collidedDown = moveSphere(aboveRoof, dropVel, 0.15, 0.25, props.boxColliders);
    assert.equal(collidedDown, true, 'Object falling onto intact roof must collide with top roof slope');
    assert.ok(aboveRoof.y > hut.y + 0.4 + 2.75, 'Object must stay above roof slope rather than passing through');
  } finally {
    props.dispose();
  }
});

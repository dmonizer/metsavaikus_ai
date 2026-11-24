import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BoxCollider,
  moveSphere,
  pushCharacterOut,
  pushSphereOut,
  sweepSphere,
} from './spatialPhysics';

const wall: BoxCollider = {
  minX: -0.14,
  maxX: 0.14,
  minZ: -4,
  maxZ: 4,
  groundY: 0,
  heightAboveGround: 3,
  active: true,
  jumpable: false,
};

for (const side of [-1, 1]) {
  for (const yaw of [0, Math.PI / 2, Math.PI / 3]) {
    test(`continuous sphere collision keeps throws on their original side (${side}, yaw ${yaw})`, () => {
      const c = Math.cos(yaw),
        s = Math.sin(yaw);
      const box = { ...wall, frame: { x: 0, z: 0, yaw, halfW: 0.14, halfD: 4 } };
      const pos = new THREE.Vector3(side * 2 * c, 1.4, -side * 2 * s);
      const vel = new THREE.Vector3(-side * 120 * c, 0, side * 120 * s);
      assert.equal(moveSphere(pos, vel, 0.1, 0.22, [box]), true);
      assert.ok((pos.x * c - pos.z * s) * side > 0.36);
      assert.ok((vel.x * c - vel.z * s) * side > 0);
    });
  }
}

test('inactive doors and throws above broken walls do not collide', () => {
  assert.equal(
    sweepSphere(new THREE.Vector3(-2, 1, 0), new THREE.Vector3(2, 1, 0), 0.2, {
      ...wall,
      active: false,
    }),
    null
  );
  assert.equal(
    sweepSphere(new THREE.Vector3(-2, 4, 0), new THREE.Vector3(2, 4, 0), 0.2, wall),
    null
  );
});

test('overlapping bodies leave through the nearest face without teleporting across the wall', () => {
  const pos = new THREE.Vector3(-0.2, 1, 0);
  pushSphereOut(pos, 0.22, wall);
  assert.ok(pos.x < -0.36);
  const velocity = new THREE.Vector3(-2, 0, 0);
  moveSphere(pos, velocity, 0.1, 0.22, [wall]);
  assert.ok(pos.x < -0.55);
  assert.equal(velocity.x, -2);
});

test('sliding and multiple impacts stay outside solid corner walls', () => {
  const corner = { ...wall, minZ: -0.14, maxZ: 0.14, minX: -4, maxX: 4 };
  const pos = new THREE.Vector3(-2, 1, -2),
    velocity = new THREE.Vector3(30, 0, 25);
  moveSphere(pos, velocity, 0.2, 0.22, [wall, corner]);
  assert.ok(pos.x < -0.36 && pos.z < -0.36);
});

test('characters resolve sideways at low walls and can stand above them', () => {
  const lowWall = { ...wall, heightAboveGround: 0.8 };
  const feet = new THREE.Vector3(-0.2, 0.4, 0);
  pushCharacterOut(feet, 0.42, 1.8, lowWall);
  assert.ok(feet.x < -0.56);
  assert.equal(feet.y, 0.4);
  const above = new THREE.Vector3(-0.2, 0.81, 0);
  pushCharacterOut(above, 0.42, 1.8, lowWall);
  assert.equal(above.x, -0.2);
});

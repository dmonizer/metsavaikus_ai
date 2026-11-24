import * as THREE from 'three';

/** World-space bounds, optionally retaining the oriented shape that produced them. */
export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  groundY: number;
  heightAboveGround: number;
  jumpable: boolean;
  active: boolean;
  frame?: { x: number; z: number; yaw: number; halfW: number; halfD: number };
}

interface SweepHit {
  time: number;
  normal: THREE.Vector3;
  penetration: number;
}

/** Swept sphere against a box expanded by radius. Conservative at box corners. */
export function sweepSphere(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  box: BoxCollider,
  horizontalOnly = false
): SweepHit | null {
  if (!box.active) return null;
  const f = box.frame;
  const c = Math.cos(f?.yaw ?? 0),
    s = Math.sin(f?.yaw ?? 0);
  const cx = f?.x ?? (box.minX + box.maxX) / 2;
  const cz = f?.z ?? (box.minZ + box.maxZ) / 2;
  const hw = f?.halfW ?? (box.maxX - box.minX) / 2;
  const hd = f?.halfD ?? (box.maxZ - box.minZ) / 2;
  const origin = [
    (start.x - cx) * c - (start.z - cz) * s,
    start.y,
    (start.x - cx) * s + (start.z - cz) * c,
  ];
  const delta = [
    (end.x - start.x) * c - (end.z - start.z) * s,
    end.y - start.y,
    (end.x - start.x) * s + (end.z - start.z) * c,
  ];
  const lo = [-hw - radius, horizontalOnly ? -Infinity : box.groundY - radius, -hd - radius];
  const hi = [
    hw + radius,
    horizontalOnly ? Infinity : box.groundY + box.heightAboveGround + radius,
    hd + radius,
  ];
  let enter = -Infinity,
    exit = Infinity,
    axis = 0,
    sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(delta[i]) < 1e-10) {
      if (origin[i] < lo[i] || origin[i] > hi[i]) return null;
      continue;
    }
    const a = (lo[i] - origin[i]) / delta[i],
      b = (hi[i] - origin[i]) / delta[i];
    const near = Math.min(a, b),
      far = Math.max(a, b);
    if (near > enter) {
      enter = near;
      axis = i;
      sign = delta[i] > 0 ? -1 : 1;
    }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1) return null;
  let penetration = 0;
  if (enter < 0) {
    // Depenetrate on the nearest face, never arbitrarily send an indoor body outside.
    let distance = Infinity;
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const d = side < 0 ? origin[i] - lo[i] : hi[i] - origin[i];
        if (d < distance) {
          distance = d;
          axis = i;
          sign = side;
        }
      }
    }
    penetration = Math.max(0, distance);
    // A body already touching and travelling away needs no collision response.
    if (distance < 1e-5 && delta[axis] * sign >= 0) return null;
  }
  const local = new THREE.Vector3();
  local.setComponent(axis, sign);
  return {
    time: Math.max(0, enter),
    penetration,
    normal: new THREE.Vector3(local.x * c + local.z * s, local.y, -local.x * s + local.z * c),
  };
}

/** Continuous collision response shared by throws, drops and carried-object placement. */
export function moveSphere(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  dt: number,
  radius: number,
  boxes: readonly BoxCollider[],
  restitution = 0.35
): boolean {
  let remaining = dt,
    collided = false;
  for (let iteration = 0; iteration < 6 && remaining > 1e-7; iteration++) {
    const target = position.clone().addScaledVector(velocity, remaining);
    let first: SweepHit | null = null;
    for (const box of boxes) {
      const hit = sweepSphere(position, target, radius, box);
      if (hit && (!first || hit.time < first.time)) first = hit;
    }
    if (!first) {
      position.copy(target);
      break;
    }
    collided = true;
    position.addScaledVector(velocity, remaining * Math.max(0, first.time - 1e-5));
    position.addScaledVector(first.normal, first.penetration + 0.001);
    const incoming = velocity.dot(first.normal);
    if (incoming < 0) velocity.addScaledVector(first.normal, -(1 + restitution) * incoming);
    remaining *= 1 - first.time;
  }
  return collided;
}

/** Resolve a stationary sphere with the same oriented bounds as continuous movement. */
export function pushSphereOut(position: THREE.Vector3, radius: number, box: BoxCollider): void {
  const hit = sweepSphere(position, position, radius, box);
  if (hit && hit.penetration > 0) position.addScaledVector(hit.normal, hit.penetration + 0.001);
}

/** Upright characters resolve sideways while their vertical span overlaps a solid wall. */
export function pushCharacterOut(
  feet: THREE.Vector3,
  radius: number,
  height: number,
  box: BoxCollider
): void {
  if (feet.y >= box.groundY + box.heightAboveGround || feet.y + height <= box.groundY) return;
  const hit = sweepSphere(feet, feet, radius, box, true);
  if (hit && hit.penetration > 0) feet.addScaledVector(hit.normal, hit.penetration + 0.001);
}

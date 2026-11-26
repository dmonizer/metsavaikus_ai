import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildArchitectureAndProps } from './architectureAndProps';
import { setActiveWorldSeed } from './terrainMath';
import { WorldResources } from './worldResources';
import type { WorldTextures } from './proceduralTextures';
import type { SoundEngine } from './soundEngine';

test('world teardown releases every attached prop geometry/material once and preserves external assets', () => {
  setActiveWorldSeed(2026);
  const scene = new THREE.Scene(), texture = new THREE.Texture();
  const external = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(external);
  let textureDisposals = 0, externalDisposals = 0;
  texture.addEventListener('dispose', () => textureDisposals++);
  external.geometry.addEventListener('dispose', () => externalDisposals++);
  external.material.addEventListener('dispose', () => externalDisposals++);
  const props = buildArchitectureAndProps(scene, new Proxy({}, { get: () => texture }) as WorldTextures,
    { playImpact() {} } as unknown as SoundEngine, () => {}, true);
  props.spawnPickupItemAt(-100, -100, 'rye_bread');
  const counts = new Map<THREE.BufferGeometry | THREE.Material, { count: number; label: string }>();
  function observe(root: THREE.Object3D) {
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const resource of [node.geometry, ...[node.material].flat()]) {
        if (counts.has(resource)) continue;
        const observation = { count: 0, label: `${resource.type} on ${node.userData.debugName ?? node.name ?? node.type}` };
        counts.set(resource, observation);
        resource.addEventListener('dispose', () => observation.count++);
      }
    });
  }
  for (const root of scene.children) if (root !== external) observe(root);
  const tent = props.placePlayerTent(-100, -100, 0).tent!;
  assert.ok(tent);
  const tentRoot = props.interactiveObjects.at(-1)!.mesh;
  observe(tentRoot);
  const tentMaterials = new Set<THREE.Material>();
  tentRoot.traverse(node => { if (node instanceof THREE.Mesh) for (const material of [node.material].flat()) tentMaterials.add(material); });
  assert.equal(props.packUpPlayerTent(tent.id), true);
  for (const material of tentMaterials) assert.equal(counts.get(material)!.count, 0, 'packing must retain shared tent materials');
  const replacement = props.placePlayerTent(-100, -100, Math.PI / 3).tent;
  assert.ok(replacement);
  observe(props.interactiveObjects.at(-1)!.mesh);
  props.dispose();
  for (const { count, label } of counts.values()) assert.equal(count, 1, label);
  props.dispose();
  for (const { count, label } of counts.values()) assert.equal(count, 1, `idempotent: ${label}`);
  assert.equal(textureDisposals, 0);
  assert.equal(externalDisposals, 0);
  assert.deepEqual(scene.children, [external]);
  external.geometry.dispose(); external.material.dispose(); texture.dispose();
});


test('resource scope deduplicates shared ownership and finishes cleanup if one disposer fails', () => {
  const scene = new THREE.Scene(), scope = new WorldResources(scene);
  let disposed = 0;
  const shared = { dispose() { disposed++; } };
  const failure = new Error('fixture disposal failure');
  scope.own({ dispose() { throw failure; } }, shared, shared);
  scope.add(new THREE.Group());
  assert.throws(() => scope.dispose(), AggregateError);
  assert.equal(disposed, 1);
  assert.equal(scene.children.length, 0);
  scope.dispose();
  assert.equal(disposed, 1);
  assert.throws(() => scope.add(new THREE.Group()), /disposed/);
});

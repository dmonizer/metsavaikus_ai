import * as THREE from 'three';

export interface DisposableResource { dispose(): void; }

/** Owns this module's scene roots and render resources, never their borrowed textures.
 * Composite objects delegate resource disposal to their explicit owner.
 */
export class WorldResources {
  private readonly roots = new Set<THREE.Object3D>();
  private readonly owned = new Set<DisposableResource>();
  private readonly composites = new Set<THREE.Object3D>();
  private disposed = false;

  constructor(private readonly scene: THREE.Object3D) {}

  own(...resources: DisposableResource[]): void {
    if (this.disposed) throw new Error('World resource scope is disposed');
    for (const resource of resources) this.owned.add(resource);
  }

  add(...objects: THREE.Object3D[]): void {
    if (this.disposed) throw new Error('World resource scope is disposed');
    for (const object of objects) {
      this.roots.add(object);
      this.scene.add(object);
    }
  }

  addComposite(object: THREE.Object3D, owner: DisposableResource): void {
    this.add(object);
    this.ownComposite(object, owner);
  }

  ownComposite(object: THREE.Object3D, owner: DisposableResource): void {
    this.own(owner);
    this.composites.add(object);
  }

  /** Detach a separately disposed object; shared materials remain owned by this scope. */
  detach(object: THREE.Object3D): void {
    this.roots.delete(object);
    object.removeFromParent();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const root of this.roots) {
      this.collectRenderResources(root);
      root.removeFromParent();
    }
    this.disposed = true;
    const errors: unknown[] = [];
    for (const resource of this.owned) {
      try { resource.dispose(); } catch (error) { errors.push(error); }
    }
    this.owned.clear();
    this.roots.clear();
    this.composites.clear();
    if (errors.length) throw new AggregateError(errors, 'World resource disposal failed');
  }

  private collectRenderResources(object: THREE.Object3D): void {
    if (this.composites.has(object)) return;
    if (object instanceof THREE.InstancedMesh) this.own(object);
    const renderable = object as THREE.Mesh;
    if (renderable.geometry) this.own(renderable.geometry);
    if (renderable.material) this.own(...[renderable.material].flat());
    for (const child of object.children) this.collectRenderResources(child);
  }
}

import * as THREE from 'three';
import type { WorldResources } from './worldResources';
import type { InteractiveEntry } from './architectureAndProps';
import type { ItemId } from '../game/itemCatalog';
import { getItemName, t } from '../i18n/i18n';

type RegisterInteractive = (
  mesh: THREE.Object3D,
  options: Partial<InteractiveEntry> & { name: string; desc: string }
) => InteractiveEntry;

/** A small finite stock, individually collected through the standard inventory pickup path. */
export function buildPantry(
  parent: THREE.Group,
  width: number,
  depth: number,
  register: RegisterInteractive,
  resources: Pick<WorldResources, 'own'>
): void {
  const pantry = new THREE.Group();
  pantry.name = 'pantry';
  pantry.position.set(width * 0.27, 0.43, -depth / 2 + 0.55);
  parent.add(pantry);
  const wood = new THREE.MeshStandardMaterial({ color: 0x795737, roughness: 0.9 });
  const shelfGeo = new THREE.BoxGeometry(1.55, 0.08, 0.55);
  const postGeo = new THREE.BoxGeometry(0.08, 1.7, 0.55);
  resources.own(wood, shelfGeo, postGeo);
  for (const height of [0.16, 0.72, 1.3]) {
    const shelf = new THREE.Mesh(shelfGeo, wood);
    shelf.position.y = height;
    shelf.castShadow = shelf.receiveShadow = true;
    pantry.add(shelf);
  }
  for (const x of [-0.74, 0.74]) {
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(x, 0.85, 0);
    post.castShadow = post.receiveShadow = true;
    pantry.add(post);
  }
  const provisions: Array<{
    id: ItemId;
    color: number;
    x: number;
    y: number;
    shape: 'loaf' | 'sausage' | 'jar';
  }> = [
    { id: 'rye_bread', color: 0x8d542b, x: -0.35, y: 0.88, shape: 'loaf' },
    { id: 'smoked_sausage', color: 0x8e3d2f, x: 0.34, y: 0.84, shape: 'sausage' },
    { id: 'dried_berries', color: 0x633348, x: -0.15, y: 1.49, shape: 'jar' },
  ];
  for (const provision of provisions) {
    const geometry =
      provision.shape === 'loaf'
        ? new THREE.SphereGeometry(0.18, 10, 8)
        : provision.shape === 'sausage'
          ? new THREE.CylinderGeometry(0.065, 0.065, 0.4, 10)
          : new THREE.CylinderGeometry(0.115, 0.115, 0.28, 12);
    if (provision.shape === 'loaf') geometry.scale(1.5, 0.7, 0.85);
    if (provision.shape === 'sausage') geometry.rotateZ(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: provision.color, roughness: 0.8 });
    resources.own(geometry, material);
    const food = new THREE.Mesh(geometry, material);
    food.position.set(provision.x, provision.y, 0.04);
    food.castShadow = food.receiveShadow = true;
    pantry.add(food);
    register(food, {
      name: getItemName(provision.id),
      getName: () => getItemName(provision.id),
      desc: t('prop.pantryFoodDesc'),
      getDesc: () => t('prop.pantryFoodDesc'),
      pickupItemId: provision.id,
      getPickupLabel: () => t('prop.pantryTake'),
      radius: 0.2,
    });
  }
}

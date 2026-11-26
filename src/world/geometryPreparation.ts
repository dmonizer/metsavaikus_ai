import * as THREE from 'three';

type VertexColors =
  | { mode: 'white' }
  | { mode: 'solid'; color: THREE.Color }
  | { mode: 'height-gradient'; bottom: THREE.Color; top: THREE.Color };

export interface GeometryPreparationOptions {
  colors?: VertexColors;
  /** reuse retains indexed input and reuses non-indexed input; copy leaves input untouched.
   * consume disposes indexed input after conversion and transfers output ownership to the caller.
   */
  source?: 'reuse' | 'copy' | 'consume';
}

/** Normalize attributes for geometry batching, preserving existing normals, UVs and colors. */
export function prepareGeometry(
  geometry: THREE.BufferGeometry,
  options: GeometryPreparationOptions = {}
): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed()
    : options.source === 'copy' ? geometry.clone() : geometry;
  if (options.source === 'consume' && g !== geometry) geometry.dispose();
  if (!g.attributes.normal) g.computeVertexNormals();
  const position = g.attributes.position;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
  const policy = options.colors;
  if (policy && !g.attributes.color) {
    const colors = new Float32Array(position.count * 3);
    if (policy.mode === 'white') {
      colors.fill(1);
    } else if (policy.mode === 'solid') {
      for (let i = 0; i < position.count; i++) {
        colors[i * 3] = policy.color.r;
        colors[i * 3 + 1] = policy.color.g;
        colors[i * 3 + 2] = policy.color.b;
      }
    } else {
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < position.count; i++) {
        minY = Math.min(minY, position.getY(i));
        maxY = Math.max(maxY, position.getY(i));
      }
      const span = Math.max(0.01, maxY - minY);
      for (let i = 0; i < position.count; i++) {
        const t = Math.min(1, Math.max(0, (position.getY(i) - minY) / span));
        colors[i * 3] = policy.bottom.r + (policy.top.r - policy.bottom.r) * t;
        colors[i * 3 + 1] = policy.bottom.g + (policy.top.g - policy.bottom.g) * t;
        colors[i * 3 + 2] = policy.bottom.b + (policy.top.b - policy.bottom.b) * t;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return g;
}

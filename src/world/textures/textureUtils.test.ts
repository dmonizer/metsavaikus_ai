import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bleedAlphaMargins, createTextureFactoryScope } from './textureUtils';

function createFakeCanvas(pixelCount = 4): {
  canvas: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
} {
  const pixels = new Uint8ClampedArray(pixelCount * 4);
  const ctx = {
    canvas: null as unknown as HTMLCanvasElement,
    getImageData: () => ({ data: pixels, width: pixelCount, height: 1 }),
    putImageData: () => {},
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: pixelCount,
    height: 1,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  (ctx as { canvas: HTMLCanvasElement }).canvas = canvas;
  return { canvas, pixels };
}

describe('textureUtils & TextureFactoryScope (#10)', () => {
  it('bleeds RGB into transparent pixels without altering opaque alpha margins', () => {
    const { pixels } = createFakeCanvas(2);
    // Pixel 0: alpha 0 (transparent fringe)
    pixels[0] = 0;
    pixels[1] = 0;
    pixels[2] = 0;
    pixels[3] = 0;
    // Pixel 1: alpha 200 (opaque leaf)
    pixels[4] = 90;
    pixels[5] = 140;
    pixels[6] = 45;
    pixels[7] = 200;

    const fakeCtx = {
      getImageData: () => ({ data: pixels, width: 2, height: 1 }),
      putImageData: () => {},
    } as unknown as CanvasRenderingContext2D;

    bleedAlphaMargins(fakeCtx, 2, 1, [64, 102, 34]);
    assert.deepEqual(Array.from(pixels.slice(0, 4)), [64, 102, 34, 0]);
    assert.deepEqual(Array.from(pixels.slice(4, 8)), [90, 140, 45, 200]);
  });

  it('tracks every created texture, clamps anisotropy, and disposes all owned textures', () => {
    const prevDoc = (globalThis as { document?: unknown }).document;
    const { canvas } = createFakeCanvas(2);
    (globalThis as { document: unknown }).document = {
      createElement: () => canvas,
    };

    try {
      const disposed: THREE.CanvasTexture[] = [];
      const scope = createTextureFactoryScope(16, (c) => {
        const tex = new THREE.CanvasTexture(c);
        const origDispose = tex.dispose.bind(tex);
        tex.dispose = () => {
          disposed.push(tex);
          origDispose();
        };
        return tex;
      });
      assert.equal(scope.aniso, 8);

      const t1 = scope.makeCanvasTex(2, 2, () => {}, {
        repeatX: 3,
        repeatY: 2,
        anisotropy: scope.aniso,
      });
      const t2 = scope.makeCanvasTex(2, 2, () => {}, {
        clamp: true,
        srgb: false,
      });

      assert.equal(t1.wrapS, THREE.RepeatWrapping);
      assert.equal(t1.repeat.x, 3);
      assert.equal(t1.repeat.y, 2);
      assert.equal(t1.colorSpace, THREE.SRGBColorSpace);
      assert.equal(t1.anisotropy, 8);

      assert.equal(t2.wrapS, THREE.ClampToEdgeWrapping);
      assert.equal(t2.wrapT, THREE.ClampToEdgeWrapping);
      assert.equal(t2.colorSpace, THREE.NoColorSpace);

      scope.disposeAll();
      assert.equal(disposed.length, 2);
      assert.ok(disposed.includes(t1));
      assert.ok(disposed.includes(t2));
    } finally {
      if (prevDoc === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = prevDoc;
      }
    }
  });
});

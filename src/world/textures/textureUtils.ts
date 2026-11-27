import * as THREE from 'three';

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      const label = url.length > 96 ? `${url.slice(0, 96)}...` : url;
      reject(new Error(`Failed to load texture image: ${label}`));
    };
    img.src = url;
  });
}

/**
 * Fills transparent pixels (alpha < 14) with matching RGB bleed color
 * so WebGL mipmapping never produces dark fringes on alpha-tested foliage.
 */
export function bleedAlphaMargins(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rgb: [number, number, number]
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 14) {
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
    }
  }
  ctx.putImageData(img, 0, 0);
}

export interface CanvasTexOptions {
  repeatX?: number;
  repeatY?: number;
  srgb?: boolean;
  clamp?: boolean;
  anisotropy?: number;
  bleedRgb?: [number, number, number];
}

export interface PhotoTexOptions {
  repeatX?: number;
  repeatY?: number;
  anisotropy?: number;
  brightnessBoost?: number;
  saturation?: number;
}

export interface TextureFactoryScope {
  readonly aniso: number;
  makeCanvasTex: (
    w: number,
    h: number,
    drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    opts?: CanvasTexOptions
  ) => THREE.CanvasTexture;
  makePhotoTex: (
    img: HTMLImageElement,
    w: number,
    h: number,
    opts?: PhotoTexOptions
  ) => THREE.CanvasTexture;
  makeSobelNormalTex: (
    source: HTMLImageElement | HTMLCanvasElement,
    w: number,
    h: number,
    strength: number,
    opts?: { repeatX?: number; repeatY?: number; clamp?: boolean }
  ) => THREE.CanvasTexture;
  disposeAll: () => void;
}

export function createTextureFactoryScope(
  maxAnisotropy: number,
  createTexture: (canvas: HTMLCanvasElement) => THREE.CanvasTexture = (c) =>
    new THREE.CanvasTexture(c)
): TextureFactoryScope {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));
  const createdTextures: THREE.Texture[] = [];

  const makeCanvasTex: TextureFactoryScope['makeCanvasTex'] = (w, h, drawFn, opts = {}) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    drawFn(ctx, w, h);
    if (opts.bleedRgb) {
      bleedAlphaMargins(ctx, w, h, opts.bleedRgb);
    }
    const tex = createTexture(c);
    createdTextures.push(tex);
    if (opts.clamp) {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(opts.repeatX ?? 1, opts.repeatY ?? 1);
    }
    tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (opts.anisotropy) {
      tex.anisotropy = opts.anisotropy;
    }
    tex.needsUpdate = true;
    return tex;
  };

  const makePhotoTex: TextureFactoryScope['makePhotoTex'] = (img, w, h, opts = {}) => {
    return makeCanvasTex(
      w,
      h,
      (ctx) => {
        ctx.drawImage(img, 0, 0, w, h);
        const boost = opts.brightnessBoost ?? 1;
        const sat = opts.saturation ?? 1;
        if (boost !== 1 || sat !== 1) {
          const data = ctx.getImageData(0, 0, w, h);
          const p = data.data;
          for (let i = 0; i < p.length; i += 4) {
            let r = p[i] * boost;
            let g = p[i + 1] * boost;
            let b = p[i + 2] * boost;
            if (sat !== 1) {
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              r = lum + (r - lum) * sat;
              g = lum + (g - lum) * sat;
              b = lum + (b - lum) * sat;
            }
            p[i] = Math.max(0, Math.min(255, Math.round(r)));
            p[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
            p[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
          }
          ctx.putImageData(data, 0, 0);
        }
      },
      {
        repeatX: opts.repeatX ?? 1,
        repeatY: opts.repeatY ?? 1,
        srgb: true,
        anisotropy: opts.anisotropy,
      }
    );
  };

  const makeSobelNormalTex: TextureFactoryScope['makeSobelNormalTex'] = (
    source,
    w,
    h,
    strength,
    opts = {}
  ) => {
    return makeCanvasTex(
      w,
      h,
      (ctx) => {
        ctx.drawImage(source, 0, 0, w, h);
        const src = ctx.getImageData(0, 0, w, h);
        const sp = src.data;
        const lum = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const o = i * 4;
          lum[i] = (0.299 * sp[o] + 0.587 * sp[o + 1] + 0.114 * sp[o + 2]) / 255;
        }

        const out = ctx.createImageData(w, h);
        const op = out.data;
        const wrapX = (x: number) => (opts.clamp ? Math.max(0, Math.min(w - 1, x)) : (x + w) % w);
        const wrapY = (y: number) => (opts.clamp ? Math.max(0, Math.min(h - 1, y)) : (y + h) % h);

        for (let y = 0; y < h; y++) {
          const ym = wrapY(y - 1) * w;
          const yc = y * w;
          const yp = wrapY(y + 1) * w;
          for (let x = 0; x < w; x++) {
            const xm = wrapX(x - 1);
            const xp = wrapX(x + 1);

            const tl = lum[ym + xm];
            const tc = lum[ym + x];
            const tr = lum[ym + xp];
            const ml = lum[yc + xm];
            const mr = lum[yc + xp];
            const bl = lum[yp + xm];
            const bc = lum[yp + x];
            const br = lum[yp + xp];

            const dx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * strength;
            const dy = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * strength;
            const dz = 1.0;
            const inv = 1 / Math.hypot(dx, dy, dz);

            const idx = (yc + x) * 4;
            op[idx] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
            op[idx + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
            op[idx + 2] = Math.round((dz * inv * 0.5 + 0.5) * 255);
            op[idx + 3] = 255;
          }
        }
        ctx.putImageData(out, 0, 0);
      },
      {
        repeatX: opts.repeatX ?? 1,
        repeatY: opts.repeatY ?? 1,
        clamp: opts.clamp,
        srgb: false,
      }
    );
  };

  return {
    aniso,
    makeCanvasTex,
    makePhotoTex,
    makeSobelNormalTex,
    disposeAll: () => {
      for (const tex of createdTextures) {
        tex.dispose();
      }
      createdTextures.length = 0;
    },
  };
}

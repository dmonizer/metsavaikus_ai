import * as THREE from 'three';

import logWeatheredUrl from '../assets/textures/log_weathered.jpg';
import logWarmUrl from '../assets/textures/log_warm.jpg';
import gableBoardsUrl from '../assets/textures/gable_boards.jpg';
import thatchMossyUrl from '../assets/textures/thatch_mossy.jpg';
import roofShingleUrl from '../assets/textures/roof_shingle.jpg';
import fieldstoneUrl from '../assets/textures/fieldstone.jpg';
import pineBarkUrl from '../assets/textures/pine_bark.jpg';
import plankWoodUrl from '../assets/textures/plank_wood.jpg';
import forestFloorUrl from '../assets/textures/forest_floor.jpg';
import trailNeedlesUrl from '../assets/textures/trail_needles.jpg';
import boleteCapUrl from '../assets/textures/bolete_cap.jpg';
import boleteStemUrl from '../assets/textures/bolete_stem.jpg';
import meadowGrassUrl from '../assets/textures/meadow_grass.jpg';
import leafPatchUrl from '../assets/textures/leaf_patch.jpg';
import spruceFoliageUrl from '../assets/textures/spruce_foliage.jpg';

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

/**
 * Fills transparent pixels (alpha < 14) with matching RGB bleed color
 * so WebGL mipmapping never produces dark fringes on alpha-tested foliage.
 */
function bleedAlphaMargins(
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

function makeCanvasTex(
  w: number,
  h: number,
  drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: {
    repeatX?: number;
    repeatY?: number;
    srgb?: boolean;
    clamp?: boolean;
    anisotropy?: number;
    bleedRgb?: [number, number, number];
  } = {}
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  drawFn(ctx, w, h);
  if (opts.bleedRgb) {
    bleedAlphaMargins(ctx, w, h, opts.bleedRgb);
  }
  const tex = new THREE.CanvasTexture(c);
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
}

function makePhotoTex(
  img: HTMLImageElement,
  w: number,
  h: number,
  opts: {
    repeatX?: number;
    repeatY?: number;
    anisotropy?: number;
    brightnessBoost?: number;
    saturation?: number;
  } = {}
): THREE.CanvasTexture {
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
}

/**
 * Generates a true tangent-space normal map from an image or canvas using a 3x3 Sobel filter.
 * Runs once at startup on small/medium buffers (< 4ms total), giving PBR surfaces deep tactile relief at 0 CPU cost per frame.
 */
function makeSobelNormalTex(
  source: HTMLImageElement | HTMLCanvasElement,
  w: number,
  h: number,
  strength: number,
  opts: { repeatX?: number; repeatY?: number; clamp?: boolean } = {}
): THREE.CanvasTexture {
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
}

export interface WorldTextures {
  birchBark: THREE.CanvasTexture;
  birchNormal: THREE.CanvasTexture;
  pineBark: THREE.CanvasTexture;
  pineNormal: THREE.CanvasTexture;
  spruceBark: THREE.CanvasTexture;
  logWallWeathered: THREE.CanvasTexture;
  logWallWarm: THREE.CanvasTexture;
  logWallNormal: THREE.CanvasTexture;
  gableBoards: THREE.CanvasTexture;
  thatchRoofMossy: THREE.CanvasTexture;
  thatchNormal: THREE.CanvasTexture;
  roofShingle: THREE.CanvasTexture;
  shingleNormal: THREE.CanvasTexture;
  fieldstone: THREE.CanvasTexture;
  fieldstoneNormal: THREE.CanvasTexture;
  plankWood: THREE.CanvasTexture;
  plankNormal: THREE.CanvasTexture;
  groundDetail: THREE.CanvasTexture;
  groundNormal: THREE.CanvasTexture;
  terrainForestTex: THREE.CanvasTexture;
  terrainMeadowTex: THREE.CanvasTexture;
  terrainRoadTex: THREE.CanvasTexture;
  boulderGranite: THREE.CanvasTexture;
  boleteCap: THREE.CanvasTexture;
  boleteNormal: THREE.CanvasTexture;
  boleteStem: THREE.CanvasTexture;
  birchBoleteStem: THREE.CanvasTexture;
  chanterelleTex: THREE.CanvasTexture;
  saffronCapTex: THREE.CanvasTexture;
  flyAgaricCap: THREE.CanvasTexture;
  flyAgaricNormal: THREE.CanvasTexture;
  destroyingAngelCap: THREE.CanvasTexture;
  amanitaGills: THREE.CanvasTexture;
  birchLeafCard: THREE.CanvasTexture;
  bushLeafCard: THREE.CanvasTexture;
  pineNeedleCard: THREE.CanvasTexture;
  spruceBoughCard: THREE.CanvasTexture;
  fernFrondCard: THREE.CanvasTexture;
  grassClumpCard: THREE.CanvasTexture;
  bogMistTex: THREE.CanvasTexture;
  contactShadowTex: THREE.CanvasTexture;
  dispose: () => void;
}

export async function createWorldTextures(maxAnisotropy: number): Promise<WorldTextures> {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  const [
    imgLogWeathered,
    imgLogWarm,
    imgGableBoards,
    imgThatchMossy,
    imgRoofShingle,
    imgFieldstone,
    imgPineBark,
    imgPlankWood,
    imgForestFloor,
    imgTrailNeedles,
    imgBoleteCap,
    imgBoleteStem,
    imgMeadowGrass,
    imgLeafPatch,
    imgSpruceFoliage,
  ] = await Promise.all([
    loadImage(logWeatheredUrl),
    loadImage(logWarmUrl),
    loadImage(gableBoardsUrl),
    loadImage(thatchMossyUrl),
    loadImage(roofShingleUrl),
    loadImage(fieldstoneUrl),
    loadImage(pineBarkUrl),
    loadImage(plankWoodUrl),
    loadImage(forestFloorUrl),
    loadImage(trailNeedlesUrl),
    loadImage(boleteCapUrl),
    loadImage(boleteStemUrl),
    loadImage(meadowGrassUrl),
    loadImage(leafPatchUrl),
    loadImage(spruceFoliageUrl),
  ]);

  // 1. Silver Birch Bark (organic creamy papery white bark with dark fissures, peeling strips & lenticels)
  const birchBark = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(101);
      const baseGrad = ctx.createLinearGradient(0, 0, w, 0);
      baseGrad.addColorStop(0, '#dad4c8');
      baseGrad.addColorStop(0.45, '#e8e3d8');
      baseGrad.addColorStop(0.85, '#d5cec0');
      baseGrad.addColorStop(1, '#dad4c8');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, w, h);

      // Horizontal papery peel bands
      for (let i = 0; i < 240; i++) {
        const y = rand() * h;
        const x = rand() * w;
        const bw = 28 + rand() * 110;
        const bh = 2 + rand() * 9;
        ctx.fillStyle =
          rand() > 0.55
            ? 'rgba(255,252,244,0.36)'
            : rand() > 0.5
              ? 'rgba(148,136,120,0.24)'
              : 'rgba(180,152,126,0.22)';
        ctx.fillRect(x, y, bw, bh);
      }
      // Characteristic dark horizontal lenticels & diamond bark knots
      for (let i = 0; i < 290; i++) {
        const y = rand() * h;
        const x = rand() * w;
        const lw = 10 + rand() * 58;
        const lh = 1.5 + rand() * 5.2;
        ctx.fillStyle = rand() > 0.25 ? '#26231f' : '#5f5950';
        ctx.beginPath();
        ctx.ellipse(x, y, lw * 0.5, lh * 0.5, (rand() - 0.5) * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      // Deep dark lichen/cracked knots
      for (let i = 0; i < 26; i++) {
        const x = rand() * w;
        const y = rand() * h;
        ctx.fillStyle = 'rgba(34,31,26,0.88)';
        ctx.beginPath();
        ctx.ellipse(x, y, 8 + rand() * 18, 4 + rand() * 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeatX: 1, repeatY: 2, anisotropy: aniso }
  );
  const birchNormal = makeSobelNormalTex(birchBark.image as HTMLCanvasElement, 256, 256, 2.2, {
    repeatX: 1,
    repeatY: 2,
  });

  // 2. Real Photo-Derived Scots Pine & Norway Spruce Bark + Sobel Normal Maps
  const pineBark = makePhotoTex(imgPineBark, 256, 512, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 1.48,
    saturation: 1.12,
  });
  const pineNormal = makeSobelNormalTex(imgPineBark, 256, 256, 3.2, {
    repeatX: 1,
    repeatY: 3,
  });
  const spruceBark = makePhotoTex(imgPineBark, 256, 256, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 0.78,
    saturation: 0.72,
  });

  // 3. Heritage Estonian Architecture Textures (Matched to large_house & sauna_house photos + Sobel Normals)
  const logWallWeathered = makePhotoTex(imgLogWeathered, 512, 512, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.86,
    saturation: 0.92,
  });
  const logWallWarm = makePhotoTex(imgLogWarm, 512, 512, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.9,
    saturation: 1.06,
  });
  const logWallNormal = makeSobelNormalTex(imgLogWeathered, 256, 256, 3.4, {
    repeatX: 2,
    repeatY: 1,
  });
  const gableBoards = makePhotoTex(imgGableBoards, 256, 256, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.88,
  });
  const thatchRoofMossy = makePhotoTex(imgThatchMossy, 512, 512, {
    repeatX: 3,
    repeatY: 2,
    anisotropy: aniso,
    brightnessBoost: 0.92,
    saturation: 1.12,
  });
  const thatchNormal = makeSobelNormalTex(imgThatchMossy, 256, 256, 3.8, {
    repeatX: 3,
    repeatY: 2,
  });
  const roofShingle = makePhotoTex(imgRoofShingle, 512, 512, {
    repeatX: 3,
    repeatY: 2,
    anisotropy: aniso,
    brightnessBoost: 0.88,
  });
  const shingleNormal = makeSobelNormalTex(imgRoofShingle, 256, 256, 3.2, {
    repeatX: 3,
    repeatY: 2,
  });
  const fieldstone = makePhotoTex(imgFieldstone, 256, 256, {
    repeatX: 4,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.96,
  });
  const fieldstoneNormal = makeSobelNormalTex(imgFieldstone, 256, 256, 3.6, {
    repeatX: 4,
    repeatY: 1,
  });
  const plankWood = makePhotoTex(imgPlankWood, 256, 256, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 0.94,
  });
  const plankNormal = makeSobelNormalTex(imgPlankWood, 256, 256, 2.6, {
    repeatX: 1,
    repeatY: 3,
  });

  // 4. High-Pass Organic Forest Floor + Pine-Needle Detail Texture & Normal Map
  const groundDetail = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      ctx.drawImage(imgForestFloor, 0, 0, w, h);
      // Subtly blend crisp pine-needle trail litter for rich micro-texture
      ctx.globalAlpha = 0.28;
      ctx.drawImage(imgTrailNeedles, 0, 0, w, h);
      ctx.globalAlpha = 1.0;

      const srcData = ctx.getImageData(0, 0, w, h);
      const p = srcData.data;

      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = 48;
      blurCanvas.height = 48;
      const bCtx = blurCanvas.getContext('2d')!;
      bCtx.drawImage(ctx.canvas, 0, 0, 48, 48);
      const lowCanvas = document.createElement('canvas');
      lowCanvas.width = w;
      lowCanvas.height = h;
      const lCtx = lowCanvas.getContext('2d')!;
      lCtx.drawImage(blurCanvas, 0, 0, w, h);
      const lp = lCtx.getImageData(0, 0, w, h).data;

      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        const lowLum = 0.299 * lp[i] + 0.587 * lp[i + 1] + 0.114 * lp[i + 2];
        const highFreq = lum - lowLum;
        const val = Math.max(108, Math.min(244, Math.round(182 + highFreq * 1.45)));
        const rOff = (p[i] - lp[i]) * 0.5;
        const gOff = (p[i + 1] - lp[i + 1]) * 0.5;
        const bOff = (p[i + 2] - lp[i + 2]) * 0.5;
        p[i] = Math.max(96, Math.min(248, Math.round(val + rOff)));
        p[i + 1] = Math.max(102, Math.min(248, Math.round(val + gOff)));
        p[i + 2] = Math.max(92, Math.min(240, Math.round(val + bOff)));
      }
      ctx.putImageData(srcData, 0, 0);
    },
    { repeatX: 12, repeatY: 12, anisotropy: aniso }
  );
  const groundNormal = makeSobelNormalTex(groundDetail.image as HTMLCanvasElement, 256, 256, 3.2, {
    repeatX: 12,
    repeatY: 12,
  });

  // Full-color photographic biome splat maps (preserve authentic Baltic color, contrast & micro-litter!)
  const terrainForestTex = makePhotoTex(imgForestFloor, 512, 512, {
    repeatX: 1,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 1.06,
    saturation: 1.08,
  });
  const terrainMeadowTex = makePhotoTex(imgMeadowGrass, 512, 512, {
    repeatX: 1,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 1.04,
    saturation: 1.06,
  });
  const terrainRoadTex = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(477);
      // Base real Estonian trail & crushed limestone gravel tone
      ctx.drawImage(imgTrailNeedles, 0, 0, w, h);
      ctx.fillStyle = 'rgba(136,128,114,0.44)';
      ctx.fillRect(0, 0, w, h);
      // Fine photographic limestone gravel pebbles & sand grains
      for (let i = 0; i < 1800; i++) {
        const px = rand() * w;
        const py = rand() * h;
        const r = 1.0 + rand() * 2.8;
        const v = 98 + Math.floor(rand() * 92);
        ctx.fillStyle =
          rand() > 0.35
            ? `rgba(${v},${v - 3},${v - 9},0.48)`
            : `rgba(${Math.max(45, v - 50)},${Math.max(42, v - 54)},${Math.max(36, v - 58)},0.45)`;
        ctx.beginPath();
        ctx.ellipse(px, py, r * 1.25, r * 0.85, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      // Subtle scattered fallen pine needles on the road shoulder
      for (let i = 0; i < 140; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        ctx.strokeStyle = 'rgba(110,76,42,0.38)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * (8 + rand() * 12), y + Math.sin(a) * (8 + rand() * 12));
        ctx.stroke();
      }
    },
    { repeatX: 1, repeatY: 1, anisotropy: aniso }
  );

  const boulderGranite = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      ctx.drawImage(imgFieldstone, 0, 0, w, h);
      ctx.fillStyle = 'rgba(72,78,66,0.32)';
      ctx.fillRect(0, 0, w, h);
    },
    { repeatX: 2, repeatY: 2, anisotropy: aniso }
  );

  // 5. Photorealistic Mushroom Textures (All 7 Estonian Species!)
  const boleteCap = makePhotoTex(imgBoleteCap, 256, 256, {
    anisotropy: aniso,
    brightnessBoost: 0.88,
    saturation: 1.08,
  });
  const boleteNormal = makeSobelNormalTex(imgBoleteCap, 256, 256, 2.1, { clamp: true });
  const boleteStem = makePhotoTex(imgBoleteStem, 256, 256, {
    anisotropy: aniso,
    brightnessBoost: 1.04,
  });

  // Birch bolete (Kasepuravik) speckled charcoal-scaber stipe
  const birchBoleteStem = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(511);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ebe6da');
      g.addColorStop(0.7, '#d8d2c4');
      g.addColorStop(1, '#aea594');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 650; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const dark = rand() > 0.3;
        ctx.fillStyle = dark ? 'rgba(42,38,34,0.82)' : 'rgba(92,84,74,0.55)';
        ctx.beginPath();
        ctx.ellipse(x, y, 1.5 + rand() * 3.5, 3 + rand() * 7.5, (rand() - 0.5) * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { anisotropy: aniso }
  );

  // Chanterelle (Kukeseen) golden egg-yolk cap & forked decurrent false-gill ridges
  const chanterelleTex = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(512);
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#f3d168');
      grad.addColorStop(0.5, '#f0ad28');
      grad.addColorStop(1, '#df8412');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Fine decurrent ridges running up the funnel
      for (let x = 0; x < w; x += 5) {
        ctx.strokeStyle = x % 10 === 0 ? 'rgba(176,92,8,0.38)' : 'rgba(255,226,130,0.34)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.bezierCurveTo(x + (rand() - 0.5) * 8, h * 0.65, x + (rand() - 0.5) * 10, h * 0.3, x, 0);
        ctx.stroke();
      }
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,236,155,0.16)' : 'rgba(165,86,12,0.14)';
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, 2 + rand() * 8, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { anisotropy: aniso }
  );

  // Saffron Milk Cap (Kuuseriisikas) concentric zoned carrot-orange rings + subtle green bruising
  const saffronCapTex = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(513);
      ctx.fillStyle = '#dc6c24';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        const band = Math.sin((y / h) * Math.PI * 12) * 0.5 + 0.5;
        ctx.fillStyle =
          band > 0.55
            ? `rgba(182,66,18,${(band - 0.4) * 0.55})`
            : `rgba(246,156,74,${(0.6 - band) * 0.45})`;
        ctx.fillRect(0, y, w, 2);
      }
      // Authentic verdigris-green milk-cap stains
      for (let i = 0; i < 16; i++) {
        const bx = rand() * w;
        const by = rand() * h;
        const br = 8 + rand() * 18;
        const g = ctx.createRadialGradient(bx, by, 1, bx, by, br);
        g.addColorStop(0, 'rgba(66,124,84,0.42)');
        g.addColorStop(1, 'rgba(66,124,84,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { anisotropy: aniso }
  );

  // Punane kärbseseen (Amanita muscaria) — Rich glossy ruby-to-scarlet-orange cap with striated rim & delicate cuticle speckles
  const flyAgaricCap = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(514);
      // UV.y = 1 at sphere top pole (center of cap), UV.y = 0 at rim
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#8d110a'); // Deep glossy crimson-ruby crown
      grad.addColorStop(0.35, '#bd190e'); // Rich iconic Amanita scarlet
      grad.addColorStop(0.75, '#d62c12'); // Warm vermilion mid-cap
      grad.addColorStop(0.92, '#e35518'); // Sunlit orange-scarlet rim
      grad.addColorStop(1.0, '#ec7c26'); // Pale translucent striated edge
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Subtle mottled organic cuticle pigment depth
      for (let i = 0; i < 320; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const rx = 6 + rand() * 26;
        const ry = 4 + rand() * 18;
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,140,56,0.08)' : 'rgba(92,8,4,0.12)';
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fine radial margin striations at the very bottom rim (characteristic of Amanita muscaria)
      for (let x = 0; x < w; x += 4) {
        ctx.strokeStyle = x % 8 === 0 ? 'rgba(96,12,6,0.34)' : 'rgba(255,186,98,0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.84);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Tiny pale veil dust & flecks scattered around wart zones (complements 3D sculpted warts)
      for (let i = 0; i < 75; i++) {
        const x = rand() * w;
        const y = 18 + Math.pow(rand(), 0.78) * (h * 0.78);
        const r = 1.4 + rand() * 3.6;
        ctx.fillStyle = 'rgba(246,238,214,0.68)';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.2, r * 0.85, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { anisotropy: aniso }
  );
  const flyAgaricNormal = makeSobelNormalTex(flyAgaricCap.image as HTMLCanvasElement, 256, 256, 1.5);

  // Valge kärbseseen (Amanita virosa — Destroying Angel) — Silky porcelain-ivory cap with warm cream-ochre apex
  const destroyingAngelCap = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(515);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#eae1cd'); // Delicate warm ivory-ochre apex
      grad.addColorStop(0.32, '#f5f2e9'); // Pure silky porcelain white
      grad.addColorStop(0.85, '#faf9f4'); // Bright chalk-white margin
      grad.addColorStop(1.0, '#efece3');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Silky radial sheen fibers
      for (let x = 0; x < w; x += 3) {
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,252,0.28)' : 'rgba(196,188,172,0.16)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rand() - 0.5) * 4, h);
        ctx.stroke();
      }
      // Subtle forest-floor dirt flecks near rim
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = 'rgba(138,124,102,0.16)';
        ctx.beginPath();
        ctx.arc(rand() * w, h * (0.45 + rand() * 0.52), 1 + rand() * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { anisotropy: aniso }
  );

  // Delicate crowded radial white-cream gill lamellae for Amanita undersides
  const amanitaGills = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const rMax = w * 0.49;
      ctx.fillStyle = '#efeae0';
      ctx.fillRect(0, 0, w, h);
      const radGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rMax);
      radGrad.addColorStop(0, '#cfc8ba');
      radGrad.addColorStop(0.35, '#ebe6da');
      radGrad.addColorStop(0.92, '#f6f3eb');
      radGrad.addColorStop(1, '#ded7c8');
      ctx.fillStyle = radGrad;
      ctx.fillRect(0, 0, w, h);

      const gillCount = 72;
      for (let i = 0; i < gillCount; i++) {
        const a = (i / gillCount) * Math.PI * 2;
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(146,136,120,0.48)' : 'rgba(176,166,150,0.34)';
        ctx.lineWidth = i % 2 === 0 ? 1.5 : 1.0;
        const rStart = i % 2 === 0 ? rMax * 0.14 : rMax * 0.42;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rStart, cy + Math.sin(a) * rStart);
        ctx.lineTo(cx + Math.cos(a) * rMax, cy + Math.sin(a) * rMax);
        ctx.stroke();
      }
    },
    { clamp: true, anisotropy: aniso }
  );

  // 6. High-Resolution 512x512 Photographic Botanical Sprig Textures (Zero Alpha Halo!)
  const leafPatternCanvas = document.createElement('canvas');
  leafPatternCanvas.width = 256;
  leafPatternCanvas.height = 256;
  leafPatternCanvas.getContext('2d')!.drawImage(imgLeafPatch, 0, 0, 256, 256);

  const sprucePatternCanvas = document.createElement('canvas');
  sprucePatternCanvas.width = 256;
  sprucePatternCanvas.height = 256;
  sprucePatternCanvas.getContext('2d')!.drawImage(imgSpruceFoliage, 0, 0, 256, 256);

  const grassPatternCanvas = document.createElement('canvas');
  grassPatternCanvas.width = 256;
  grassPatternCanvas.height = 256;
  grassPatternCanvas.getContext('2d')!.drawImage(imgMeadowGrass, 0, 0, 256, 256);

  // Silver Birch Twig & Serrated Leaf Spray (512x512)
  const birchLeafCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(301);
      ctx.clearRect(0, 0, w, h);
      const leafPat = ctx.createPattern(leafPatternCanvas, 'repeat')!;

      // Fine drooping birch catkins/twigs
      ctx.strokeStyle = '#3a2d20';
      ctx.lineCap = 'round';
      const twigs = [
        [256, 502, 256, 48, 6.2],
        [256, 424, 92, 146, 4.2],
        [256, 396, 422, 152, 4.2],
        [256, 290, 114, 72, 3.4],
        [256, 260, 396, 80, 3.4],
        [168, 286, 44, 244, 2.8],
        [346, 276, 468, 248, 2.8],
        [176, 178, 86, 102, 2.2],
        [334, 174, 426, 98, 2.2],
      ];
      for (const [x0, y0, x1, y1, lw] of twigs) {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + x1) * 0.5 + (rand() - 0.5) * 32, (y0 + y1) * 0.5, x1, y1);
        ctx.stroke();
      }

      // 255 crisp airy serrated birch leaves with sunlit chartreuse tips & sky-filtering micro-gaps
      for (let i = 0; i < 255; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = Math.pow(rand(), 0.58) * 224;
        const cx = 256 + Math.cos(angle) * dist * 1.02;
        const cy = 246 + Math.sin(angle) * dist * 0.94;
        if (cx < 20 || cx > w - 20 || cy < 20 || cy > h - 22) continue;
        const leafLen = 19 + rand() * 21;
        const leafWid = leafLen * (0.64 + rand() * 0.22);
        const rot = angle + (rand() - 0.5) * 0.95;
        const outer = dist > 112;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.fillStyle = leafPat;
        ctx.beginPath();
        ctx.moveTo(0, -leafLen * 0.56);
        ctx.quadraticCurveTo(leafWid * 0.84, -leafLen * 0.04, 0, leafLen * 0.56);
        ctx.quadraticCurveTo(-leafWid * 0.84, -leafLen * 0.04, 0, -leafLen * 0.56);
        ctx.fill();

        // Depth AO: rich mid-emerald inner leaves, bright sunlit golden-lime outer birch leaves
        ctx.fillStyle = outer
          ? rand() > 0.35
            ? 'rgba(176,214,82,0.34)'
            : 'rgba(104,148,48,0.2)'
          : 'rgba(28,58,22,0.32)';
        ctx.fill();

        // Delicate central midrib highlight
        ctx.strokeStyle = 'rgba(202,232,118,0.32)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(0, -leafLen * 0.42);
        ctx.lineTo(0, leafLen * 0.42);
        ctx.stroke();
        ctx.restore();
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [86, 126, 48] }
  );

  // Dense Woodland Hazel / Alder Bush Spray (512x512)
  const bushLeafCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(309);
      ctx.clearRect(0, 0, w, h);
      const leafPat = ctx.createPattern(leafPatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#34271c';
      ctx.lineCap = 'round';
      for (let b = 0; b < 9; b++) {
        const bx = 256 + (b - 4) * 52 + (rand() - 0.5) * 20;
        ctx.lineWidth = 5.0;
        ctx.beginPath();
        ctx.moveTo(256, 502);
        ctx.quadraticCurveTo((256 + bx) * 0.5, 330, bx, 86 + rand() * 88);
        ctx.stroke();
      }
      for (let i = 0; i < 340; i++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.pow(rand(), 0.52) * 224;
        const cx = 256 + Math.cos(ang) * rad;
        const cy = 268 + Math.sin(ang) * rad * 0.86;
        if (cx < 20 || cx > w - 20 || cy < 24 || cy > h - 20) continue;
        const leafLen = 26 + rand() * 26;
        const leafWid = leafLen * 0.78;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang + (rand() - 0.5) * 1.1);
        ctx.fillStyle = leafPat;
        ctx.beginPath();
        ctx.moveTo(0, -leafLen * 0.52);
        ctx.quadraticCurveTo(leafWid * 0.88, 0, 0, leafLen * 0.56);
        ctx.quadraticCurveTo(-leafWid * 0.88, 0, 0, -leafLen * 0.52);
        ctx.fill();
        ctx.fillStyle =
          rad < 115
            ? 'rgba(20,42,14,0.42)'
            : rand() > 0.45
              ? 'rgba(132,172,54,0.24)'
              : 'rgba(42,74,26,0.22)';
        ctx.fill();
        ctx.restore();
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [62, 98, 34] }
  );

  // Scots Pine Needle Bough Cluster (512x512 — radiating tufts of fine needles on copper-brown branches)
  const pineNeedleCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(302);
      ctx.clearRect(0, 0, w, h);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#683f26';
      ctx.lineCap = 'round';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(256, 492);
      ctx.lineTo(256, 174);
      ctx.moveTo(256, 360);
      ctx.lineTo(86, 176);
      ctx.moveTo(256, 338);
      ctx.lineTo(426, 168);
      ctx.moveTo(166, 266);
      ctx.lineTo(96, 262);
      ctx.moveTo(344, 256);
      ctx.lineTo(422, 260);
      ctx.stroke();

      // Airy sunlit Scots pine needle rosettes (78 clusters instead of solid dark pancake!)
      for (let c = 0; c < 78; c++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.pow(rand(), 0.56) * 204;
        const cx = 256 + Math.cos(ang) * rad;
        const cy = 224 + Math.sin(ang) * rad * 0.86;
        if (cx < 32 || cx > w - 32 || cy < 32 || cy > h - 36) continue;
        const inner = rad < 84;
        for (let n = 0; n < 20; n++) {
          const na = (n / 20) * Math.PI * 2 + rand() * 0.28;
          const nLen = 24 + rand() * 22;
          ctx.strokeStyle = spPat;
          ctx.lineWidth = 2.8;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(na) * nLen, cy + Math.sin(na) * nLen);
          ctx.stroke();

          ctx.strokeStyle = inner
            ? 'rgba(24,48,22,0.34)'
            : rand() > 0.42
              ? 'rgba(128,168,78,0.34)'
              : 'rgba(56,94,42,0.22)';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [58, 92, 44] }
  );

  // Norway Spruce Feathered Bough (512x512 — dense drooping spruce branches matching kukeseened_metsas.jpg)
  const spruceBoughCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(303);
      ctx.clearRect(0, 0, w, h);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#3a291e';
      ctx.lineCap = 'round';
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(256, 496);
      ctx.lineTo(256, 36);
      ctx.stroke();

      for (let y = 466; y >= 42; y -= 14) {
        const span = Math.sin(((470 - y) / 430) * Math.PI * 0.86) * 214 + 42;
        for (const side of [-1, 1]) {
          const ex = 256 + side * span;
          const ey = y - 26 - rand() * 18;
          ctx.strokeStyle = '#33241a';
          ctx.lineWidth = 3.8;
          ctx.beginPath();
          ctx.moveTo(256, y);
          ctx.lineTo(ex, ey);
          ctx.stroke();

          const steps = 22;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const bx = 256 + (ex - 256) * t;
            const by = y + (ey - y) * t;
            for (let k = -1; k <= 1; k += 2) {
              const nx = bx + k * (14 + rand() * 16);
              const ny = by - (16 + rand() * 18);
              ctx.strokeStyle = spPat;
              ctx.lineWidth = 5.2;
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(nx, ny);
              ctx.stroke();

              ctx.strokeStyle =
                t > 0.72
                  ? 'rgba(84,126,52,0.28)'
                  : t < 0.3
                    ? 'rgba(12,26,12,0.45)'
                    : 'rgba(24,52,22,0.18)';
              ctx.lineWidth = 2.6;
              ctx.stroke();
            }
          }
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [32, 62, 28] }
  );

  // Woodland Fern Frond Card (256x512 — delicate pinnate forest fern matching kukeseened_metsas.jpg)
  const fernFrondCard = makeCanvasTex(
    256,
    512,
    (ctx, w, h) => {
      const rand = seededRand(304);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#476928';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(128, h - 8);
      ctx.lineTo(128, 24);
      ctx.stroke();

      for (let y = h - 54; y >= 28; y -= 14) {
        const progress = (h - 54 - y) / (h - 82);
        const pinnaLen = Math.sin(progress * Math.PI) * 110 + 14;
        for (const side of [-1, 1]) {
          ctx.fillStyle = gPat;
          ctx.beginPath();
          ctx.moveTo(128, y);
          ctx.quadraticCurveTo(128 + side * pinnaLen * 0.58, y - 12, 128 + side * pinnaLen, y - 5);
          ctx.quadraticCurveTo(128 + side * pinnaLen * 0.52, y + 8, 128, y + 6);
          ctx.fill();
          ctx.fillStyle =
            rand() > 0.45 ? 'rgba(116,158,52,0.22)' : 'rgba(28,62,18,0.26)';
          ctx.fill();
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [68, 108, 36] }
  );

  // Photorealistic Multi-Blade Estonian Meadow Grass, Forest Sedge & Wild Clover Clump (512x512)
  const grassClumpCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(317);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;

      // 84 fine gracefully arched individual grass & sedge blades sprouting from a natural clump crown
      for (let i = 0; i < 84; i++) {
        const u = (i + rand()) / 84;
        // Gaussian-like center clustering so outer blades arch out without forming a straight card wall
        const centered = (u + rand()) * 0.5;
        const bx = w * 0.18 + centered * (w * 0.64) + (rand() - 0.5) * 28;
        const edgeFrac = Math.abs(bx - w * 0.5) / (w * 0.42);
        const by = h - 2 - edgeFrac * edgeFrac * 26;
        const bh = (155 + rand() * 295) * (1.0 - edgeFrac * 0.18);
        const lean = (bx - w * 0.5) * 0.65 + (rand() - 0.5) * 145;
        const bw = 3.8 + rand() * 4.6;
        const isDryStraw = rand() < 0.14;
        const isBrightTip = rand() < 0.48;

        const cpx = bx + lean * 0.44;
        const cpy = by - bh * 0.58;
        const tx = Math.max(10, Math.min(w - 10, bx + lean));
        const ty = Math.max(12, by - bh);

        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.46, by);
        ctx.quadraticCurveTo(cpx - bw * 0.22, cpy, tx, ty);
        ctx.quadraticCurveTo(cpx + bw * 0.22, cpy, bx + bw * 0.46, by);
        ctx.closePath();

        // Fill with real meadow_grass photo texture, then shade root-to-tip depth
        ctx.fillStyle = gPat;
        ctx.fill();

        const shade = ctx.createLinearGradient(bx, by, tx, ty);
        if (isDryStraw) {
          shade.addColorStop(0, 'rgba(34,40,18,0.52)');
          shade.addColorStop(0.55, 'rgba(138,130,64,0.42)');
          shade.addColorStop(1, 'rgba(196,178,94,0.58)');
        } else if (isBrightTip) {
          shade.addColorStop(0, 'rgba(26,46,18,0.48)');
          shade.addColorStop(0.52, 'rgba(84,126,42,0.18)');
          shade.addColorStop(1, 'rgba(164,198,74,0.44)');
        } else {
          shade.addColorStop(0, 'rgba(24,42,16,0.5)');
          shade.addColorStop(0.6, 'rgba(52,88,28,0.22)');
          shade.addColorStop(1, 'rgba(116,154,54,0.32)');
        }
        ctx.fillStyle = shade;
        ctx.fill();
      }

      // Delicate woodland clover & bilberry leaves tucked near the clump base
      for (let i = 0; i < 22; i++) {
        const cx = 64 + rand() * (w - 128);
        const cy = h - 38 - rand() * 140;
        const r = 9 + rand() * 10;
        for (let l = 0; l < 3; l++) {
          const a = (l / 3) * Math.PI * 2 + rand() * 0.5;
          ctx.fillStyle = rand() > 0.4 ? 'rgba(92,136,44,0.88)' : 'rgba(64,104,32,0.9)';
          ctx.beginPath();
          ctx.ellipse(
            cx + Math.cos(a) * r * 0.75,
            cy + Math.sin(a) * r * 0.6,
            r * 0.65,
            r * 0.48,
            a,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      // A few wispy meadow grass seed heads
      for (let i = 0; i < 7; i++) {
        const sx = 90 + rand() * (w - 180);
        const sy = 56 + rand() * 130;
        ctx.strokeStyle = 'rgba(186,174,106,0.82)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(sx, h - 10);
        ctx.quadraticCurveTo(sx + (rand() - 0.5) * 44, (h + sy) * 0.5, sx + (rand() - 0.5) * 65, sy);
        ctx.stroke();
        const tipX = sx + (rand() - 0.5) * 42;
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = 'rgba(208,194,122,0.88)';
          ctx.beginPath();
          ctx.ellipse(tipX + (rand() - 0.5) * 14, sy + k * 7, 3.2, 5.5, (rand() - 0.5) * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [72, 108, 38] }
  );

  // Bog Ground Mist Patch
  const bogMistTex = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, 8, w * 0.5, h * 0.5, w * 0.5);
      g.addColorStop(0, 'rgba(238, 240, 230, 0.42)');
      g.addColorStop(0.48, 'rgba(228, 232, 222, 0.2)');
      g.addColorStop(1, 'rgba(225, 230, 222, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { clamp: true }
  );

  // Soft Grounded Ambient Occlusion Skirt for Houses & Props
  const contactShadowTex = makeCanvasTex(
    128,
    128,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.14, w * 0.5, h * 0.5, w * 0.5);
      g.addColorStop(0, 'rgba(12, 16, 10, 0.72)');
      g.addColorStop(0.62, 'rgba(14, 18, 11, 0.45)');
      g.addColorStop(1, 'rgba(14, 18, 11, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { clamp: true }
  );

  const all = [
    birchBark,
    birchNormal,
    pineBark,
    pineNormal,
    spruceBark,
    logWallWeathered,
    logWallWarm,
    logWallNormal,
    gableBoards,
    thatchRoofMossy,
    thatchNormal,
    roofShingle,
    shingleNormal,
    fieldstone,
    fieldstoneNormal,
    plankWood,
    plankNormal,
    groundDetail,
    groundNormal,
    terrainForestTex,
    terrainMeadowTex,
    terrainRoadTex,
    boulderGranite,
    boleteCap,
    boleteNormal,
    boleteStem,
    birchBoleteStem,
    chanterelleTex,
    saffronCapTex,
    flyAgaricCap,
    flyAgaricNormal,
    destroyingAngelCap,
    amanitaGills,
    birchLeafCard,
    bushLeafCard,
    pineNeedleCard,
    spruceBoughCard,
    fernFrondCard,
    grassClumpCard,
    bogMistTex,
    contactShadowTex,
  ];

  return {
    birchBark,
    birchNormal,
    pineBark,
    pineNormal,
    spruceBark,
    logWallWeathered,
    logWallWarm,
    logWallNormal,
    gableBoards,
    thatchRoofMossy,
    thatchNormal,
    roofShingle,
    shingleNormal,
    fieldstone,
    fieldstoneNormal,
    plankWood,
    plankNormal,
    groundDetail,
    groundNormal,
    terrainForestTex,
    terrainMeadowTex,
    terrainRoadTex,
    boulderGranite,
    boleteCap,
    boleteNormal,
    boleteStem,
    birchBoleteStem,
    chanterelleTex,
    saffronCapTex,
    flyAgaricCap,
    flyAgaricNormal,
    destroyingAngelCap,
    amanitaGills,
    birchLeafCard,
    bushLeafCard,
    pineNeedleCard,
    spruceBoughCard,
    fernFrondCard,
    grassClumpCard,
    bogMistTex,
    contactShadowTex,
    dispose: () => {
      for (const t of all) t.dispose();
    },
  };
}

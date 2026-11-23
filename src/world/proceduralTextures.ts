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
 * Fills transparent pixels (alpha < 12) with matching RGB bleed color
 * so WebGL mipmapping never produces dark edges on alpha-tested foliage.
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
    if (d[i + 3] < 12) {
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
  } = {}
): THREE.CanvasTexture {
  return makeCanvasTex(
    w,
    h,
    (ctx) => {
      ctx.drawImage(img, 0, 0, w, h);
      if (opts.brightnessBoost && opts.brightnessBoost !== 1) {
        const data = ctx.getImageData(0, 0, w, h);
        const p = data.data;
        const boost = opts.brightnessBoost;
        for (let i = 0; i < p.length; i += 4) {
          p[i] = Math.min(255, Math.round(p[i] * boost));
          p[i + 1] = Math.min(255, Math.round(p[i + 1] * boost));
          p[i + 2] = Math.min(255, Math.round(p[i + 2] * boost));
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

function makeLuminanceBumpTex(
  img: HTMLImageElement,
  w: number,
  h: number,
  opts: { repeatX?: number; repeatY?: number; contrast?: number } = {}
): THREE.CanvasTexture {
  return makeCanvasTex(
    w,
    h,
    (ctx) => {
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const p = data.data;
      const contrast = opts.contrast ?? 1.45;
      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        const v = Math.max(0, Math.min(255, Math.round((lum - 128) * contrast + 128)));
        p[i] = v;
        p[i + 1] = v;
        p[i + 2] = v;
      }
      ctx.putImageData(data, 0, 0);
    },
    {
      repeatX: opts.repeatX ?? 1,
      repeatY: opts.repeatY ?? 1,
      srgb: false,
    }
  );
}

export interface WorldTextures {
  birchBark: THREE.CanvasTexture;
  birchBump: THREE.CanvasTexture;
  pineBark: THREE.CanvasTexture;
  pineBump: THREE.CanvasTexture;
  spruceBark: THREE.CanvasTexture;
  logWallWeathered: THREE.CanvasTexture;
  logWallWarm: THREE.CanvasTexture;
  logWallBump: THREE.CanvasTexture;
  gableBoards: THREE.CanvasTexture;
  thatchRoofMossy: THREE.CanvasTexture;
  thatchBump: THREE.CanvasTexture;
  roofShingle: THREE.CanvasTexture;
  fieldstone: THREE.CanvasTexture;
  plankWood: THREE.CanvasTexture;
  groundDetail: THREE.CanvasTexture;
  groundBump: THREE.CanvasTexture;
  boulderGranite: THREE.CanvasTexture;
  boleteCap: THREE.CanvasTexture;
  boleteStem: THREE.CanvasTexture;
  birchLeafCard: THREE.CanvasTexture;
  bushLeafCard: THREE.CanvasTexture;
  pineNeedleCard: THREE.CanvasTexture;
  spruceBoughCard: THREE.CanvasTexture;
  fernFrondCard: THREE.CanvasTexture;
  grassBladeCard: THREE.CanvasTexture;
  birchBillboard: THREE.CanvasTexture;
  pineBillboard: THREE.CanvasTexture;
  spruceBillboard: THREE.CanvasTexture;
  bogMistTex: THREE.CanvasTexture;
  dispose: () => void;
}

export async function createWorldTextures(maxAnisotropy: number): Promise<WorldTextures> {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  // Decode all real photographic source tiles concurrently
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
    loadImage(boleteCapUrl),
    loadImage(boleteStemUrl),
    loadImage(meadowGrassUrl),
    loadImage(leafPatchUrl),
    loadImage(spruceFoliageUrl),
  ]);

  // 1. Silver Birch Bark (papery white bark with organic lenticels & mossy base variation)
  const birchBark = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(101);
      ctx.fillStyle = '#e4dfd4';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,252,245,0.34)' : 'rgba(154,146,134,0.28)';
        ctx.fillRect(rand() * w, rand() * h, 16 + rand() * 54, 2 + rand() * 5);
      }
      for (let i = 0; i < 155; i++) {
        const y = rand() * h;
        const x = rand() * w;
        const lw = 8 + rand() * 38;
        const lh = 1.5 + rand() * 4.5;
        ctx.fillStyle = rand() > 0.28 ? '#282622' : '#6c665c';
        ctx.fillRect(x, y, lw, lh);
      }
    },
    { repeatX: 1, repeatY: 2, anisotropy: aniso }
  );

  const birchBump = makeCanvasTex(
    128,
    256,
    (ctx, w, h) => {
      const rand = seededRand(102);
      ctx.fillStyle = '#909090';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 210; i++) {
        ctx.fillStyle = rand() > 0.5 ? '#b4b4b4' : '#424242';
        ctx.fillRect(rand() * w, rand() * h, 6 + rand() * 24, 1 + rand() * 3);
      }
    },
    { repeatX: 1, repeatY: 2, srgb: false }
  );

  // 2. Real Photo-Derived Scots Pine & Spruce Bark
  const pineBark = makePhotoTex(imgPineBark, 256, 512, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 1.55,
  });
  const pineBump = makeLuminanceBumpTex(imgPineBark, 128, 256, {
    repeatX: 1,
    repeatY: 3,
    contrast: 1.75,
  });

  const spruceBark = makePhotoTex(imgPineBark, 128, 256, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 0.9,
  });

  // 3. Real Photo-Derived House Logs, Gable Siding, Thatch, Shingles, Fieldstone & Planks
  const logWallWeathered = makePhotoTex(imgLogWeathered, 512, 512, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 1.08,
  });
  const logWallWarm = makePhotoTex(imgLogWarm, 512, 512, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 1.04,
  });
  const logWallBump = makeLuminanceBumpTex(imgLogWeathered, 256, 256, {
    repeatX: 2,
    repeatY: 1,
    contrast: 1.65,
  });
  const gableBoards = makePhotoTex(imgGableBoards, 256, 256, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
  });
  const thatchRoofMossy = makePhotoTex(imgThatchMossy, 512, 512, {
    repeatX: 3,
    repeatY: 2,
    anisotropy: aniso,
    brightnessBoost: 1.08,
  });
  const thatchBump = makeLuminanceBumpTex(imgThatchMossy, 256, 256, {
    repeatX: 3,
    repeatY: 2,
    contrast: 1.8,
  });
  const roofShingle = makePhotoTex(imgRoofShingle, 512, 512, {
    repeatX: 3,
    repeatY: 2,
    anisotropy: aniso,
  });
  const fieldstone = makePhotoTex(imgFieldstone, 256, 256, {
    repeatX: 4,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 1.15,
  });
  const plankWood = makePhotoTex(imgPlankWood, 256, 256, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 1.08,
  });

  // 4. Real Photo-Derived Boletes (kivipuravik_486fff64.jpg)
  const boleteCap = makePhotoTex(imgBoleteCap, 256, 256, {
    anisotropy: aniso,
    brightnessBoost: 0.86,
  });
  const boleteStem = makePhotoTex(imgBoleteStem, 256, 256, {
    anisotropy: aniso,
    brightnessBoost: 1.05,
  });

  // 5. Real Photo-Derived Forest Floor Ground Detail + Luminance Bump Map
  // High-pass normalized so repeating across 40m chunks gives crisp organic grain with zero repeating spots!
  const groundDetail = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      ctx.drawImage(imgForestFloor, 0, 0, w, h);
      const srcData = ctx.getImageData(0, 0, w, h);
      const p = srcData.data;

      // Compute blurred low-frequency canvas to subtract blotchy shadows
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = 64;
      blurCanvas.height = 64;
      const bCtx = blurCanvas.getContext('2d')!;
      bCtx.drawImage(imgForestFloor, 0, 0, 64, 64);
      const lowCanvas = document.createElement('canvas');
      lowCanvas.width = w;
      lowCanvas.height = h;
      const lCtx = lowCanvas.getContext('2d')!;
      lCtx.drawImage(blurCanvas, 0, 0, w, h);
      const lp = lCtx.getImageData(0, 0, w, h).data;

      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        const lowLum = 0.299 * lp[i] + 0.587 * lp[i + 1] + 0.114 * lp[i + 2];
        // Keep sharp fine pine-needle/moss grain while flattening broad shadow blotches
        const highFreq = lum - lowLum;
        const val = Math.max(122, Math.min(242, Math.round(188 + highFreq * 1.15)));
        const rOff = (p[i] - lp[i]) * 0.45;
        const gOff = (p[i + 1] - lp[i + 1]) * 0.45;
        const bOff = (p[i + 2] - lp[i + 2]) * 0.45;
        p[i] = Math.max(110, Math.min(245, Math.round(val + rOff)));
        p[i + 1] = Math.max(115, Math.min(245, Math.round(val + gOff)));
        p[i + 2] = Math.max(105, Math.min(238, Math.round(val + bOff)));
      }
      ctx.putImageData(srcData, 0, 0);
    },
    { repeatX: 14, repeatY: 14, anisotropy: aniso }
  );

  const groundBump = makeLuminanceBumpTex(imgForestFloor, 256, 256, {
    repeatX: 14,
    repeatY: 14,
    contrast: 1.45,
  });

  // Glacial Granite Boulder (mossy fieldstone + granite speckles)
  const boulderGranite = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      ctx.drawImage(imgFieldstone, 0, 0, w, h);
      ctx.fillStyle = 'rgba(92,94,88,0.28)';
      ctx.fillRect(0, 0, w, h);
    },
    { repeatX: 2, repeatY: 2, anisotropy: aniso }
  );

  // 6. Photo-Patterned Foliage & Grass Cards (Zero alpha halo + Real photographic leaf/needle texture!)
  const leafPatternCanvas = document.createElement('canvas');
  leafPatternCanvas.width = 256;
  leafPatternCanvas.height = 256;
  const lpCtx = leafPatternCanvas.getContext('2d')!;
  lpCtx.drawImage(imgLeafPatch, 0, 0, 256, 256);

  const sprucePatternCanvas = document.createElement('canvas');
  sprucePatternCanvas.width = 256;
  sprucePatternCanvas.height = 256;
  const spCtx = sprucePatternCanvas.getContext('2d')!;
  spCtx.drawImage(imgSpruceFoliage, 0, 0, 256, 256);

  const grassPatternCanvas = document.createElement('canvas');
  grassPatternCanvas.width = 256;
  grassPatternCanvas.height = 256;
  const gpCtx = grassPatternCanvas.getContext('2d')!;
  gpCtx.drawImage(imgMeadowGrass, 0, 0, 256, 256);

  const birchLeafCard = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(301);
      ctx.clearRect(0, 0, w, h);
      const leafPat = ctx.createPattern(leafPatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#3d3124';
      ctx.lineCap = 'round';
      const branches = [
        [128, 250, 128, 26, 4.2],
        [128, 212, 42, 74, 3.0],
        [128, 198, 214, 76, 3.0],
        [128, 145, 56, 38, 2.4],
        [128, 130, 200, 40, 2.4],
        [82, 145, 20, 124, 2.0],
        [174, 140, 236, 124, 2.0],
      ];
      for (const [x0, y0, x1, y1, lw] of branches) {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + x1) * 0.5 + (rand() - 0.5) * 18, (y0 + y1) * 0.5, x1, y1);
        ctx.stroke();
      }
      // Draw crisp birch leaf silhouettes filled with real photo foliage texture!
      for (let i = 0; i < 210; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = Math.pow(rand(), 0.56) * 108;
        const cx = 128 + Math.cos(angle) * dist * 1.02;
        const cy = 124 + Math.sin(angle) * dist * 0.94;
        if (cx < 10 || cx > w - 10 || cy < 10 || cy > h - 14) continue;
        const leafLen = 13 + rand() * 13;
        const leafWid = leafLen * (0.64 + rand() * 0.18);
        const rot = angle + (rand() - 0.5) * 0.9;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.fillStyle = leafPat;
        ctx.beginPath();
        ctx.moveTo(0, -leafLen * 0.52);
        ctx.quadraticCurveTo(leafWid * 0.82, -leafLen * 0.08, 0, leafLen * 0.56);
        ctx.quadraticCurveTo(-leafWid * 0.82, -leafLen * 0.08, 0, -leafLen * 0.52);
        ctx.fill();
        // Subtle natural sunlit/shaded depth overlay per leaf
        ctx.fillStyle = rand() > 0.5 ? 'rgba(130,175,60,0.22)' : 'rgba(26,52,18,0.22)';
        ctx.fill();
        ctx.restore();
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [84, 120, 42] }
  );

  // Dense leafy woodland bush card (alder / hazel / rowan) using real leaf_patch texture
  const bushLeafCard = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(309);
      ctx.clearRect(0, 0, w, h);
      const leafPat = ctx.createPattern(leafPatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#382c20';
      ctx.lineCap = 'round';
      for (let b = 0; b < 7; b++) {
        const bx = 128 + (b - 3) * 28 + (rand() - 0.5) * 12;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(128, 250);
        ctx.quadraticCurveTo((128 + bx) * 0.5, 165, bx, 48 + rand() * 45);
        ctx.stroke();
      }
      for (let i = 0; i < 240; i++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.pow(rand(), 0.52) * 112;
        const cx = 128 + Math.cos(ang) * rad;
        const cy = 136 + Math.sin(ang) * rad * 0.86;
        if (cx < 10 || cx > w - 10 || cy < 12 || cy > h - 10) continue;
        const leafLen = 14 + rand() * 14;
        const leafWid = leafLen * 0.72;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang + (rand() - 0.5) * 1.1);
        ctx.fillStyle = leafPat;
        ctx.beginPath();
        ctx.moveTo(0, -leafLen * 0.5);
        ctx.quadraticCurveTo(leafWid * 0.85, 0, 0, leafLen * 0.55);
        ctx.quadraticCurveTo(-leafWid * 0.85, 0, 0, -leafLen * 0.5);
        ctx.fill();
        ctx.fillStyle = rand() > 0.45 ? 'rgba(42,76,26,0.26)' : 'rgba(116,158,52,0.18)';
        ctx.fill();
        ctx.restore();
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [68, 102, 38] }
  );

  const pineNeedleCard = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(302);
      ctx.clearRect(0, 0, w, h);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#633c26';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(128, 246);
      ctx.lineTo(128, 86);
      ctx.moveTo(128, 180);
      ctx.lineTo(44, 90);
      ctx.moveTo(128, 170);
      ctx.lineTo(212, 86);
      ctx.stroke();

      for (let c = 0; c < 68; c++) {
        const ang = rand() * Math.PI * 2;
        const rad = Math.pow(rand(), 0.55) * 94;
        const cx = 128 + Math.cos(ang) * rad;
        const cy = 116 + Math.sin(ang) * rad * 0.88;
        if (cx < 16 || cx > w - 16 || cy < 16 || cy > h - 18) continue;
        for (let n = 0; n < 20; n++) {
          const na = (n / 20) * Math.PI * 2 + rand() * 0.25;
          const nLen = 17 + rand() * 14;
          ctx.strokeStyle = spPat;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(na) * nLen, cy + Math.sin(na) * nLen);
          ctx.stroke();
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [46, 78, 36] }
  );

  const spruceBoughCard = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(303);
      ctx.clearRect(0, 0, w, h);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#3b2b20';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(128, 246);
      ctx.lineTo(128, 20);
      ctx.stroke();
      for (let y = 232; y >= 24; y -= 8) {
        const span = Math.sin(((234 - y) / 212) * Math.PI * 0.85) * 108 + 24;
        for (const side of [-1, 1]) {
          const ex = 128 + side * span;
          const ey = y - 16 - rand() * 10;
          ctx.strokeStyle = '#36271d';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(128, y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          const steps = 18;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const bx = 128 + (ex - 128) * t;
            const by = y + (ey - y) * t;
            for (let k = -1; k <= 1; k += 2) {
              ctx.strokeStyle = spPat;
              ctx.lineWidth = 3.2;
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(bx + k * (9 + rand() * 9), by - (10 + rand() * 11));
              ctx.stroke();
            }
          }
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [36, 66, 32] }
  );

  const fernFrondCard = makeCanvasTex(
    128,
    256,
    (ctx, w, h) => {
      const rand = seededRand(304);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;
      ctx.strokeStyle = '#4e6c2c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(64, h - 4);
      ctx.lineTo(64, 14);
      ctx.stroke();
      for (let y = h - 32; y >= 16; y -= 8) {
        const progress = (h - 32 - y) / (h - 48);
        const pinnaLen = Math.sin(progress * Math.PI) * 56 + 8;
        for (const side of [-1, 1]) {
          ctx.fillStyle = gPat;
          ctx.beginPath();
          ctx.moveTo(64, y);
          ctx.quadraticCurveTo(64 + side * pinnaLen * 0.6, y - 6, 64 + side * pinnaLen, y - 3);
          ctx.quadraticCurveTo(64 + side * pinnaLen * 0.55, y + 4, 64, y + 3);
          ctx.fill();
          if (rand() > 0.5) {
            ctx.fillStyle = 'rgba(38,76,22,0.22)';
            ctx.fill();
          }
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [72, 112, 38] }
  );

  // Wild Meadow Grass & Woodland Herb Cross-Card using real meadow_grass.jpg photo pattern!
  // Sculpted as a fanning central root tuft with tapered blades & open air gaps (zero square silhouette!)
  const grassBladeCard = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(312);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;
      for (let i = 0; i < 22; i++) {
        const fan = (i / 21) * 2 - 1; // -1..1 fan outward from root crown
        const x0 = w * 0.5 + fan * 34 + (rand() - 0.5) * 14;
        const tipX = Math.max(14, Math.min(w - 14, w * 0.5 + fan * 106 + (rand() - 0.5) * 24));
        const tipY = 24 + Math.abs(fan) * 62 + rand() * 58;
        const midX = (x0 + tipX) * 0.5 + fan * 10;
        const midY = (h + tipY) * 0.48;
        const bw = 6 + rand() * 5.5;
        ctx.fillStyle = gPat;
        ctx.beginPath();
        ctx.moveTo(x0 - bw * 0.5, h);
        ctx.quadraticCurveTo(midX - bw * 0.28, midY, tipX, tipY);
        ctx.quadraticCurveTo(midX + bw * 0.28, midY, x0 + bw * 0.5, h);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rand() > 0.45 ? 'rgba(32,56,18,0.22)' : 'rgba(148,180,62,0.16)';
        ctx.fill();
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [78, 114, 40] }
  );

  // 7. Distant LOD 2 Tree Billboards (matching photo-sampled colors)
  const birchBillboard = makeCanvasTex(
    128,
    256,
    (ctx, w, h) => {
      const rand = seededRand(401);
      const leafPat = ctx.createPattern(leafPatternCanvas, 'repeat')!;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#d7d3c9';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, h);
      ctx.lineTo(63, 70);
      ctx.moveTo(63, 125);
      ctx.lineTo(42, 72);
      ctx.moveTo(63, 110);
      ctx.lineTo(88, 65);
      ctx.stroke();
      for (let i = 0; i < 150; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.pow(rand(), 0.65) * 46;
        ctx.fillStyle = leafPat;
        ctx.beginPath();
        ctx.arc(64 + Math.cos(a) * r, 76 + Math.sin(a) * r * 1.25, 4 + rand() * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { clamp: true, bleedRgb: [86, 120, 42] }
  );

  const pineBillboard = makeCanvasTex(
    128,
    256,
    (ctx, w, h) => {
      const rand = seededRand(402);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 32, 0, h);
      grad.addColorStop(0, '#ab6237');
      grad.addColorStop(0.5, '#593827');
      grad.addColorStop(1, '#30221a');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, h);
      ctx.lineTo(64, 44);
      ctx.stroke();
      for (let i = 0; i < 130; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.pow(rand(), 0.65) * 42;
        ctx.fillStyle = spPat;
        ctx.beginPath();
        ctx.arc(64 + Math.cos(a) * r, 46 + Math.sin(a) * r * 0.58, 4 + rand() * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { clamp: true, bleedRgb: [46, 76, 34] }
  );

  const spruceBillboard = makeCanvasTex(
    128,
    256,
    (ctx, w, h) => {
      const rand = seededRand(403);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#382920';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, h);
      ctx.lineTo(64, 20);
      ctx.stroke();
      for (let y = 216; y >= 18; y -= 8) {
        const halfW = ((y - 14) / 206) * 46 + 4;
        for (let x = 64 - halfW; x <= 64 + halfW; x += 6) {
          ctx.fillStyle = spPat;
          ctx.beginPath();
          ctx.arc(x + (rand() - 0.5) * 5, y + (rand() - 0.5) * 5, 4 + rand() * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    { clamp: true, bleedRgb: [36, 64, 32] }
  );

  const bogMistTex = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.5);
      g.addColorStop(0, 'rgba(235, 240, 232, 0.36)');
      g.addColorStop(0.5, 'rgba(225, 232, 224, 0.18)');
      g.addColorStop(1, 'rgba(225, 232, 224, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { clamp: true }
  );

  const all = [
    birchBark,
    birchBump,
    pineBark,
    pineBump,
    spruceBark,
    logWallWeathered,
    logWallWarm,
    logWallBump,
    gableBoards,
    thatchRoofMossy,
    thatchBump,
    roofShingle,
    fieldstone,
    plankWood,
    groundDetail,
    groundBump,
    boulderGranite,
    boleteCap,
    boleteStem,
    birchLeafCard,
    bushLeafCard,
    pineNeedleCard,
    spruceBoughCard,
    fernFrondCard,
    grassBladeCard,
    birchBillboard,
    pineBillboard,
    spruceBillboard,
    bogMistTex,
  ];

  return {
    birchBark,
    birchBump,
    pineBark,
    pineBump,
    spruceBark,
    logWallWeathered,
    logWallWarm,
    logWallBump,
    gableBoards,
    thatchRoofMossy,
    thatchBump,
    roofShingle,
    fieldstone,
    plankWood,
    groundDetail,
    groundBump,
    boulderGranite,
    boleteCap,
    boleteStem,
    birchLeafCard,
    bushLeafCard,
    pineNeedleCard,
    spruceBoughCard,
    fernFrondCard,
    grassBladeCard,
    birchBillboard,
    pineBillboard,
    spruceBillboard,
    bogMistTex,
    dispose: () => {
      for (const t of all) t.dispose();
    },
  };
}

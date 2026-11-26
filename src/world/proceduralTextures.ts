import { createSeededRandom as seededRand } from './seededRandom';
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
  birchBarkBase: THREE.CanvasTexture;
  birchNormal: THREE.CanvasTexture;
  pineBark: THREE.CanvasTexture;
  pineBarkUpper: THREE.CanvasTexture;
  pineNormal: THREE.CanvasTexture;
  spruceBark: THREE.CanvasTexture;
  spruceNormal: THREE.CanvasTexture;
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
  boulderNormal: THREE.CanvasTexture;
  boulderMossCoat: THREE.CanvasTexture;
  boulderMossNormal: THREE.CanvasTexture;
  boulderLichenCoat: THREE.CanvasTexture;
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
  shortGrassCard: THREE.CanvasTexture;
  mossCarpetTex: THREE.CanvasTexture;
  mossNormal: THREE.CanvasTexture;
  tallUndergrowthCard: THREE.CanvasTexture;
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

  // 1. High-Res Silver Birch Bark (1024x1024 — creamy papery white bark with horizontal peeling curls,
  // dense dark lenticels, and iconic Estonian dark triangular ^ branch-scar chevrons)
  const birchBark = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(101);
      const baseGrad = ctx.createLinearGradient(0, 0, w, 0);
      baseGrad.addColorStop(0, '#dad4c8');
      baseGrad.addColorStop(0.26, '#ebe7de');
      baseGrad.addColorStop(0.54, '#e3ded3');
      baseGrad.addColorStop(0.82, '#ebe6dc');
      baseGrad.addColorStop(1, '#dad4c8');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle vertical warm-grey weathering streaks & pale papery tone modulation
      for (let i = 0; i < 65; i++) {
        const x = rand() * w;
        const sw = 18 + rand() * 58;
        ctx.fillStyle =
          rand() > 0.5 ? 'rgba(255,253,247,0.16)' : 'rgba(138,130,116,0.11)';
        ctx.fillRect(x, 0, sw, h);
      }

      // Horizontal papery peel bands (wrapped across X seam so tiling is invisible)
      for (let i = 0; i < 480; i++) {
        const y = rand() * h;
        const x = rand() * w;
        const bw = 34 + rand() * 165;
        const bh = 2 + rand() * 11;
        const tone = rand();
        ctx.fillStyle =
          tone > 0.62
            ? 'rgba(255,252,245,0.42)'
            : tone > 0.34
              ? 'rgba(164,152,134,0.22)'
              : 'rgba(196,162,128,0.20)'; // warm cinnamon inner-bark glimpse under peeling curls
        ctx.fillRect(x, y, bw, bh);
        if (x + bw > w) ctx.fillRect(x - w, y, bw, bh);
      }

      // Crisp dark horizontal lenticels (fine rhythmic dashes across the papery bark)
      for (let i = 0; i < 780; i++) {
        const y = rand() * h;
        const x = rand() * w;
        const lw = 12 + rand() * 78;
        const lh = 1.4 + rand() * 4.4;
        const dark = rand() > 0.24;
        ctx.fillStyle = dark ? 'rgba(34,31,27,0.84)' : 'rgba(92,84,74,0.58)';
        const rot = (rand() - 0.5) * 0.06;
        for (const ox of [0, -w, w]) {
          if (x + ox + lw < 0 || x + ox - lw > w) continue;
          ctx.beginPath();
          ctx.ellipse(x + ox, y, lw * 0.5, lh * 0.5, rot, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Signature Silver Birch dark triangular `^` branch-scar chevrons & rough diamond knots (kaasik2.webp)
      for (let i = 0; i < 24; i++) {
        const cx = rand() * w;
        const cy = rand() * h;
        const span = 22 + rand() * 44;
        const rise = 14 + rand() * 26;
        const thick = 5 + rand() * 11;

        for (const ox of [0, -w, w]) {
          if (cx + ox + span < 0 || cx + ox - span > w) continue;
          const px = cx + ox;
          // Outer weathered charcoal diamond-chevron crust
          ctx.fillStyle = 'rgba(28,25,22,0.92)';
          ctx.beginPath();
          ctx.moveTo(px - span, cy + rise * 0.55);
          ctx.quadraticCurveTo(px - span * 0.32, cy - rise * 0.45, px, cy - rise * 0.82);
          ctx.quadraticCurveTo(px + span * 0.32, cy - rise * 0.45, px + span, cy + rise * 0.55);
          ctx.quadraticCurveTo(px + span * 0.25, cy + thick * 0.35, px, cy + thick * 0.72);
          ctx.quadraticCurveTo(px - span * 0.25, cy + thick * 0.35, px - span, cy + rise * 0.55);
          ctx.fill();

          // Rough dark inner knot eye & horizontal crack striations
          ctx.fillStyle = 'rgba(62,54,46,0.72)';
          ctx.beginPath();
          ctx.ellipse(px, cy - rise * 0.1, span * 0.24, thick * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(18,16,14,0.85)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(px - span * 0.72, cy + rise * 0.25);
          ctx.lineTo(px + span * 0.72, cy + rise * 0.25);
          ctx.stroke();
        }
      }

      // Subtle pale grey-green crustose lichen flecks on weathered birch trunks
      for (let i = 0; i < 45; i++) {
        const lx = rand() * w;
        const ly = rand() * h;
        const lr = 8 + rand() * 20;
        ctx.fillStyle = 'rgba(148,162,134,0.18)';
        ctx.beginPath();
        ctx.ellipse(lx, ly, lr * 1.2, lr * 0.75, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeatX: 1, repeatY: 3, anisotropy: aniso }
  );
  const birchNormal = makeSobelNormalTex(birchBark.image as HTMLCanvasElement, 512, 512, 2.4, {
    repeatX: 1,
    repeatY: 3,
  });

  // 1b. Silver Birch Fissured Basal Bark (512x512 — deep charcoal diamond-cracked corky lower trunk/roots)
  const birchBarkBase = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(109);
      ctx.fillStyle = '#2d2a26';
      ctx.fillRect(0, 0, w, h);

      // Deep vertical interlocking charcoal fissures & pale chalky ridge crests
      for (let i = 0; i < 240; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const rw = 6 + rand() * 18;
        const rh = 24 + rand() * 78;
        const isPaleCrest = rand() > 0.62;
        ctx.fillStyle = isPaleCrest
          ? 'rgba(138,132,122,0.52)'
          : rand() > 0.45
            ? 'rgba(66,62,56,0.75)'
            : 'rgba(20,18,16,0.88)';
        for (const ox of [0, -w, w]) {
          if (x + ox + rw < 0 || x + ox - rw > w) continue;
          ctx.beginPath();
          ctx.moveTo(x + ox, y - rh * 0.5);
          ctx.lineTo(x + ox + rw * 0.5, y);
          ctx.lineTo(x + ox, y + rh * 0.5);
          ctx.lineTo(x + ox - rw * 0.5, y);
          ctx.closePath();
          ctx.fill();
        }
      }
      // Subtle mossy green flecks near the damp root collar
      for (let i = 0; i < 65; i++) {
        const x = rand() * w;
        const y = rand() * h;
        ctx.fillStyle = 'rgba(72,96,46,0.26)';
        ctx.beginPath();
        ctx.ellipse(x, y, 5 + rand() * 14, 7 + rand() * 18, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeatX: 2, repeatY: 2, anisotropy: aniso }
  );

  // 2. High-Res Scots Pine Lower Plated Bark (1024x1024 — rugged grey-brown crocodile plates + reddish crevices)
  const pineBark = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(202);
      // Tile photographic pine bark as micro-grain base
      ctx.drawImage(imgPineBark, 0, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, 0, h * 0.5, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, h * 0.5, w * 0.5, h * 0.5);

      // Desaturate slightly toward weathered Baltic grey-brown outer plates
      ctx.fillStyle = 'rgba(62,52,44,0.34)';
      ctx.fillRect(0, 0, w, h);

      // Deep interlocking vertical/diagonal dark crevices separating chunky scaly bark plates
      const cols = 14;
      for (let c = 0; c < cols; c++) {
        const baseX = (c / cols) * w;
        // Dark crevice furrow
        ctx.strokeStyle = 'rgba(22,16,13,0.88)';
        ctx.lineWidth = 7 + rand() * 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        let px = baseX;
        ctx.moveTo(px, 0);
        for (let seg = 1; seg <= 10; seg++) {
          const py = (seg / 10) * h;
          px = baseX + (seg === 10 ? 0 : (rand() - 0.5) * 32);
          ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Warm cinnamon inner-fissure glow along crevice walls (visible on mature Estonian Scots pine)
        ctx.strokeStyle = 'rgba(136,72,42,0.34)';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      // Layered flat scaly bark plates between furrows
      for (let i = 0; i < 420; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const pw = 20 + rand() * 44;
        const ph = 38 + rand() * 115;
        const tone = rand();
        ctx.fillStyle =
          tone > 0.62
            ? 'rgba(132,114,98,0.44)'
            : tone > 0.3
              ? 'rgba(94,76,62,0.46)'
              : 'rgba(154,102,72,0.28)';
        for (const ox of [0, -w, w]) {
          if (x + ox + pw < 0 || x + ox - pw > w) continue;
          ctx.beginPath();
          ctx.roundRect(x + ox - pw * 0.5, y - ph * 0.5, pw, ph, 6);
          ctx.fill();
          ctx.strokeStyle = 'rgba(26,18,14,0.52)';
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }
      }
      // Subtle pale grey-green lichen & weathered highlights on outer plate ridges
      for (let i = 0; i < 75; i++) {
        ctx.fillStyle = rand() > 0.4 ? 'rgba(168,162,148,0.16)' : 'rgba(128,146,112,0.16)';
        ctx.beginPath();
        ctx.ellipse(rand() * w, rand() * h, 8 + rand() * 20, 12 + rand() * 32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeatX: 1, repeatY: 3, anisotropy: aniso }
  );
  const pineNormal = makeSobelNormalTex(pineBark.image as HTMLCanvasElement, 512, 512, 3.6, {
    repeatX: 1,
    repeatY: 3,
  });

  // 2b. Scots Pine Upper Foxy-Orange Flaking Bark (512x512 — pine-forest-with-track.jpg iconic warm terracotta upper trunk)
  const pineBarkUpper = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(209);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#c86a38');
      grad.addColorStop(0.5, '#d97c44');
      grad.addColorStop(1, '#c86a38');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = 0.22;
      ctx.drawImage(imgPineBark, 0, 0, w, h);
      ctx.globalAlpha = 1.0;

      // Thin papery peeling amber/terracotta bark flakes
      for (let i = 0; i < 360; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const fw = 12 + rand() * 34;
        const fh = 18 + rand() * 68;
        const t = rand();
        ctx.fillStyle =
          t > 0.65
            ? 'rgba(232,148,86,0.52)'
            : t > 0.3
              ? 'rgba(176,84,42,0.48)'
              : 'rgba(124,58,32,0.44)';
        for (const ox of [0, -w, w]) {
          if (x + ox + fw < 0 || x + ox - fw > w) continue;
          ctx.beginPath();
          ctx.roundRect(x + ox - fw * 0.5, y - fh * 0.5, fw, fh, 4);
          ctx.fill();
          // Crisp dark peeled flake shadow edge
          ctx.strokeStyle = 'rgba(72,32,16,0.42)';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }
      // Fine papery horizontal curl marks
      for (let i = 0; i < 120; i++) {
        const x = rand() * w;
        const y = rand() * h;
        ctx.strokeStyle = 'rgba(246,184,126,0.34)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10 + rand() * 24, y + (rand() - 0.5) * 6);
        ctx.stroke();
      }
    },
    { repeatX: 1, repeatY: 3, anisotropy: aniso }
  );

  // 2c. Dedicated Norway Spruce Bark (1024x1024 — warm reddish-brown/mahogany-grey round flaking scales matching kuusiku-alune.jpg!)
  const spruceBark = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(233);
      // Warm reddish-mahogany grey base (distinct from grey pine plates!)
      ctx.fillStyle = '#5c4136';
      ctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = 0.25;
      ctx.drawImage(imgPineBark, 0, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, 0, h * 0.5, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, h * 0.5, w * 0.5, h * 0.5);
      ctx.globalAlpha = 1.0;

      // Warm reddish-brown tint glaze
      ctx.fillStyle = 'rgba(104,64,48,0.38)';
      ctx.fillRect(0, 0, w, h);

      // Characteristic rounded flaking spruce scales (shingled overlapping chips, not long pine furrows)
      for (let i = 0; i < 1150; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const rx = 10 + rand() * 22;
        const ry = 14 + rand() * 34;
        const t = rand();
        ctx.fillStyle =
          t > 0.68
            ? 'rgba(136,92,74,0.58)' // reddish-brown flake
            : t > 0.36
              ? 'rgba(104,78,68,0.62)' // purplish-brown grey scale
              : t > 0.14
                ? 'rgba(72,52,44,0.68)' // dark shadowed scale
                : 'rgba(148,118,98,0.44)'; // weathered dusty outer scale
        const rot = (rand() - 0.5) * 0.32;
        for (const ox of [0, -w, w]) {
          if (x + ox + rx < 0 || x + ox - rx > w) continue;
          ctx.beginPath();
          ctx.ellipse(x + ox, y, rx, ry, rot, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(32,20,16,0.58)';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }

      // Pale amber-white spruce resin drips & silvery crustose lichen patches
      for (let i = 0; i < 28; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const len = 34 + rand() * 88;
        ctx.strokeStyle = 'rgba(218,210,192,0.34)';
        ctx.lineWidth = 2.4 + rand() * 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 8, y + len);
        ctx.stroke();
      }
      for (let i = 0; i < 85; i++) {
        const x = rand() * w;
        const y = rand() * h;
        ctx.fillStyle = rand() > 0.45 ? 'rgba(148,164,132,0.22)' : 'rgba(92,118,62,0.18)';
        ctx.beginPath();
        ctx.ellipse(x, y, 7 + rand() * 18, 9 + rand() * 22, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeatX: 1, repeatY: 3, anisotropy: aniso }
  );
  const spruceNormal = makeSobelNormalTex(spruceBark.image as HTMLCanvasElement, 512, 512, 3.1, {
    repeatX: 1,
    repeatY: 3,
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

  // 4b. High-Res Cleaved Baltic Glacial Granite Boulder + Moss Coat + Reindeer Lichen Coat (1024x1024)
  const boulderGranite = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(488);
      // Base photo fieldstone tiled at 2x2 for crisp mineral grain
      ctx.drawImage(imgFieldstone, 0, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgFieldstone, w * 0.5, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgFieldstone, 0, h * 0.5, w * 0.5, h * 0.5);
      ctx.drawImage(imgFieldstone, w * 0.5, h * 0.5, w * 0.5, h * 0.5);

      // Cool Nordic granite tone balance
      ctx.fillStyle = 'rgba(116,120,124,0.34)';
      ctx.fillRect(0, 0, w, h);

      // Large weathered mineral mottling patches (quartz pale patches & dark basaltic veins)
      for (let i = 0; i < 160; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const rx = 24 + rand() * 78;
        const ry = 18 + rand() * 62;
        const t = rand();
        ctx.fillStyle =
          t > 0.55
            ? 'rgba(176,178,176,0.22)'
            : t > 0.25
              ? 'rgba(72,76,82,0.26)'
              : 'rgba(154,132,122,0.16)'; // Nordic rapakivi pinkish feldspar tint
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fine crystalline granite speckle (quartz white, mica charcoal, warm feldspar)
      for (let i = 0; i < 6400; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 1.0 + rand() * 3.1;
        const t = rand();
        ctx.fillStyle =
          t > 0.65
            ? 'rgba(214,216,214,0.42)'
            : t > 0.32
              ? 'rgba(42,44,48,0.52)'
              : 'rgba(166,144,132,0.36)';
        ctx.fillRect(x, y, r, r * (0.7 + rand() * 0.6));
      }

      // Sharp cleaved rock fracture cracks & stepped mineral seams (moss-covered-stone.jpg)
      for (let i = 0; i < 42; i++) {
        let x = rand() * w;
        let y = rand() * h;
        let ang = rand() * Math.PI * 2;
        ctx.strokeStyle = 'rgba(28,30,32,0.68)';
        ctx.lineWidth = 1.6 + rand() * 2.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const steps = 4 + Math.floor(rand() * 5);
        for (let s = 0; s < steps; s++) {
          ang += (rand() - 0.5) * 0.85;
          x += Math.cos(ang) * (24 + rand() * 48);
          y += Math.sin(ang) * (24 + rand() * 48);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Highlighted cleaved rock lip next to crack
        ctx.strokeStyle = 'rgba(202,206,204,0.24)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Subtle pale crustose rock lichen dots on dry granite faces
      for (let i = 0; i < 85; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 6 + rand() * 18;
        ctx.fillStyle = rand() > 0.45 ? 'rgba(182,190,174,0.28)' : 'rgba(116,134,88,0.22)';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.15, r * 0.82, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeatX: 1, repeatY: 1, anisotropy: aniso }
  );
  const boulderNormal = makeSobelNormalTex(boulderGranite.image as HTMLCanvasElement, 512, 512, 3.8, {
    repeatX: 1,
    repeatY: 1,
  });

  // Shaggy Emerald Forest Rock Moss Coat with scattered fallen golden birch leaves & spruce needles (moss-covered-stone.jpg)
  const boulderMossCoat = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(489);
      ctx.fillStyle = '#36581e';
      ctx.fillRect(0, 0, w, h);

      // Soft mossy pillows & shadowed crevices
      for (let i = 0; i < 480; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 16 + rand() * 46;
        const g = ctx.createRadialGradient(x, y, 2, x, y, r);
        const bright = rand() > 0.42;
        g.addColorStop(0, bright ? 'rgba(116,162,48,0.58)' : 'rgba(42,76,22,0.62)');
        g.addColorStop(1, 'rgba(38,68,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Thousands of tiny shaggy feather-moss shoots (Hylocomium / Pleurozium micro-texture)
      for (let i = 0; i < 5200; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        const len = 5 + rand() * 14;
        const t = rand();
        ctx.strokeStyle =
          t > 0.62
            ? 'rgba(148,192,62,0.72)'
            : t > 0.25
              ? 'rgba(84,132,36,0.76)'
              : 'rgba(32,58,18,0.72)';
        ctx.lineWidth = 1.6 + rand() * 1.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }

      // Scattered fallen brown pine/spruce needles & small golden-amber autumn birch leaves resting on the moss
      for (let i = 0; i < 240; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        const len = 10 + rand() * 18;
        ctx.strokeStyle = rand() > 0.4 ? 'rgba(138,88,44,0.72)' : 'rgba(98,62,32,0.65)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      for (let i = 0; i < 38; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const lr = 7 + rand() * 11;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI * 2);
        ctx.fillStyle = rand() > 0.45 ? 'rgba(186,128,46,0.82)' : 'rgba(148,92,38,0.78)';
        ctx.beginPath();
        ctx.moveTo(0, -lr);
        ctx.quadraticCurveTo(lr * 0.72, 0, 0, lr);
        ctx.quadraticCurveTo(-lr * 0.72, 0, 0, -lr);
        ctx.fill();
        ctx.restore();
      }
    },
    { repeatX: 1, repeatY: 1, anisotropy: aniso }
  );
  const boulderMossNormal = makeSobelNormalTex(boulderMossCoat.image as HTMLCanvasElement, 512, 512, 2.8, {
    repeatX: 1,
    repeatY: 1,
  });

  // Silvery-Pale Nordic Reindeer Lichen & Olive Moss Crust (different-moss-covered-stone.webp)
  const boulderLichenCoat = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(491);
      ctx.fillStyle = '#7c8668';
      ctx.fillRect(0, 0, w, h);

      // Olive moss base tufts
      for (let i = 0; i < 380; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 18 + rand() * 52;
        ctx.fillStyle = rand() > 0.45 ? 'rgba(92,114,52,0.48)' : 'rgba(64,84,38,0.45)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Dense pale silvery-sage Cladonia reindeer lichen cushions
      for (let i = 0; i < 560; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 10 + rand() * 32;
        const g = ctx.createRadialGradient(x, y, 1, x, y, r);
        g.addColorStop(0, 'rgba(218,224,204,0.84)');
        g.addColorStop(0.65, 'rgba(178,188,162,0.58)');
        g.addColorStop(1, 'rgba(128,140,112,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fine coral-like branching lichen micro-tufts & occasional pine needles
      for (let i = 0; i < 3200; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        const len = 3 + rand() * 9;
        ctx.strokeStyle = rand() > 0.35 ? 'rgba(232,236,218,0.68)' : 'rgba(116,136,78,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      for (let i = 0; i < 160; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        ctx.strokeStyle = 'rgba(128,82,42,0.64)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * (10 + rand() * 14), y + Math.sin(a) * (10 + rand() * 14));
        ctx.stroke();
      }
    },
    { repeatX: 1, repeatY: 1, anisotropy: aniso }
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

  // Silver Birch 2x2 Multi-Variant Botanical Atlas (1024x1024 — 4 distinct 512x512 sprig types matching kaasik.jpg & kaasik2.webp!)
  // Q0 (0,0): Weeping trailing shoots | Q1 (512,0): Airy sunlit outer spray | Q2 (0,512): Mid-crown dense branchlet | Q3 (512,512): Crown-tip fine forked twigs
  const birchLeafCard = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const leafPat = ctx.createPattern(leafPatternCanvas, 'repeat')!;

      const drawBirchLeaf = (
        cx: number,
        cy: number,
        leafLen: number,
        leafWid: number,
        rot: number,
        shadeMode: 'inner' | 'mid' | 'sun'
      ) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.fillStyle = leafPat;
        ctx.beginPath();
        // Authentic pointed serrated Silver Birch diamond-deltoid leaf shape
        ctx.moveTo(0, -leafLen * 0.62);
        ctx.quadraticCurveTo(leafWid * 0.52, -leafLen * 0.14, leafWid * 0.46, leafLen * 0.18);
        ctx.quadraticCurveTo(leafWid * 0.24, leafLen * 0.5, 0, leafLen * 0.54);
        ctx.quadraticCurveTo(-leafWid * 0.24, leafLen * 0.5, -leafWid * 0.46, leafLen * 0.18);
        ctx.quadraticCurveTo(-leafWid * 0.52, -leafLen * 0.14, 0, -leafLen * 0.62);
        ctx.fill();

        ctx.fillStyle =
          shadeMode === 'sun'
            ? 'rgba(182,218,86,0.36)'
            : shadeMode === 'mid'
              ? 'rgba(98,144,44,0.22)'
              : 'rgba(26,56,20,0.36)';
        ctx.fill();

        // Crisp midrib highlight
        ctx.strokeStyle = shadeMode === 'sun' ? 'rgba(214,240,126,0.38)' : 'rgba(162,196,86,0.22)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, -leafLen * 0.46);
        ctx.lineTo(0, leafLen * 0.44);
        ctx.stroke();
        ctx.restore();
      };

      const drawBirchQuad = (q: number, ox: number, oy: number) => {
        const rand = seededRand(301 + q * 37);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox + 6, oy + 6, 500, 500);
        ctx.clip();
        ctx.translate(ox, oy);

        // Fine dark reddish-brown birch twigs
        ctx.strokeStyle = '#382a1e';
        ctx.lineCap = 'round';
        const twigs: Array<[number, number, number, number, number, number]> =
          q === 0
            ? [
                // Q0: Delicate weeping trailing shoots
                [256, 496, 256, 62, 5.2, -16],
                [256, 420, 108, 178, 3.6, -42],
                [256, 398, 404, 184, 3.6, 42],
                [162, 272, 62, 344, 2.2, -32],
                [350, 266, 452, 336, 2.2, 32],
                [256, 260, 128, 92, 2.6, -24],
                [256, 240, 386, 98, 2.6, 24],
                [190, 168, 98, 210, 1.8, -18],
                [322, 162, 418, 206, 1.8, 18],
              ]
            : q === 1
              ? [
                  // Q1: Wide airy outer spray with fine forked twigs
                  [256, 498, 248, 56, 5.6, 20],
                  [256, 426, 76, 160, 3.8, -28],
                  [256, 404, 434, 150, 3.8, 28],
                  [252, 284, 96, 74, 3.0, -18],
                  [252, 262, 412, 78, 3.0, 18],
                  [164, 290, 54, 248, 2.3, -15],
                  [348, 278, 460, 246, 2.3, 15],
                ]
              : q === 2
                ? [
                    // Q2: Fuller mid-crown branching spray
                    [256, 498, 264, 46, 6.2, -14],
                    [256, 430, 82, 194, 4.2, -26],
                    [256, 412, 426, 198, 4.2, 24],
                    [258, 316, 86, 102, 3.4, -22],
                    [258, 292, 422, 106, 3.4, 22],
                    [260, 194, 146, 58, 2.5, -14],
                    [260, 186, 372, 62, 2.5, 14],
                    [156, 274, 60, 304, 2.2, -16],
                    [352, 270, 452, 298, 2.2, 16],
                  ]
                : [
                    // Q3: Ascending narrow crown-tip forked twigs
                    [256, 498, 256, 34, 4.8, 10],
                    [256, 416, 134, 138, 3.2, -18],
                    [256, 394, 378, 134, 3.2, 18],
                    [256, 272, 148, 62, 2.6, -12],
                    [256, 256, 366, 66, 2.6, 12],
                    [194, 242, 92, 182, 2.0, -14],
                    [318, 236, 420, 178, 2.0, 14],
                  ];

        const twigPoints: Array<{ x: number; y: number; dx: number; dy: number }> = [];
        for (const [x0, y0, x1, y1, lw, bend] of twigs) {
          const cpx = (x0 + x1) * 0.5 + bend;
          const cpy = (y0 + y1) * 0.5;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(cpx, cpy, x1, y1);
          ctx.stroke();

          // Collect points along each twig so leaves cluster organically on shoots (leaving authentic sky gaps!)
          const steps = 11;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const omt = 1 - t;
            const px = omt * omt * x0 + 2 * omt * t * cpx + t * t * x1;
            const py = omt * omt * y0 + 2 * omt * t * cpy + t * t * y1;
            const dx = 2 * omt * (cpx - x0) + 2 * t * (x1 - cpx);
            const dy = 2 * omt * (cpy - y0) + 2 * t * (y1 - cpy);
            twigPoints.push({ x: px, y: py, dx, dy });
          }
        }

        const leafCount = q === 2 ? 290 : q === 3 ? 210 : 245;
        for (let i = 0; i < leafCount; i++) {
          const anchor = twigPoints[Math.floor(rand() * twigPoints.length)];
          const spread = (q === 2 ? 44 : 36) * (0.25 + rand() * 0.85);
          const ang = rand() * Math.PI * 2;
          const cx = anchor.x + Math.cos(ang) * spread;
          const cy = anchor.y + Math.sin(ang) * spread;
          if (cx < 22 || cx > 490 || cy < 20 || cy > 488) continue;

          const distFromCenter = Math.hypot(cx - 256, cy - 248);
          const leafLen = (q === 0 ? 15 : 17) + rand() * 17;
          const leafWid = leafLen * (0.68 + rand() * 0.22);
          const twigAng = Math.atan2(anchor.dy, anchor.dx) + Math.PI * 0.5;
          const rot = twigAng + (rand() - 0.5) * 1.45;
          const shadeMode: 'inner' | 'mid' | 'sun' =
            distFromCenter < 98 && rand() > 0.3
              ? 'inner'
              : distFromCenter > 138 || cy < 150
                ? rand() > 0.3
                  ? 'sun'
                  : 'mid'
                : 'mid';

          drawBirchLeaf(cx, cy, leafLen, leafWid, rot, shadeMode);
        }

        ctx.restore();
      };

      drawBirchQuad(0, 0, 0);
      drawBirchQuad(1, 512, 0);
      drawBirchQuad(2, 0, 512);
      drawBirchQuad(3, 512, 512);
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

  // Scots Pine 2x2 Multi-Variant Botanical Atlas (1024x1024 — matching pine-forest.webp & pine-forest-with-track.jpg!)
  // Q0: Wide gnarled bough fork | Q1: Airy sunlit outer umbrella spray | Q2: Asymmetric crooked branch tuft | Q3: Dense crown-top rosette puff
  const pineNeedleCard = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;

      const drawPineQuad = (q: number, ox: number, oy: number) => {
        const rand = seededRand(302 + q * 43);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox + 6, oy + 6, 500, 500);
        ctx.clip();
        ctx.translate(ox, oy);

        // Crooked reddish-brown & copper woody pine branchlets
        const branches: Array<[number, number, number, number, number, number]> =
          q === 0
            ? [
                [256, 492, 246, 174, 11, 22],
                [252, 368, 78, 176, 7.5, -24],
                [250, 336, 434, 168, 7.5, 24],
                [158, 272, 74, 270, 5.2, -12],
                [354, 254, 444, 266, 5.2, 12],
                [248, 228, 166, 98, 5.0, -14],
                [248, 220, 352, 102, 5.0, 14],
              ]
            : q === 1
              ? [
                  [256, 492, 270, 152, 9.5, -26],
                  [260, 352, 96, 144, 6.5, -22],
                  [262, 310, 424, 142, 6.5, 20],
                  [178, 242, 124, 90, 4.5, -14],
                  [348, 224, 396, 92, 4.5, 14],
                ]
              : q === 2
                ? [
                    [256, 490, 212, 166, 10.5, 34],
                    [236, 362, 76, 210, 7.2, -18],
                    [232, 304, 412, 192, 6.8, 28],
                    [154, 282, 102, 134, 4.8, -16],
                    [324, 242, 404, 112, 4.6, 14],
                  ]
                : [
                    [256, 488, 256, 142, 9.0, 12],
                    [256, 356, 118, 178, 6.4, -18],
                    [256, 346, 396, 172, 6.4, 18],
                    [256, 256, 162, 96, 5.2, -12],
                    [256, 252, 354, 98, 5.2, 12],
                  ];

        const tipCenters: Array<{ x: number; y: number; outer: boolean }> = [];
        ctx.lineCap = 'round';
        for (const [x0, y0, x1, y1, lw, bend] of branches) {
          const cpx = (x0 + x1) * 0.5 + bend;
          const cpy = (y0 + y1) * 0.5;
          ctx.strokeStyle = '#5c3822';
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(cpx, cpy, x1, y1);
          ctx.stroke();

          // Warm copper Scots pine bark highlight on upper twig side
          ctx.strokeStyle = 'rgba(182,102,56,0.52)';
          ctx.lineWidth = lw * 0.42;
          ctx.beginPath();
          ctx.moveTo(x0, y0 - lw * 0.16);
          ctx.quadraticCurveTo(cpx, cpy - lw * 0.16, x1, y1 - lw * 0.16);
          ctx.stroke();

          // Needle tufts sit primarily toward the outer 65% of twigs (exposing woody limbs underneath like pine-forest.webp!)
          for (let s = 0; s < 7; s++) {
            const t = 0.35 + (s / 6) * 0.65;
            const omt = 1 - t;
            const px = omt * omt * x0 + 2 * omt * t * cpx + t * t * x1;
            const py = omt * omt * y0 + 2 * omt * t * cpy + t * t * y1;
            tipCenters.push({ x: px, y: py, outer: t > 0.68 || py < 190 });
          }
        }

        // Radiating clusters of fine bluish-olive Scots pine needle pairs clustered into rich pillows
        const clusterCount = q === 3 ? 114 : q === 1 ? 86 : 98;
        for (let c = 0; c < clusterCount; c++) {
          const anchor = tipCenters[Math.floor(rand() * tipCenters.length)];
          const spread = 14 + rand() * 48;
          const ang = rand() * Math.PI * 2;
          const cx = anchor.x + Math.cos(ang) * spread;
          const cy = anchor.y + Math.sin(ang) * spread * 0.86;
          if (cx < 26 || cx > 486 || cy < 24 || cy > 468) continue;

          const needles = 22 + Math.floor(rand() * 8);
          for (let n = 0; n < needles; n++) {
            const na = (n / needles) * Math.PI * 2 + rand() * 0.25;
            const nLen = 22 + rand() * 24;
            ctx.strokeStyle = spPat;
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(na) * nLen, cy + Math.sin(na) * nLen);
            ctx.stroke();

            ctx.strokeStyle = !anchor.outer
              ? 'rgba(26,54,30,0.34)'
              : rand() > 0.36
                ? 'rgba(136,174,88,0.40)'
                : 'rgba(66,112,68,0.34)'; // glaucous blue-green Scots pine hue
            ctx.lineWidth = 1.7;
            ctx.stroke();
          }
        }
        ctx.restore();
      };

      drawPineQuad(0, 0, 0);
      drawPineQuad(1, 512, 0);
      drawPineQuad(2, 0, 512);
      drawPineQuad(3, 512, 512);
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [64, 102, 52] }
  );

  // Norway Spruce 2x2 Multi-Variant Botanical Atlas (1024x1024 — matching lone-spruce.jpg & young-spruce.jpg!)
  // Plush, deeply layered evergreen boughs with solid shadowed inner needle cushions, dense overlapping
  // hanging comb fringes, and ragged spiky outer silhouettes (no skeletal fishbone gaps!)
  // Q0: Heavy lower drooping bough with dense hanging fringed curtains | Q1: Full layered mid-crown bough
  // Q2: Lush upper-crown / sapling shoot with olive-green sunlit tips | Q3: Bushy conical spire apex
  const spruceBoughCard = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const spPat = ctx.createPattern(sprucePatternCanvas, 'repeat')!;

      const drawNeedleShoot = (
        rand: () => number,
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        needleLen: number,
        twigW: number,
        tipBright: boolean,
        hangFringe: boolean,
        darkCore = false
      ) => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const px = -uy;
        const py = ux;

        // Soft shaded inner needle underlay along twig spine so overlapping shoots fuse into real evergreen mass
        ctx.strokeStyle = darkCore ? 'rgba(18, 36, 16, 0.92)' : 'rgba(28, 52, 22, 0.88)';
        ctx.lineWidth = Math.max(twigW * 2.2, needleLen * 0.72);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + dx * 0.88, y0 + dy * 0.88);
        ctx.stroke();

        // Woody dark mahogany inner twig spine (barely peeking through dense needles)
        ctx.strokeStyle = '#3b2619';
        ctx.lineWidth = twigW * 0.82;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + dx * 0.82, y0 + dy * 0.82);
        ctx.stroke();

        // Dense prickly Norway spruce needles swept forward along both sides of the sub-twig
        const stepPx = 3.9;
        const steps = Math.max(5, Math.floor(dist / stepPx));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const bx = x0 + dx * t;
          const by = y0 + dy * t;
          const taper = 0.72 + 0.48 * Math.sin(t * Math.PI * 0.88);
          const nL = needleLen * taper * (0.82 + rand() * 0.42);
          for (const side of [-1, 1]) {
            const forward = 0.56 + rand() * 0.30;
            const spread = 0.78 + rand() * 0.28;
            let nx = bx + (ux * forward + px * side * spread) * nL;
            let ny = by + (uy * forward + py * side * spread) * nL;
            if (hangFringe && (side === 1 || rand() < 0.35)) {
              // Characteristic heavy hanging Norway spruce comb curtains (lone-spruce.jpg!)
              ny += nL * (0.48 + rand() * 0.56);
            }
            ctx.strokeStyle = spPat;
            ctx.lineWidth = 3.2 + (1 - t) * 1.15;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(nx, ny);
            ctx.stroke();

            ctx.strokeStyle = darkCore
              ? 'rgba(16,34,15,0.58)'
              : tipBright && t > 0.62
                ? 'rgba(128,174,68,0.52)'
                : t > 0.52
                  ? 'rgba(84,132,46,0.44)'
                  : t < 0.28
                    ? 'rgba(18,38,16,0.54)'
                    : 'rgba(38,72,28,0.38)';
            ctx.lineWidth = 2.0;
            ctx.stroke();
          }
        }
      };

      const drawInnerCoreCushion = (
        rand: () => number,
        widthScale: number,
        topY: number,
        bottomY: number
      ) => {
        // Dense irregular core of overlapping spruce-needle tufts along the central 68% of the bough
        // Eliminates skeletal see-through fishbone gaps while preserving irregular spiky perimeter!
        const rows = 15;
        for (let r = 0; r < rows; r++) {
          const prog = r / (rows - 1);
          const y = bottomY - prog * (bottomY - topY);
          const halfSpan = (32 + Math.pow(Math.sin(Math.min(1, prog * 0.94 + 0.06) * Math.PI), 0.72) * 116) * widthScale;
          const tuftCount = Math.max(3, Math.round(halfSpan / 22));
          for (let k = 0; k < tuftCount; k++) {
            const u = tuftCount === 1 ? 0 : (k / (tuftCount - 1)) * 2 - 1;
            const cx = 256 + u * halfSpan * (0.72 + rand() * 0.35);
            const cy = y + (rand() - 0.5) * 20;
            const rx = (22 + rand() * 20) * widthScale * (1 - prog * 0.32);
            const ry = 18 + rand() * 16;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((rand() - 0.5) * 0.9);
            ctx.fillStyle = spPat;
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle =
              Math.abs(u) < 0.45
                ? 'rgba(15, 33, 14, 0.56)'
                : prog > 0.65
                  ? 'rgba(54, 92, 34, 0.34)'
                  : 'rgba(26, 52, 20, 0.44)';
            ctx.beginPath();
            ctx.ellipse(0, 0, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      };

      const drawSpruceQuad = (q: number, ox: number, oy: number) => {
        const rand = seededRand(303 + q * 53);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox + 6, oy + 6, 500, 500);
        ctx.clip();
        ctx.translate(ox, oy);
        ctx.lineCap = 'round';

        if (q === 3) {
          // Q3: Lush bushy conical spruce spire apex with dense overlapping ascending shoots (lone-spruce.jpg top!)
          drawInnerCoreCushion(rand, 0.68, 76, 476);
          drawNeedleShoot(rand, 256, 496, 256, 16, 23, 6.8, true, false);

          const whorls = [
            { y: 468, len: 212, rise: 108 },
            { y: 416, len: 196, rise: 112 },
            { y: 360, len: 174, rise: 108 },
            { y: 304, len: 148, rise: 100 },
            { y: 248, len: 122, rise: 92 },
            { y: 194, len: 94, rise: 82 },
            { y: 142, len: 68, rise: 68 },
            { y: 92, len: 42, rise: 52 },
          ];
          for (const wh of whorls) {
            for (const side of [-1, 1]) {
              const jitterLen = wh.len * (0.86 + rand() * 0.24);
              const ex = 256 + side * jitterLen;
              const ey = wh.y - wh.rise * (0.86 + rand() * 0.24);
              drawNeedleShoot(rand, 256, wh.y, ex, ey, 19.5, 4.0, true, false);
              if (wh.len > 75) {
                for (let sub = 0; sub < 2; sub++) {
                  const st = 0.34 + sub * 0.34;
                  const mx = 256 + side * jitterLen * st;
                  const my = wh.y - wh.rise * st;
                  drawNeedleShoot(
                    rand,
                    mx,
                    my,
                    mx + side * jitterLen * (0.38 - sub * 0.08),
                    my - wh.rise * (0.28 - sub * 0.06) + (sub === 0 ? 18 : -8),
                    15.5,
                    2.8,
                    true,
                    false
                  );
                }
              }
            }
          }
          ctx.restore();
          return;
        }

        // Q0, Q1, Q2: Plush, dense, heavily-needled Norway spruce boughs with shadowed core & spiky irregular fringes
        const widthScale = q === 0 ? 1.14 : q === 1 ? 1.04 : 0.94;
        const hangFringe = q === 0 || q === 1;
        const brightTips = q === 2 || q === 1;

        // Layer 1: Shadowed interior evergreen needle cushion
        drawInnerCoreCushion(rand, widthScale * 0.92, 64, 476);

        // Layer 2: Deep background shadow shoots for rich 3D overlapping branch depth
        const backYs = [466, 412, 358, 304, 250, 196, 144, 96];
        for (let p = 0; p < backYs.length; p++) {
          const y = backYs[p] + (rand() - 0.5) * 14;
          const prog = (470 - y) / 410;
          const profile = Math.pow(Math.sin(Math.min(1, prog * 0.93 + 0.07) * Math.PI), 0.68);
          for (const side of [-1, 1]) {
            const span = (56 + profile * 165) * widthScale * (0.82 + rand() * 0.34);
            const rise = (q === 2 ? 58 : 34) * (0.6 + prog * 0.45) + rand() * 18;
            const ex = Math.max(18, Math.min(494, 256 + side * span));
            const ey = Math.max(20, y - rise);
            drawNeedleShoot(rand, 256, y, ex, ey, 20, 4.4, false, hangFringe, true);
          }
        }

        // Layer 3: Central rachis shoot
        drawNeedleShoot(rand, 256, 496, 256, 22, 20.5, q === 0 ? 7.6 : 6.4, brightTips, false);

        // Layer 4: 13 closely layered foreground lateral plumes with dense secondary & hanging comb sub-shoots!
        const plumeCount = q === 0 ? 13 : q === 1 ? 12 : 11;
        for (let p = 0; p < plumeCount; p++) {
          const frac = p / (plumeCount - 1);
          const y = 472 - frac * 408 + (rand() - 0.5) * 12;
          const prog = (476 - y) / 416;
          // Irregular jagged outer silhouette (some shoots longer, some shorter like real Norway spruce boughs!)
          const profile = Math.pow(Math.sin(Math.min(1, prog * 0.92 + 0.08) * Math.PI), 0.66);

          for (const side of [-1, 1]) {
            const asym = 0.78 + rand() * 0.42;
            const span = (58 + profile * 176) * widthScale * asym;
            const rise = (q === 2 ? 72 : q === 1 ? 52 : 34) * (0.62 + prog * 0.45) + rand() * 22;
            const ex = Math.max(16, Math.min(496, 256 + side * span));
            const ey = Math.max(18, y - rise);

            drawNeedleShoot(
              rand,
              256,
              y,
              ex,
              ey,
              q === 2 ? 18.5 : 21.0,
              4.2,
              brightTips,
              hangFringe
            );

            // 3 secondary lateral & hanging feathery sub-shoots branching off each plume -> plush layered skirt!
            if (span > 68) {
              for (let sub = 0; sub < 3; sub++) {
                const st = 0.28 + sub * 0.26;
                const sx = 256 + (ex - 256) * st;
                const sy = y + (ey - y) * st;
                const subLen = span * (0.46 - sub * 0.08) * (0.8 + rand() * 0.36);
                const isHanging = sub !== 1;
                const sEx = Math.max(14, Math.min(498, sx + side * subLen * (isHanging ? 0.64 : 0.76)));
                const sEy = Math.max(
                  18,
                  Math.min(492, sy + (isHanging ? (hangFringe ? 38 + rand() * 18 : 18) : -subLen * 0.64))
                );
                drawNeedleShoot(
                  rand,
                  sx,
                  sy,
                  sEx,
                  sEy,
                  16.0,
                  2.8,
                  brightTips || sub === 2,
                  hangFringe && isHanging
                );
              }
            }
          }
        }
        ctx.restore();
      };

      drawSpruceQuad(0, 0, 0);
      drawSpruceQuad(1, 512, 0);
      drawSpruceQuad(2, 0, 512);
      drawSpruceQuad(3, 512, 512);
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [38, 68, 28] }
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

      // Broad ground-hugging sward blades along the root skirt so neighboring clumps knit seamlessly
      for (let i = 0; i < 48; i++) {
        const bx = w * 0.06 + (i / 47) * (w * 0.88) + (rand() - 0.5) * 20;
        const by = h - 1 - rand() * 8;
        const bh = 85 + rand() * 145;
        const lean = (bx - w * 0.5) * 0.55 + (rand() - 0.5) * 115;
        const bw = 6.5 + rand() * 6.5;
        const cpx = bx + lean * 0.45;
        const cpy = by - bh * 0.6;
        const tx = Math.max(6, Math.min(w - 6, bx + lean));
        const ty = Math.max(24, by - bh);

        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.5, by);
        ctx.quadraticCurveTo(cpx - bw * 0.25, cpy, tx, ty);
        ctx.quadraticCurveTo(cpx + bw * 0.25, cpy, bx + bw * 0.5, by);
        ctx.closePath();
        ctx.fillStyle = gPat;
        ctx.fill();

        const shade = ctx.createLinearGradient(bx, by, tx, ty);
        shade.addColorStop(0, 'rgba(22,38,14,0.62)');
        shade.addColorStop(0.55, 'rgba(54,88,28,0.28)');
        shade.addColorStop(1, 'rgba(118,156,56,0.34)');
        ctx.fillStyle = shade;
        ctx.fill();
      }

      // 116 varied individual grass & sedge blades spanning short turf to long arching stems
      for (let i = 0; i < 116; i++) {
        const u = (i + rand()) / 116;
        const spread = u * 0.72 + rand() * 0.28;
        const bx = w * 0.08 + spread * (w * 0.84) + (rand() - 0.5) * 24;
        const edgeFrac = Math.abs(bx - w * 0.5) / (w * 0.46);
        const by = h - 2 - edgeFrac * edgeFrac * 14;
        const bh = (150 + rand() * 320) * (1.0 - edgeFrac * 0.14);
        const lean = (bx - w * 0.5) * 0.62 + (rand() - 0.5) * 165;
        const bw = 3.6 + rand() * 5.2;
        const isDryStraw = rand() < 0.15;
        const isBrightTip = rand() < 0.5;

        const cpx = bx + lean * 0.44;
        const cpy = by - bh * 0.58;
        const tx = Math.max(8, Math.min(w - 8, bx + lean));
        const ty = Math.max(10, by - bh);

        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.46, by);
        ctx.quadraticCurveTo(cpx - bw * 0.22, cpy, tx, ty);
        ctx.quadraticCurveTo(cpx + bw * 0.22, cpy, bx + bw * 0.46, by);
        ctx.closePath();

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

      // Woodland clover, vetch & bilberry leaves tucked richly across the base
      for (let i = 0; i < 32; i++) {
        const cx = 36 + rand() * (w - 72);
        const cy = h - 24 - rand() * 165;
        const r = 9 + rand() * 11;
        for (let l = 0; l < 3; l++) {
          const a = (l / 3) * Math.PI * 2 + rand() * 0.5;
          ctx.fillStyle = rand() > 0.4 ? 'rgba(92,136,44,0.9)' : 'rgba(60,98,28,0.92)';
          ctx.beginPath();
          ctx.ellipse(
            cx + Math.cos(a) * r * 0.75,
            cy + Math.sin(a) * r * 0.6,
            r * 0.68,
            r * 0.5,
            a,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      // Wispy meadow grass seed heads
      for (let i = 0; i < 9; i++) {
        const sx = 64 + rand() * (w - 128);
        const sy = 44 + rand() * 145;
        ctx.strokeStyle = 'rgba(186,174,106,0.84)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(sx, h - 8);
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

  // Dense Ground-Hugging Short Turf Grass, Woodland Clover & Mossy Collar (512x512)
  // Fills inter-clump spaces with velvety low foliage that hides bare ground from every angle
  const shortGrassCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(329);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;

      // Soft mossy-turf basal skirt across bottom third so adjacent rosettes knit seamlessly
      for (let i = 0; i < 64; i++) {
        const u = (i + rand()) / 64;
        const cx = w * 0.09 + u * (w * 0.82);
        const edge = Math.abs(cx - w * 0.5) / (w * 0.44);
        const cy = h - 4 - rand() * 44 * (1 - edge * 0.45);
        const rx = (22 + rand() * 26) * (1 - edge * 0.25);
        const ry = (14 + rand() * 22) * (1 - edge * 0.25);
        ctx.fillStyle = gPat;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle =
          rand() > 0.45 ? 'rgba(56,92,28,0.46)' : 'rgba(34,62,18,0.54)';
        ctx.fill();
      }

      // 150 fine short turf grass & fine fescue blades fanning outward in soft organic arcs
      for (let i = 0; i < 150; i++) {
        const u = (i + rand()) / 150;
        const bx = w * 0.08 + u * (w * 0.84) + (rand() - 0.5) * 20;
        const edgeFrac = Math.abs(bx - w * 0.5) / (w * 0.44);
        const by = h - 2 - edgeFrac * edgeFrac * 18;
        const bh = (115 + rand() * 255) * (1.0 - edgeFrac * 0.34);
        const lean = (bx - w * 0.5) * 0.72 + (rand() - 0.5) * 150;
        const bw = 3.8 + rand() * 4.8;
        const cpx = bx + lean * 0.46;
        const cpy = by - bh * 0.62;
        const tx = Math.max(10, Math.min(w - 10, bx + lean));
        const ty = Math.max(26, by - bh);

        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.5, by);
        ctx.quadraticCurveTo(cpx - bw * 0.22, cpy, tx, ty);
        ctx.quadraticCurveTo(cpx + bw * 0.22, cpy, bx + bw * 0.5, by);
        ctx.closePath();

        ctx.fillStyle = gPat;
        ctx.fill();

        const shade = ctx.createLinearGradient(bx, by, tx, ty);
        if (rand() < 0.14) {
          shade.addColorStop(0, 'rgba(38,52,20,0.5)');
          shade.addColorStop(0.55, 'rgba(116,134,54,0.34)');
          shade.addColorStop(1, 'rgba(176,184,84,0.48)');
        } else if (rand() < 0.55) {
          shade.addColorStop(0, 'rgba(26,50,16,0.48)');
          shade.addColorStop(0.5, 'rgba(76,120,38,0.22)');
          shade.addColorStop(1, 'rgba(148,186,66,0.42)');
        } else {
          shade.addColorStop(0, 'rgba(24,44,16,0.52)');
          shade.addColorStop(0.6, 'rgba(54,94,30,0.24)');
          shade.addColorStop(1, 'rgba(112,152,50,0.36)');
        }
        ctx.fillStyle = shade;
        ctx.fill();
      }

      // Rich low woodland clover & wood-sorrel leaf clusters woven into the short sward
      for (let i = 0; i < 48; i++) {
        const cx = 42 + rand() * (w - 84);
        const cy = h - 22 - rand() * 210;
        const r = 8.5 + rand() * 11.5;
        for (let l = 0; l < 3; l++) {
          const a = (l / 3) * Math.PI * 2 + rand() * 0.6;
          ctx.fillStyle =
            rand() > 0.45
              ? 'rgba(98,144,44,0.92)'
              : rand() > 0.4
                ? 'rgba(66,108,30,0.94)'
                : 'rgba(124,164,54,0.88)';
          ctx.beginPath();
          ctx.ellipse(
            cx + Math.cos(a) * r * 0.72,
            cy + Math.sin(a) * r * 0.56,
            r * 0.66,
            r * 0.48,
            a,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [64, 102, 34] }
  );

  // Seamless Baltic Feather-Moss & Velvety Forest Moss Carpet Texture + Normal Map (512x512)
  const mossCarpetTex = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(347);
      // Warm mossy organic photographic base
      ctx.drawImage(imgForestFloor, 0, 0, w, h);
      ctx.globalAlpha = 0.42;
      ctx.drawImage(imgMeadowGrass, 0, 0, w, h);
      ctx.globalAlpha = 1.0;

      // Rich Baltic feather-moss undertone wash
      ctx.fillStyle = 'rgba(66, 98, 32, 0.58)';
      ctx.fillRect(0, 0, w, h);

      // Soft pillowy moss tuft mottling (seamless tiled across edges)
      for (let i = 0; i < 240; i++) {
        const cx = rand() * w;
        const cy = rand() * h;
        const rad = 14 + rand() * 34;
        const isSunlit = rand() > 0.42;
        const colInner = isSunlit
          ? rand() > 0.5
            ? 'rgba(128,162,56,0.42)'
            : 'rgba(98,136,42,0.44)'
          : 'rgba(38,64,22,0.48)';
        for (const ox of [-w, 0, w]) {
          for (const oy of [-h, 0, h]) {
            if (cx + ox < -rad || cx + ox > w + rad || cy + oy < -rad || cy + oy > h + rad) continue;
            const g = ctx.createRadialGradient(cx + ox, cy + oy, 1, cx + ox, cy + oy, rad);
            g.addColorStop(0, colInner);
            g.addColorStop(1, 'rgba(58,86,28,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Thousands of tiny starry moss fronds / Pleurozium feather shoots for tactile close-up micro-detail
      ctx.lineCap = 'round';
      for (let i = 0; i < 1650; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const arms = 3 + Math.floor(rand() * 3);
        const baseA = rand() * Math.PI * 2;
        const len = 4 + rand() * 7.5;
        const bright = rand();
        ctx.strokeStyle =
          bright > 0.68
            ? 'rgba(164,194,74,0.62)'
            : bright > 0.3
              ? 'rgba(108,144,44,0.58)'
              : 'rgba(42,70,22,0.62)';
        ctx.lineWidth = 1.3 + rand() * 1.1;
        for (let a = 0; a < arms; a++) {
          const ang = baseA + (a / arms) * Math.PI * 2 + (rand() - 0.5) * 0.45;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
          ctx.stroke();
        }
      }

      // Occasional tiny fallen spruce needles & lichen specks nestled in the moss
      for (let i = 0; i < 110; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        const l = 6 + rand() * 10;
        ctx.strokeStyle = rand() > 0.25 ? 'rgba(98,66,34,0.44)' : 'rgba(186,196,158,0.46)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
    },
    { repeatX: 2, repeatY: 2, anisotropy: aniso }
  );
  const mossNormal = makeSobelNormalTex(mossCarpetTex.image as HTMLCanvasElement, 256, 256, 3.4, {
    repeatX: 2,
    repeatY: 2,
  });

  // Tall Estonian Woodland & Meadow Undergrowth Card (512x512: tall sedges, feathery grass panicles & wild herbs)
  const tallUndergrowthCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(419);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;

      // Dense lower tussock base
      for (let i = 0; i < 64; i++) {
        const bx = w * 0.1 + (i / 63) * (w * 0.8) + (rand() - 0.5) * 26;
        const by = h - 1;
        const bh = 140 + rand() * 210;
        const lean = (bx - w * 0.5) * 0.58 + (rand() - 0.5) * 140;
        const bw = 4.6 + rand() * 5.2;
        const cpx = bx + lean * 0.45;
        const cpy = by - bh * 0.55;
        const tx = Math.max(10, Math.min(w - 10, bx + lean));
        const ty = Math.max(20, by - bh);

        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.5, by);
        ctx.quadraticCurveTo(cpx - bw * 0.24, cpy, tx, ty);
        ctx.quadraticCurveTo(cpx + bw * 0.24, cpy, bx + bw * 0.5, by);
        ctx.closePath();
        ctx.fillStyle = gPat;
        ctx.fill();

        const shade = ctx.createLinearGradient(bx, by, tx, ty);
        shade.addColorStop(0, 'rgba(22,38,14,0.58)');
        shade.addColorStop(0.55, 'rgba(66,104,34,0.25)');
        shade.addColorStop(1, rand() < 0.25 ? 'rgba(176,164,84,0.45)' : 'rgba(134,172,62,0.38)');
        ctx.fillStyle = shade;
        ctx.fill();
      }

      // Broad woodland herb & cow-parsley-like pinnate leaf sprays in lower-mid third
      for (let i = 0; i < 16; i++) {
        const lx = w * 0.16 + rand() * (w * 0.68);
        const ly = h * 0.42 + rand() * (h * 0.44);
        const ang = (rand() - 0.5) * 1.4;
        const len = 34 + rand() * 32;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(ang);
        for (let k = -2; k <= 2; k++) {
          ctx.fillStyle = rand() > 0.4 ? 'rgba(72,114,34,0.92)' : 'rgba(98,144,48,0.9)';
          ctx.beginPath();
          ctx.ellipse(k * 9, -Math.abs(k) * 4, len * 0.34, len * 0.18, k * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Tall arching meadow & forest sedge stalks reaching top of card
      for (let i = 0; i < 38; i++) {
        const bx = w * 0.18 + rand() * (w * 0.64);
        const by = h - 2;
        const bh = 280 + rand() * 210;
        const lean = (bx - w * 0.5) * 0.52 + (rand() - 0.5) * 155;
        const bw = 3.2 + rand() * 3.6;
        const cpx = bx + lean * 0.42;
        const cpy = by - bh * 0.58;
        const tx = Math.max(12, Math.min(w - 12, bx + lean));
        const ty = Math.max(12, by - bh);

        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.45, by);
        ctx.quadraticCurveTo(cpx - bw * 0.2, cpy, tx, ty);
        ctx.quadraticCurveTo(cpx + bw * 0.2, cpy, bx + bw * 0.45, by);
        ctx.closePath();
        ctx.fillStyle = gPat;
        ctx.fill();

        const shade = ctx.createLinearGradient(bx, by, tx, ty);
        const straw = rand() < 0.28;
        shade.addColorStop(0, 'rgba(28,46,18,0.5)');
        shade.addColorStop(0.55, straw ? 'rgba(132,126,56,0.36)' : 'rgba(78,118,38,0.22)');
        shade.addColorStop(1, straw ? 'rgba(202,188,104,0.62)' : 'rgba(154,186,74,0.44)');
        ctx.fillStyle = shade;
        ctx.fill();
      }

      // Tall feathery seed plumes & subtle wild meadowsweet accents
      for (let i = 0; i < 15; i++) {
        const sx = w * 0.2 + rand() * (w * 0.6);
        const sy = 22 + rand() * 170;
        const lean = (sx - w * 0.5) * 0.48 + (rand() - 0.5) * 90;
        const tipX = Math.max(18, Math.min(w - 18, sx + lean));
        ctx.strokeStyle = rand() < 0.55 ? 'rgba(156,150,86,0.84)' : 'rgba(104,136,56,0.86)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(sx, h - 6);
        ctx.quadraticCurveTo(sx + lean * 0.4, (h + sy) * 0.5, tipX, sy);
        ctx.stroke();

        if (i % 7 === 0) {
          // Sparse warm-cream woodland meadowsweet accent
          for (let f = 0; f < 7; f++) {
            ctx.fillStyle = rand() > 0.35 ? 'rgba(226,222,182,0.82)' : 'rgba(198,200,142,0.84)';
            ctx.beginPath();
            ctx.arc(
              tipX + (rand() - 0.5) * 22,
              sy + (rand() - 0.5) * 12,
              2.0 + rand() * 1.8,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        } else {
          // Feathery golden/olive grass panicle spikelets
          for (let k = 0; k < 10; k++) {
            ctx.fillStyle = rand() > 0.35 ? 'rgba(194,180,104,0.88)' : 'rgba(146,162,76,0.86)';
            ctx.beginPath();
            ctx.ellipse(
              tipX + (rand() - 0.5) * 22,
              sy + k * 7.5,
              3.0,
              6.0,
              (rand() - 0.5) * 1.1,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
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
    birchBarkBase,
    birchNormal,
    pineBark,
    pineBarkUpper,
    pineNormal,
    spruceBark,
    spruceNormal,
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
    boulderNormal,
    boulderMossCoat,
    boulderMossNormal,
    boulderLichenCoat,
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
    shortGrassCard,
    mossCarpetTex,
    mossNormal,
    tallUndergrowthCard,
    bogMistTex,
    contactShadowTex,
  ];

  return {
    birchBark,
    birchBarkBase,
    birchNormal,
    pineBark,
    pineBarkUpper,
    pineNormal,
    spruceBark,
    spruceNormal,
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
    boulderNormal,
    boulderMossCoat,
    boulderMossNormal,
    boulderLichenCoat,
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
    shortGrassCard,
    mossCarpetTex,
    mossNormal,
    tallUndergrowthCard,
    bogMistTex,
    contactShadowTex,
    dispose: () => {
      for (const t of all) t.dispose();
    },
  };
}

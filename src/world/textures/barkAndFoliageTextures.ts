import type * as THREE from 'three';
import { createSeededRandom as seededRand } from '../seededRandom';
import type { TextureFactoryScope } from './textureUtils';

export interface BarkTextures {
  birchBark: THREE.CanvasTexture;
  birchBarkBase: THREE.CanvasTexture;
  birchNormal: THREE.CanvasTexture;
  pineBark: THREE.CanvasTexture;
  pineBarkUpper: THREE.CanvasTexture;
  pineNormal: THREE.CanvasTexture;
  spruceBark: THREE.CanvasTexture;
  spruceNormal: THREE.CanvasTexture;
}

export interface FoliageCardTextures {
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
}

export function createBarkTextures(
  scope: TextureFactoryScope,
  imgPineBark: HTMLImageElement
): BarkTextures {
  const { aniso, makeCanvasTex, makeSobelNormalTex } = scope;

  // 1. High-Res Silver Birch Bark
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

      for (let i = 0; i < 65; i++) {
        const x = rand() * w;
        const sw = 18 + rand() * 58;
        ctx.fillStyle =
          rand() > 0.5 ? 'rgba(255,253,247,0.16)' : 'rgba(138,130,116,0.11)';
        ctx.fillRect(x, 0, sw, h);
      }

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
              : 'rgba(196,162,128,0.20)';
        ctx.fillRect(x, y, bw, bh);
        if (x + bw > w) ctx.fillRect(x - w, y, bw, bh);
      }

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

      for (let i = 0; i < 24; i++) {
        const cx = rand() * w;
        const cy = rand() * h;
        const span = 22 + rand() * 44;
        const rise = 14 + rand() * 26;
        const thick = 5 + rand() * 11;

        for (const ox of [0, -w, w]) {
          if (cx + ox + span < 0 || cx + ox - span > w) continue;
          const px = cx + ox;
          ctx.fillStyle = 'rgba(28,25,22,0.92)';
          ctx.beginPath();
          ctx.moveTo(px - span, cy + rise * 0.55);
          ctx.quadraticCurveTo(px - span * 0.32, cy - rise * 0.45, px, cy - rise * 0.82);
          ctx.quadraticCurveTo(px + span * 0.32, cy - rise * 0.45, px + span, cy + rise * 0.55);
          ctx.quadraticCurveTo(px + span * 0.25, cy + thick * 0.35, px, cy + thick * 0.72);
          ctx.quadraticCurveTo(px - span * 0.25, cy + thick * 0.35, px - span, cy + rise * 0.55);
          ctx.fill();

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

  // 1b. Silver Birch Fissured Basal Bark
  const birchBarkBase = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(109);
      ctx.fillStyle = '#2d2a26';
      ctx.fillRect(0, 0, w, h);

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

  // 2. High-Res Scots Pine Lower Plated Bark
  const pineBark = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(202);
      ctx.drawImage(imgPineBark, 0, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, 0, h * 0.5, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, h * 0.5, w * 0.5, h * 0.5);

      ctx.fillStyle = 'rgba(62,52,44,0.34)';
      ctx.fillRect(0, 0, w, h);

      const cols = 14;
      for (let c = 0; c < cols; c++) {
        const baseX = (c / cols) * w;
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

        ctx.strokeStyle = 'rgba(136,72,42,0.34)';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

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

  // 2b. Scots Pine Upper Foxy-Orange Flaking Bark
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
          ctx.strokeStyle = 'rgba(72,32,16,0.42)';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }
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

  // 2c. Dedicated Norway Spruce Bark
  const spruceBark = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(233);
      ctx.fillStyle = '#5c4136';
      ctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = 0.25;
      ctx.drawImage(imgPineBark, 0, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, 0, h * 0.5, w * 0.5, h * 0.5);
      ctx.drawImage(imgPineBark, w * 0.5, h * 0.5, w * 0.5, h * 0.5);
      ctx.globalAlpha = 1.0;

      ctx.fillStyle = 'rgba(104,64,48,0.38)';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 1150; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const rx = 10 + rand() * 22;
        const ry = 14 + rand() * 34;
        const t = rand();
        ctx.fillStyle =
          t > 0.68
            ? 'rgba(136,92,74,0.58)'
            : t > 0.36
              ? 'rgba(104,78,68,0.62)'
              : t > 0.14
                ? 'rgba(72,52,44,0.68)'
                : 'rgba(148,118,98,0.44)';
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

  return {
    birchBark,
    birchBarkBase,
    birchNormal,
    pineBark,
    pineBarkUpper,
    pineNormal,
    spruceBark,
    spruceNormal,
  };
}

export function createFoliageCardTextures(
  scope: TextureFactoryScope,
  imgs: {
    imgLeafPatch: HTMLImageElement;
    imgSpruceFoliage: HTMLImageElement;
    imgMeadowGrass: HTMLImageElement;
    imgForestFloor: HTMLImageElement;
  }
): FoliageCardTextures {
  const { aniso, makeCanvasTex, makeSobelNormalTex } = scope;

  const leafPatternCanvas = document.createElement('canvas');
  leafPatternCanvas.width = 256;
  leafPatternCanvas.height = 256;
  leafPatternCanvas.getContext('2d')!.drawImage(imgs.imgLeafPatch, 0, 0, 256, 256);

  const sprucePatternCanvas = document.createElement('canvas');
  sprucePatternCanvas.width = 256;
  sprucePatternCanvas.height = 256;
  sprucePatternCanvas.getContext('2d')!.drawImage(imgs.imgSpruceFoliage, 0, 0, 256, 256);

  const grassPatternCanvas = document.createElement('canvas');
  grassPatternCanvas.width = 256;
  grassPatternCanvas.height = 256;
  grassPatternCanvas.getContext('2d')!.drawImage(imgs.imgMeadowGrass, 0, 0, 256, 256);

  // Silver Birch 2x2 Multi-Variant Botanical Atlas (1024x1024)
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

        ctx.strokeStyle = '#382a1e';
        ctx.lineCap = 'round';
        const twigs: Array<[number, number, number, number, number, number]> =
          q === 0
            ? [
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

  // Scots Pine 2x2 Multi-Variant Botanical Atlas (1024x1024)
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

          ctx.strokeStyle = 'rgba(182,102,56,0.52)';
          ctx.lineWidth = lw * 0.42;
          ctx.beginPath();
          ctx.moveTo(x0, y0 - lw * 0.16);
          ctx.quadraticCurveTo(cpx, cpy - lw * 0.16, x1, y1 - lw * 0.16);
          ctx.stroke();

          for (let s = 0; s < 7; s++) {
            const t = 0.35 + (s / 6) * 0.65;
            const omt = 1 - t;
            const px = omt * omt * x0 + 2 * omt * t * cpx + t * t * x1;
            const py = omt * omt * y0 + 2 * omt * t * cpy + t * t * y1;
            tipCenters.push({ x: px, y: py, outer: t > 0.68 || py < 190 });
          }
        }

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
                : 'rgba(66,112,68,0.34)';
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

  // Norway Spruce 2x2 Multi-Variant Botanical Atlas (1024x1024)
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

        ctx.strokeStyle = darkCore ? 'rgba(18, 36, 16, 0.92)' : 'rgba(28, 52, 22, 0.88)';
        ctx.lineWidth = Math.max(twigW * 2.2, needleLen * 0.72);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + dx * 0.88, y0 + dy * 0.88);
        ctx.stroke();

        ctx.strokeStyle = '#3b2619';
        ctx.lineWidth = twigW * 0.82;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + dx * 0.82, y0 + dy * 0.82);
        ctx.stroke();

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
            const nx = bx + (ux * forward + px * side * spread) * nL;
            let ny = by + (uy * forward + py * side * spread) * nL;
            if (hangFringe && (side === 1 || rand() < 0.35)) {
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
        const rows = 15;
        for (let r = 0; r < rows; r++) {
          const prog = r / (rows - 1);
          const y = bottomY - prog * (bottomY - topY);
          const halfSpan =
            (32 + Math.pow(Math.sin(Math.min(1, prog * 0.94 + 0.06) * Math.PI), 0.72) * 116) * widthScale;
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

        const widthScale = q === 0 ? 1.14 : q === 1 ? 1.04 : 0.94;
        const hangFringe = q === 0 || q === 1;
        const brightTips = q === 2 || q === 1;

        drawInnerCoreCushion(rand, widthScale * 0.92, 64, 476);

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

        drawNeedleShoot(rand, 256, 496, 256, 22, 20.5, q === 0 ? 7.6 : 6.4, brightTips, false);

        const plumeCount = q === 0 ? 13 : q === 1 ? 12 : 11;
        for (let p = 0; p < plumeCount; p++) {
          const frac = p / (plumeCount - 1);
          const y = 472 - frac * 408 + (rand() - 0.5) * 12;
          const prog = (476 - y) / 416;
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

  // Woodland Fern Frond Card
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
          ctx.fillStyle = rand() > 0.45 ? 'rgba(116,158,52,0.22)' : 'rgba(28,62,18,0.26)';
          ctx.fill();
        }
      }
    },
    { clamp: true, anisotropy: aniso, bleedRgb: [68, 108, 36] }
  );

  // Photorealistic Multi-Blade Estonian Meadow Grass, Forest Sedge & Wild Clover Clump
  const grassClumpCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(317);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;

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

  // Dense Ground-Hugging Short Turf Grass, Woodland Clover & Mossy Collar
  const shortGrassCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(329);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;

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
        ctx.fillStyle = rand() > 0.45 ? 'rgba(56,92,28,0.46)' : 'rgba(34,62,18,0.54)';
        ctx.fill();
      }

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

  // Seamless Baltic Feather-Moss & Velvety Forest Moss Carpet Texture + Normal Map
  const mossCarpetTex = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(347);
      ctx.drawImage(imgs.imgForestFloor, 0, 0, w, h);
      ctx.globalAlpha = 0.42;
      ctx.drawImage(imgs.imgMeadowGrass, 0, 0, w, h);
      ctx.globalAlpha = 1.0;

      ctx.fillStyle = 'rgba(66, 98, 32, 0.58)';
      ctx.fillRect(0, 0, w, h);

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

  // Tall Estonian Woodland & Meadow Undergrowth Card
  const tallUndergrowthCard = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(419);
      ctx.clearRect(0, 0, w, h);
      const gPat = ctx.createPattern(grassPatternCanvas, 'repeat')!;

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

  return {
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
  };
}

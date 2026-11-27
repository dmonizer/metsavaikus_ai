import type * as THREE from 'three';
import { createSeededRandom as seededRand } from '../seededRandom';
import type { TextureFactoryScope } from './textureUtils';

export interface TerrainAndStoneTextures {
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
  bogMistTex: THREE.CanvasTexture;
}

export interface TerrainAndStoneImages {
  imgForestFloor: HTMLImageElement;
  imgTrailNeedles: HTMLImageElement;
  imgMeadowGrass: HTMLImageElement;
  imgFieldstone: HTMLImageElement;
}

export function createTerrainAndStoneTextures(
  scope: TextureFactoryScope,
  imgs: TerrainAndStoneImages
): TerrainAndStoneTextures {
  const { aniso, makeCanvasTex, makePhotoTex, makeSobelNormalTex } = scope;

  // High-Pass Organic Forest Floor + Pine-Needle Detail Texture & Normal Map
  const groundDetail = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      ctx.drawImage(imgs.imgForestFloor, 0, 0, w, h);
      ctx.globalAlpha = 0.28;
      ctx.drawImage(imgs.imgTrailNeedles, 0, 0, w, h);
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

  // Full-color photographic biome splat maps
  const terrainForestTex = makePhotoTex(imgs.imgForestFloor, 512, 512, {
    repeatX: 1,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 1.06,
    saturation: 1.08,
  });
  const terrainMeadowTex = makePhotoTex(imgs.imgMeadowGrass, 512, 512, {
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
      ctx.drawImage(imgs.imgTrailNeedles, 0, 0, w, h);
      ctx.fillStyle = 'rgba(136,128,114,0.44)';
      ctx.fillRect(0, 0, w, h);
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

  // High-Res Cleaved Baltic Glacial Granite Boulder + Moss Coat + Reindeer Lichen Coat (1024x1024)
  const boulderGranite = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(488);
      ctx.drawImage(imgs.imgFieldstone, 0, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgs.imgFieldstone, w * 0.5, 0, w * 0.5, h * 0.5);
      ctx.drawImage(imgs.imgFieldstone, 0, h * 0.5, w * 0.5, h * 0.5);
      ctx.drawImage(imgs.imgFieldstone, w * 0.5, h * 0.5, w * 0.5, h * 0.5);

      ctx.fillStyle = 'rgba(116,120,124,0.34)';
      ctx.fillRect(0, 0, w, h);

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
              : 'rgba(154,132,122,0.16)';
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }

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
        ctx.strokeStyle = 'rgba(202,206,204,0.24)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

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

  const boulderMossCoat = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(489);
      ctx.fillStyle = '#36581e';
      ctx.fillRect(0, 0, w, h);

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

  const boulderLichenCoat = makeCanvasTex(
    1024,
    1024,
    (ctx, w, h) => {
      const rand = seededRand(491);
      ctx.fillStyle = '#7c8668';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 380; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 18 + rand() * 52;
        ctx.fillStyle = rand() > 0.45 ? 'rgba(92,114,52,0.48)' : 'rgba(64,84,38,0.45)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

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

  return {
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
    bogMistTex,
  };
}

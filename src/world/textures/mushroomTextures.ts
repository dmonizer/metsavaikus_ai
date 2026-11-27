import type * as THREE from 'three';
import { createSeededRandom as seededRand } from '../seededRandom';
import type { TextureFactoryScope } from './textureUtils';

export interface MushroomTextures {
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
}

export function createMushroomTextures(
  scope: TextureFactoryScope,
  imgs: { imgBoleteCap: HTMLImageElement; imgBoleteStem: HTMLImageElement }
): MushroomTextures {
  const { aniso, makeCanvasTex, makePhotoTex, makeSobelNormalTex } = scope;

  const boleteCap = makePhotoTex(imgs.imgBoleteCap, 256, 256, {
    anisotropy: aniso,
    brightnessBoost: 0.88,
    saturation: 1.08,
  });
  const boleteNormal = makeSobelNormalTex(imgs.imgBoleteCap, 256, 256, 2.1, { clamp: true });
  const boleteStem = makePhotoTex(imgs.imgBoleteStem, 256, 256, {
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

  // Punane kärbseseen (Amanita muscaria)
  const flyAgaricCap = makeCanvasTex(
    512,
    512,
    (ctx, w, h) => {
      const rand = seededRand(514);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#8d110a');
      grad.addColorStop(0.35, '#bd190e');
      grad.addColorStop(0.75, '#d62c12');
      grad.addColorStop(0.92, '#e35518');
      grad.addColorStop(1.0, '#ec7c26');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

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

      for (let x = 0; x < w; x += 4) {
        ctx.strokeStyle = x % 8 === 0 ? 'rgba(96,12,6,0.34)' : 'rgba(255,186,98,0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.84);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

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

  // Valge kärbseseen (Amanita virosa — Destroying Angel)
  const destroyingAngelCap = makeCanvasTex(
    256,
    256,
    (ctx, w, h) => {
      const rand = seededRand(515);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.0, '#eae1cd');
      grad.addColorStop(0.32, '#f5f2e9');
      grad.addColorStop(0.85, '#faf9f4');
      grad.addColorStop(1.0, '#efece3');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (let x = 0; x < w; x += 3) {
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,252,0.28)' : 'rgba(196,188,172,0.16)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rand() - 0.5) * 4, h);
        ctx.stroke();
      }
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

  return {
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
  };
}

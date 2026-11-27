import type * as THREE from 'three';
import type { TextureFactoryScope } from './textureUtils';

export interface ArchitectureTextures {
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
  contactShadowTex: THREE.CanvasTexture;
}

export interface ArchitectureTextureImages {
  imgLogWeathered: HTMLImageElement;
  imgLogWarm: HTMLImageElement;
  imgGableBoards: HTMLImageElement;
  imgThatchMossy: HTMLImageElement;
  imgRoofShingle: HTMLImageElement;
  imgFieldstone: HTMLImageElement;
  imgPlankWood: HTMLImageElement;
}

export function createArchitectureTextures(
  scope: TextureFactoryScope,
  imgs: ArchitectureTextureImages
): ArchitectureTextures {
  const { aniso, makeCanvasTex, makePhotoTex, makeSobelNormalTex } = scope;

  const logWallWeathered = makePhotoTex(imgs.imgLogWeathered, 512, 512, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.86,
    saturation: 0.92,
  });
  const logWallWarm = makePhotoTex(imgs.imgLogWarm, 512, 512, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.9,
    saturation: 1.06,
  });
  const logWallNormal = makeSobelNormalTex(imgs.imgLogWeathered, 256, 256, 3.4, {
    repeatX: 2,
    repeatY: 1,
  });
  const gableBoards = makePhotoTex(imgs.imgGableBoards, 256, 256, {
    repeatX: 2,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.88,
  });
  const thatchRoofMossy = makePhotoTex(imgs.imgThatchMossy, 512, 512, {
    repeatX: 3,
    repeatY: 2,
    anisotropy: aniso,
    brightnessBoost: 0.92,
    saturation: 1.12,
  });
  const thatchNormal = makeSobelNormalTex(imgs.imgThatchMossy, 256, 256, 3.8, {
    repeatX: 3,
    repeatY: 2,
  });
  const roofShingle = makePhotoTex(imgs.imgRoofShingle, 512, 512, {
    repeatX: 3,
    repeatY: 2,
    anisotropy: aniso,
    brightnessBoost: 0.88,
  });
  const shingleNormal = makeSobelNormalTex(imgs.imgRoofShingle, 256, 256, 3.2, {
    repeatX: 3,
    repeatY: 2,
  });
  const fieldstone = makePhotoTex(imgs.imgFieldstone, 256, 256, {
    repeatX: 4,
    repeatY: 1,
    anisotropy: aniso,
    brightnessBoost: 0.96,
  });
  const fieldstoneNormal = makeSobelNormalTex(imgs.imgFieldstone, 256, 256, 3.6, {
    repeatX: 4,
    repeatY: 1,
  });
  const plankWood = makePhotoTex(imgs.imgPlankWood, 256, 256, {
    repeatX: 1,
    repeatY: 3,
    anisotropy: aniso,
    brightnessBoost: 0.94,
  });
  const plankNormal = makeSobelNormalTex(imgs.imgPlankWood, 256, 256, 2.6, {
    repeatX: 1,
    repeatY: 3,
  });

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

  return {
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
    contactShadowTex,
  };
}

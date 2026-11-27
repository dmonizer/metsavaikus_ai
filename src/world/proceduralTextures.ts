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

import { createTextureFactoryScope, loadImage } from './textures/textureUtils';
import { createArchitectureTextures, type ArchitectureTextures } from './textures/architectureTextures';
import {
  createTerrainAndStoneTextures,
  type TerrainAndStoneTextures,
} from './textures/terrainAndStoneTextures';
import { createMushroomTextures, type MushroomTextures } from './textures/mushroomTextures';
import {
  createBarkTextures,
  createFoliageCardTextures,
  type BarkTextures,
  type FoliageCardTextures,
} from './textures/barkAndFoliageTextures';

export interface WorldTextures
  extends BarkTextures,
    ArchitectureTextures,
    TerrainAndStoneTextures,
    MushroomTextures,
    FoliageCardTextures {
  dispose: () => void;
}

export async function createWorldTextures(maxAnisotropy: number): Promise<WorldTextures> {
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

  const scope = createTextureFactoryScope(maxAnisotropy);
  try {
    const bark = createBarkTextures(scope, imgPineBark);
    const architecture = createArchitectureTextures(scope, {
      imgLogWeathered,
      imgLogWarm,
      imgGableBoards,
      imgThatchMossy,
      imgRoofShingle,
      imgFieldstone,
      imgPlankWood,
    });
    const terrainAndStone = createTerrainAndStoneTextures(scope, {
      imgForestFloor,
      imgTrailNeedles,
      imgMeadowGrass,
      imgFieldstone,
    });
    const mushrooms = createMushroomTextures(scope, {
      imgBoleteCap,
      imgBoleteStem,
    });
    const foliageCards = createFoliageCardTextures(scope, {
      imgLeafPatch,
      imgSpruceFoliage,
      imgMeadowGrass,
      imgForestFloor,
    });

    return {
      ...bark,
      ...architecture,
      ...terrainAndStone,
      ...mushrooms,
      ...foliageCards,
      dispose: () => {
        scope.disposeAll();
      },
    };
  } catch (err) {
    scope.disposeAll();
    throw err;
  }
}

import type { MaterialProfile } from '../../soundscape/types';

export const SOUNDSCAPE_MATERIALS: MaterialProfile[] = [
  {
    id: 'wood',
    footsteps: {
      walk: 'wooden_floor_walk',
      run: { sound: 'wooden_floor_walk', volumeScale: 1.2, pitchScale: 1.1 },
      crouch: { sound: 'wooden_floor_walk', volumeScale: 0.52, pitchScale: 0.92 },
    },
    impact: { sound: 'wood_impact_solid' },
    hollowImpact: { sound: 'crate_impact_hollow' },
    break: { sound: 'wood_break' },
    fall: { sound: 'player_fall_wood', volumeScale: 0.95, pitchScale: 1.0 },
    fallHeavy: { sound: 'player_fall_wood', volumeScale: 1.25, pitchScale: 0.88 },
    doorOpen: { sound: 'intact_door_open' },
    doorClose: { sound: 'intact_door_close' },
  },
  {
    id: 'wooden_floor',
    extends: 'wood',
    footsteps: {
      walk: 'wooden_floor_walk',
      run: { sound: 'wooden_floor_walk', volumeScale: 1.25, pitchScale: 1.08 },
      crouch: { sound: 'wooden_floor_walk', volumeScale: 0.5, pitchScale: 0.92 },
    },
  },
  {
    id: 'decrepit_wooden_floor',
    extends: 'wooden_floor',
    doorOpen: { sound: 'decrepid_door_creak' },
    doorClose: { sound: 'decrepid_door_creak', pitchScale: 0.9 },
    additionalReactions: [
      { event: 'player.step', probability: 0.15, sound: 'floorboard_creak' },
      { event: 'player.fall', probability: 0.7, sound: 'floorboard_creak' },
    ],
  },
  {
    id: 'wooden_boardwalk',
    extends: 'wood',
    footsteps: {
      walk: { sound: 'wooden_floor_walk', volumeScale: 0.95, pitchScale: 0.96 },
      run: { sound: 'wooden_floor_walk', volumeScale: 1.2, pitchScale: 1.06 },
      crouch: { sound: 'wooden_floor_walk', volumeScale: 0.48, pitchScale: 0.88 },
    },
    fall: { sound: 'player_fall_wood', volumeScale: 1.0, pitchScale: 0.94 },
    fallHeavy: { sound: 'player_fall_wood', volumeScale: 1.28, pitchScale: 0.84 },
  },
  {
    id: 'forest_floor',
    footsteps: {
      walk: 'forest_floor_walk',
      run: { sound: 'forest_floor_walk', volumeScale: 1.15, pitchScale: 1.15 },
      crouch: { sound: 'forest_floor_walk', volumeScale: 0.52, pitchScale: 0.9 },
    },
    impact: { sound: 'wood_impact_solid', volumeScale: 0.7 },
    fall: { sound: 'player_fall_forest', volumeScale: 0.92, pitchScale: 1.0 },
    fallHeavy: { sound: 'player_fall_forest', volumeScale: 1.24, pitchScale: 0.86 },
  },
  {
    id: 'grass',
    extends: 'forest_floor',
    footsteps: {
      walk: 'grass_walk_step',
      run: { sound: 'grass_walk_step', volumeScale: 1.25, pitchScale: 1.12 },
      crouch: { sound: 'grass_walk_step', volumeScale: 0.48, pitchScale: 0.92 },
    },
  },
  {
    id: 'gravel',
    footsteps: {
      walk: 'gravel_walk_loop',
      run: { sound: 'gravel_walk_loop', volumeScale: 1.2, pitchScale: 1.15 },
      crouch: { sound: 'gravel_walk_loop', volumeScale: 0.55, pitchScale: 0.92 },
    },
    impact: { sound: 'stone_impact_solid', volumeScale: 0.8 },
    fall: { sound: 'player_fall_stone', volumeScale: 0.92, pitchScale: 1.06 },
    fallHeavy: { sound: 'player_fall_stone', volumeScale: 1.22, pitchScale: 0.94 },
  },
  {
    id: 'soil',
    extends: 'forest_floor',
  },
  {
    id: 'mud',
    extends: 'forest_floor',
    footsteps: {
      walk: { sound: 'swamp_mud_wade', volumeScale: 0.92, pitchScale: 0.96 },
      wade: { sound: 'swamp_mud_wade', volumeScale: 1.05, pitchScale: 0.92 },
      run: { sound: 'swamp_mud_wade', volumeScale: 1.18, pitchScale: 1.08 },
      crouch: { sound: 'swamp_mud_wade', volumeScale: 0.56, pitchScale: 0.88 },
    },
    fall: { sound: 'player_fall_mud', volumeScale: 0.98, pitchScale: 0.98 },
    fallHeavy: { sound: 'player_fall_mud', volumeScale: 1.28, pitchScale: 0.86 },
  },
  {
    id: 'water',
    footsteps: {
      walk: 'water_wade_loop',
      wade: 'water_wade_loop',
      swim: { sound: 'water_swim_loop', volumeScale: 1.0, pitchScale: 1.0 },
      run: { sound: 'water_wade_loop', volumeScale: 1.15, pitchScale: 1.08 },
    },
    splash: { sound: 'distant_water_splash' },
    fall: { sound: 'player_fall_water', volumeScale: 1.0, pitchScale: 1.0 },
    fallHeavy: { sound: 'player_fall_water_heavy', volumeScale: 1.2, pitchScale: 0.92 },
  },
  {
    id: 'stone',
    footsteps: {
      walk: { sound: 'gravel_walk_loop', volumeScale: 0.85, pitchScale: 0.9 },
      run: { sound: 'gravel_walk_loop', volumeScale: 1.05, pitchScale: 1.0 },
    },
    impact: { sound: 'stone_impact_solid' },
    break: { sound: 'stone_impact_solid', volumeScale: 1.25 },
    fall: { sound: 'player_fall_stone', volumeScale: 1.0, pitchScale: 0.92 },
    fallHeavy: { sound: 'player_fall_stone', volumeScale: 1.28, pitchScale: 0.82 },
  },
  {
    id: 'concrete',
    extends: 'stone',
  },
  {
    id: 'metal',
    impact: { sound: 'metal_impact_solid' },
    break: { sound: 'metal_impact_solid', volumeScale: 1.2 },
    fall: { sound: 'metal_impact_solid', volumeScale: 0.85, pitchScale: 0.95 },
  },
  {
    id: 'glass',
    impact: { sound: 'stone_impact_solid', pitchScale: 1.45, volumeScale: 0.75 },
    break: { sound: 'crate_smash_break', pitchScale: 1.5, volumeScale: 0.9 },
  },
  {
    id: 'snow',
    extends: 'grass',
    footsteps: {
      walk: { sound: 'grass_walk_step', volumeScale: 0.78, pitchScale: 0.84 },
    },
    fall: { sound: 'player_fall_forest', volumeScale: 0.78, pitchScale: 0.84 },
  },
  {
    id: 'ice',
    extends: 'stone',
  },
];

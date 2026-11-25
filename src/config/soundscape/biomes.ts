import type { BiomeProfile } from '../../soundscape/types';

export const SOUNDSCAPE_BIOMES: BiomeProfile[] = [
  {
    id: 'forest',
    layers: [
      { sound: 'forest_day_ambience', weight: 1.0, tags: ['day'] },
      { sound: 'forest_night_ambience', weight: 1.0, tags: ['night'] },
      { sound: 'wind_forest_trees', weight: 1.0 },
      { sound: 'wind_open', weight: 0.55 },
    ],
  },
  {
    id: 'thicket',
    extends: 'forest',
    layers: [
      { sound: 'forest_day_ambience', weight: 1.0, tags: ['day'] },
      { sound: 'forest_night_ambience', weight: 1.0, tags: ['night'] },
      { sound: 'wind_forest_trees', weight: 1.15 },
    ],
  },
  {
    id: 'meadow',
    layers: [
      { sound: 'forest_day_ambience', weight: 0.7, tags: ['day'] },
      { sound: 'forest_night_ambience', weight: 0.75, tags: ['night'] },
      { sound: 'wind_open', weight: 1.0 },
    ],
  },
  {
    id: 'road',
    extends: 'meadow',
    layers: [
      { sound: 'forest_day_ambience', weight: 0.7, tags: ['day'] },
      { sound: 'forest_night_ambience', weight: 0.75, tags: ['night'] },
      { sound: 'wind_open', weight: 1.0 },
    ],
  },
  {
    id: 'village',
    extends: 'meadow',
    layers: [
      { sound: 'forest_day_ambience', weight: 0.6, tags: ['day'] },
      { sound: 'forest_night_ambience', weight: 0.7, tags: ['night'] },
      { sound: 'wind_open', weight: 0.85 },
    ],
  },
  {
    id: 'abandoned',
    extends: 'forest',
    layers: [
      { sound: 'forest_day_ambience', weight: 0.75, tags: ['day'] },
      { sound: 'forest_night_ambience', weight: 0.95, tags: ['night'] },
      { sound: 'wind_forest_trees', weight: 0.9 },
      { sound: 'wind_open', weight: 0.7 },
    ],
  },
  {
    id: 'marsh',
    layers: [
      { sound: 'marsh_ambience', weight: 1.0 },
      { sound: 'forest_night_ambience', weight: 0.6, tags: ['night'] },
      { sound: 'wind_open', weight: 0.95 },
    ],
  },
  {
    id: 'swamp',
    extends: 'marsh',
    layers: [
      { sound: 'marsh_ambience', weight: 1.0 },
      { sound: 'forest_night_ambience', weight: 0.6, tags: ['night'] },
      { sound: 'wind_open', weight: 0.95 },
    ],
  },
  {
    id: 'island',
    extends: 'marsh',
    layers: [
      { sound: 'marsh_ambience', weight: 0.9 },
      { sound: 'forest_day_ambience', weight: 0.6, tags: ['day'] },
      { sound: 'wind_open', weight: 0.9 },
    ],
  },
];

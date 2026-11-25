import type { BusDefinition } from '../../soundscape/types';

export const SOUNDSCAPE_BUSES: BusDefinition[] = [
  { id: 'master', parent: null, volume: 1.0 },
  { id: 'environment', parent: 'master', volume: 0.9 },
  { id: 'environment.ambience', parent: 'environment', volume: 0.78 },
  { id: 'environment.weather', parent: 'environment', volume: 0.9 },
  { id: 'environment.weather.rain', parent: 'environment.weather', volume: 0.85 },
  { id: 'environment.weather.wind', parent: 'environment.weather', volume: 0.8 },
  {
    id: 'environment.weather.thunder',
    parent: 'environment.weather',
    volume: 1.0,
    ducking: [
      { targetBus: 'environment.wildlife', gain: 0.45, attackMs: 80, releaseMs: 1200 },
      { targetBus: 'environment.ambience', gain: 0.65, attackMs: 80, releaseMs: 900 },
    ],
  },
  { id: 'environment.water', parent: 'environment', volume: 0.85 },
  { id: 'environment.wildlife', parent: 'environment', volume: 0.9 },
  { id: 'environment.wildlife.birds', parent: 'environment.wildlife', volume: 0.9, maxConcurrency: 6 },
  { id: 'environment.wildlife.mammals', parent: 'environment.wildlife', volume: 0.95, maxConcurrency: 3 },
  { id: 'environment.wildlife.insects', parent: 'environment.wildlife', volume: 0.75, maxConcurrency: 5 },
  { id: 'player', parent: 'master', volume: 0.95, bypassEnvironmentalAttenuation: true },
  { id: 'player.movement', parent: 'player', volume: 0.9, maxConcurrency: 4 },
  { id: 'player.breathing', parent: 'player', volume: 0.72, maxConcurrency: 2 },
  { id: 'player.vocalisation', parent: 'player', volume: 0.85, maxConcurrency: 2 },
  { id: 'player.equipment', parent: 'player', volume: 0.8, maxConcurrency: 3 },
  { id: 'objects', parent: 'master', volume: 0.9, maxConcurrency: 8 },
  {
    id: 'weapons',
    parent: 'master',
    volume: 1.0,
    ducking: [
      { targetBus: 'environment.ambience', gain: 0.35, attackMs: 40, releaseMs: 1400 },
      { targetBus: 'music', gain: 0.5, attackMs: 40, releaseMs: 1500 },
    ],
  },
  { id: 'music', parent: 'master', volume: 0.25, bypassEnvironmentalAttenuation: true, maxConcurrency: 2 },
  { id: 'ui', parent: 'master', volume: 0.75, bypassEnvironmentalAttenuation: true, maxConcurrency: 4 },
];

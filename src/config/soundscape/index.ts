import type { EventReactionDefinition, SoundscapeConfig } from '../../soundscape/types';
import { SOUNDSCAPE_ACOUSTICS } from './acoustics';
import { SOUNDSCAPE_ASSETS } from './assets';
import { SOUNDSCAPE_BIOMES } from './biomes';
import { SOUNDSCAPE_BUSES } from './buses';
import { SOUNDSCAPE_DISTURBANCES } from './disturbances';
import { SOUNDSCAPE_MATERIALS } from './materials';
import { SOUNDSCAPE_MUSIC } from './music';
import { SOUNDSCAPE_SOUNDS } from './sounds';

export const SOUNDSCAPE_REACTIONS: EventReactionDefinition[] = [
  {
    id: 'gunshot_startles_nearby_birds',
    event: 'player.weapon.fire',
    probability: 0.9,
    delayMs: ['150ms', '850ms'],
    clock: 'simulation',
    scheduleConditions: {
      'listener.biome': { in: ['forest', 'thicket', 'meadow', 'island', 'abandoned', 'marsh'] },
    },
    executeConditions: {
      'weather.type': { not_in: ['storm'] },
    },
    emitEvent: {
      type: 'wildlife.bird.startled_gunshot',
      origin: 'environment',
    },
    exemptFromDisturbance: true,
    cooldownMs: '8s',
  },
  {
    id: 'footstep_startles_night_bird',
    event: 'player.step',
    probability: 0.03,
    delayMs: ['200ms', '1500ms'],
    clock: 'simulation',
    scheduleConditions: {
      all: [
        { 'astronomy.is_night': true },
        { 'player.activity': { not_in: ['crouching', 'sleeping'] } },
        { 'listener.biome': { in: ['forest', 'thicket', 'abandoned', 'island'] } },
      ],
    },
    executeConditions: {
      all: [
        { 'astronomy.is_night': true },
        { 'weather.type': { in: ['clear', 'cloudy', 'mist'] } },
      ],
    },
    emitEvent: {
      type: 'wildlife.bird.escape',
      origin: 'environment',
    },
    cooldownMs: '1h',
    maxOccurrences: 2,
    quotaPeriod: 'night',
    scope: 'global',
  },
  {
    id: 'wood_break_startles_bird',
    event: 'object.break',
    probability: 0.35,
    delayMs: ['180ms', '900ms'],
    clock: 'simulation',
    scheduleConditions: {
      'listener.biome': { in: ['forest', 'thicket', 'abandoned', 'island'] },
    },
    executeConditions: {
      'weather.type': { in: ['clear', 'cloudy', 'mist'] },
    },
    playSound: 'bird_escaping_flight_gunshot',
    cooldownMs: '45s',
    exemptFromDisturbance: true,
  },
];

export const DEFAULT_SOUNDSCAPE_CONFIG: SoundscapeConfig = {
  version: 1,
  engine: {
    maxActiveVoices: 24,
    maxVirtualSources: 64,
    maxPendingEvents: 128,
    maxReactionChainDepth: 4,
    maxEventsPerChain: 16,
    occlusionQueryRateHz: 15,
    maxOcclusionDistanceM: 120,
    masterLimiterEnabled: true,
    useEmbeddedThunderAmbience: false,
    suppressStochasticThunderWhenEmbedded: true,
  },
  buses: SOUNDSCAPE_BUSES,
  assets: SOUNDSCAPE_ASSETS,
  materials: SOUNDSCAPE_MATERIALS,
  acoustics: SOUNDSCAPE_ACOUSTICS,
  biomes: SOUNDSCAPE_BIOMES,
  sounds: SOUNDSCAPE_SOUNDS,
  reactions: SOUNDSCAPE_REACTIONS,
  disturbances: SOUNDSCAPE_DISTURBANCES,
  music: SOUNDSCAPE_MUSIC,
};

export {
  SOUNDSCAPE_ACOUSTICS,
  SOUNDSCAPE_ASSETS,
  SOUNDSCAPE_BIOMES,
  SOUNDSCAPE_BUSES,
  SOUNDSCAPE_DISTURBANCES,
  SOUNDSCAPE_MATERIALS,
  SOUNDSCAPE_MUSIC,
  SOUNDSCAPE_SOUNDS,
};

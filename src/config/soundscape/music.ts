import type { MusicProfile } from '../../soundscape/types';

export const SOUNDSCAPE_MUSIC: MusicProfile[] = [
  {
    id: 'forest_day_music',
    bus: 'music',
    conditions: {
      all: [
        { 'settings.music_enabled': true },
        { 'settings.music_volume': { gt: 0 } },
        { 'astronomy.is_night': false },
        { 'weather.type': { in: ['clear', 'cloudy', 'mist'] } },
      ],
    },
    assets: [{ assetId: 'proc_music_nordic_day', weight: 1 }],
    playback: {
      volume: 0.34,
      loop: { count: 1, pause: ['45s', '90s'] },
      fadeInMs: '4s',
      fadeOutMs: '4s',
      crossfadeMs: '4s',
      onConditionLost: 'fade_out',
      selection: 'shuffle_bag',
      avoidConsecutiveRepetition: true,
      priority: 10,
      maxInstances: 1,
      concurrencyPolicy: 'replace_oldest',
    },
  },
  {
    id: 'forest_night_music',
    bus: 'music',
    conditions: {
      all: [
        { 'settings.music_enabled': true },
        { 'settings.music_volume': { gt: 0 } },
        { 'astronomy.is_night': true },
      ],
    },
    assets: [{ assetId: 'proc_music_forest_night', weight: 1 }],
    playback: {
      volume: 0.3,
      loop: { count: 1, pause: ['60s', '110s'] },
      fadeInMs: '5s',
      fadeOutMs: '5s',
      crossfadeMs: '5s',
      onConditionLost: 'fade_out',
      selection: 'shuffle_bag',
      avoidConsecutiveRepetition: true,
      priority: 10,
      maxInstances: 1,
      concurrencyPolicy: 'replace_oldest',
    },
  },
];

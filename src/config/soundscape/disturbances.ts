import type { DisturbanceProfile } from '../../soundscape/types';

export const SOUNDSCAPE_DISTURBANCES: DisturbanceProfile[] = [
  {
    id: 'gunshot_disturbance',
    trigger: {
      event: 'player.weapon.fire',
      minIntensity: 0.5,
    },
    spatial: {
      origin: 'event.position',
      radiusM: '300m',
      attenuation: 'linear',
    },
    overlapPolicy: 'strongest_and_longest',
    activationDelayMs: '250ms',
    effects: [
      {
        target: 'environment.wildlife.birds',
        gain: 0.0,
        blockNewEvents: true,
        fadeOutMs: '300ms',
        recoveryDelayMs: ['3m', '5m'],
        recoveryFadeMs: '2m',
      },
      {
        target: 'environment.wildlife.mammals',
        gain: 0.0,
        blockNewEvents: true,
        fadeOutMs: '400ms',
        recoveryDelayMs: ['4m', '6m'],
        recoveryFadeMs: '2m',
      },
      {
        target: 'environment.wildlife.insects',
        gain: 0.2,
        blockNewEvents: false,
        fadeOutMs: '200ms',
        recoveryDelayMs: ['10s', '30s'],
        recoveryFadeMs: '30s',
      },
      {
        target: 'environment.ambience',
        gain: 0.4,
        blockNewEvents: false,
        fadeOutMs: '400ms',
        recoveryDelayMs: ['20s', '45s'],
        recoveryFadeMs: '45s',
      },
    ],
    exceptions: {
      sounds: ['bird_escaping_flight_gunshot', 'nighttime_bird_escape'],
      buses: ['environment.weather', 'player', 'music', 'ui'],
      tags: ['startled', 'gunshot_reaction'],
    },
    tags: ['gunshot', 'shock'],
  },
  {
    id: 'thunder_disturbance',
    trigger: {
      event: 'weather.thunder',
      minIntensity: 0.7,
    },
    spatial: {
      origin: 'event.position',
      radiusM: '420m',
      attenuation: 'linear',
    },
    overlapPolicy: 'strongest_and_longest',
    activationDelayMs: '200ms',
    effects: [
      {
        target: 'environment.wildlife.birds',
        gain: 0.15,
        blockNewEvents: true,
        fadeOutMs: '350ms',
        recoveryDelayMs: ['20s', '45s'],
        recoveryFadeMs: '30s',
      },
      {
        target: 'environment.wildlife.mammals',
        gain: 0.2,
        blockNewEvents: true,
        fadeOutMs: '400ms',
        recoveryDelayMs: ['30s', '60s'],
        recoveryFadeMs: '35s',
      },
    ],
    exceptions: {
      buses: ['environment.weather', 'player', 'music', 'ui'],
      tags: ['startled'],
    },
    tags: ['thunder', 'weather'],
  },
];

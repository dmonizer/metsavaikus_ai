import type {
  AcousticProfile,
  BusId,
  SpatialMode,
  StructureContext,
  WorldContext,
} from './types';

export interface AcousticEvaluation {
  profileId: string;
  enclosure: number;
  roofCoverage: number;
  portalOpenness: number;
  exteriorGain: number;
  exteriorLowpassHz: number;
  roomReverb: number;
  underwater: boolean;
}

export interface EmitterPropagationResult {
  gainMultiplier: number;
  lowpassHz: number;
  reverbMix: number;
  occluded: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class AcousticEnvironmentManager {
  private profileMap: Map<string, AcousticProfile>;
  private smoothedEnclosure = 0;
  private smoothedRoofCoverage = 0;
  private smoothedPortalOpenness = 0;
  private smoothedExteriorGain = 1;
  private smoothedExteriorLowpassHz = 20000;
  private smoothedReverb = 0.05;
  private currentProfileId = 'outdoor';
  private isUnderwater = false;

  constructor(profiles: readonly AcousticProfile[]) {
    this.profileMap = new Map(profiles.map((p) => [p.id, p]));
  }

  updateProfiles(profiles: readonly AcousticProfile[]): void {
    this.profileMap = new Map(profiles.map((p) => [p.id, p]));
  }

  getProfile(profileId: string): AcousticProfile | undefined {
    return this.profileMap.get(profileId);
  }

  computeTargetForStructure(structure: StructureContext): {
    profile: AcousticProfile;
    exteriorGain: number;
    exteriorLowpassHz: number;
    reverb: number;
  } {
    const profile =
      this.profileMap.get(structure.profileId) ??
      this.profileMap.get(structure.quality) ??
      this.profileMap.get('outdoor') ?? {
        id: 'outdoor',
        enclosure: 0,
        roofCoverage: 0,
        condition: 'intact',
        exteriorGainDefault: 1.0,
        lowpassHz: 20000,
        reverbLevel: 0.05,
        portalBleedFactor: 0.5,
      };

    // Structural condition & portal openness modulate effective exterior bleed continuously
    const enclosure = clamp01(structure.enclosure ?? profile.enclosure);
    const roofCoverage = clamp01(structure.roofCoverage ?? profile.roofCoverage);
    const portalOpenness = clamp01(structure.portalOpenness ?? 0);

    // Roof loss increases direct sky/rain/wildlife transmission cleanly
    const roofLossBleed = (1 - roofCoverage) * 0.45 * enclosure;
    // Open door lets exterior sound bleed through portal
    const portalBleed = portalOpenness * (profile.portalBleedFactor ?? 0.48) * enclosure;

    const baseGain = profile.exteriorGainDefault;
    const exteriorGain = clamp01(baseGain + (1 - baseGain) * clamp01(roofLossBleed + portalBleed));

    const openLowpass = lerp(profile.lowpassHz, 12000, clamp01(portalBleed + roofLossBleed));
    const exteriorLowpassHz = Math.round(Math.max(250, Math.min(20000, openLowpass)));
    const reverb = clamp01(profile.reverbLevel * (1 - portalOpenness * 0.35) * (0.4 + 0.6 * roofCoverage));

    return {
      profile,
      exteriorGain,
      exteriorLowpassHz,
      reverb,
    };
  }

  step(dtRealSec: number, world: WorldContext): AcousticEvaluation {
    const target = this.computeTargetForStructure(world.structure);
    this.currentProfileId = target.profile.id;
    this.isUnderwater = world.listener.underwater;

    const smooth = Math.min(1, Math.max(0.01, dtRealSec) * 4.5);
    this.smoothedEnclosure = lerp(this.smoothedEnclosure, world.structure.enclosure, smooth);
    this.smoothedRoofCoverage = lerp(this.smoothedRoofCoverage, world.structure.roofCoverage, smooth);
    this.smoothedPortalOpenness = lerp(this.smoothedPortalOpenness, world.structure.portalOpenness, smooth);
    this.smoothedExteriorGain = lerp(this.smoothedExteriorGain, target.exteriorGain, smooth);
    this.smoothedExteriorLowpassHz = lerp(this.smoothedExteriorLowpassHz, target.exteriorLowpassHz, smooth);
    this.smoothedReverb = lerp(this.smoothedReverb, target.reverb, smooth);

    return this.getEvaluation();
  }

  snapToWorld(world: WorldContext): AcousticEvaluation {
    const target = this.computeTargetForStructure(world.structure);
    this.currentProfileId = target.profile.id;
    this.isUnderwater = world.listener.underwater;
    this.smoothedEnclosure = world.structure.enclosure;
    this.smoothedRoofCoverage = world.structure.roofCoverage;
    this.smoothedPortalOpenness = world.structure.portalOpenness;
    this.smoothedExteriorGain = target.exteriorGain;
    this.smoothedExteriorLowpassHz = target.exteriorLowpassHz;
    this.smoothedReverb = target.reverb;
    return this.getEvaluation();
  }

  getEvaluation(): AcousticEvaluation {
    return {
      profileId: this.currentProfileId,
      enclosure: Math.round(this.smoothedEnclosure * 1000) / 1000,
      roofCoverage: Math.round(this.smoothedRoofCoverage * 1000) / 1000,
      portalOpenness: Math.round(this.smoothedPortalOpenness * 1000) / 1000,
      exteriorGain: Math.round(this.smoothedExteriorGain * 1000) / 1000,
      exteriorLowpassHz: Math.round(this.smoothedExteriorLowpassHz),
      roomReverb: Math.round(this.smoothedReverb * 1000) / 1000,
      underwater: this.isUnderwater,
    };
  }

  evaluatePropagation(params: {
    busId: BusId;
    spatialMode: SpatialMode;
    environmentalAcoustics: boolean;
    occlusionEnabled: boolean;
    bypassBusEnvironmental: boolean;
    sourceInsideSameStructure: boolean;
    sourceStructureId?: string | null;
    listenerStructureId?: string | null;
    occlusionFactor?: number;
    soundTags?: readonly string[];
  }): EmitterPropagationResult {
    const profile = this.profileMap.get(this.currentProfileId);

    // Local/non-environmental or explicitly bypassed sounds keep full gain
    if (
      params.bypassBusEnvironmental ||
      !params.environmentalAcoustics ||
      params.spatialMode === 'non_spatial' ||
      params.spatialMode === 'player_attached'
    ) {
      let lowpassHz = 20000;
      let gainMultiplier = 1;
      if (this.isUnderwater && params.busId !== 'ui' && params.busId !== 'music') {
        lowpassHz = 480;
        gainMultiplier = 0.72;
      }
      return {
        gainMultiplier,
        lowpassHz,
        reverbMix: params.spatialMode === 'player_attached' ? this.smoothedReverb * 0.6 : 0,
        occluded: false,
      };
    }

    // Same-structure emitters (interior footsteps, floorboards, door creaks, room tone) bypass exterior wall attenuation!
    if (
      params.sourceInsideSameStructure ||
      (params.sourceStructureId &&
        params.listenerStructureId &&
        params.sourceStructureId === params.listenerStructureId)
    ) {
      return {
        gainMultiplier: this.isUnderwater ? 0.68 : 1.0,
        lowpassHz: this.isUnderwater ? 480 : 18500,
        reverbMix: this.smoothedReverb,
        occluded: false,
      };
    }

    // Exterior or different-building emitter heard from inside/outside
    let gainMultiplier = this.smoothedExteriorGain;
    let lowpassHz = this.smoothedExteriorLowpassHz;

    // Apply per-category transmission overrides (e.g. loud thunder stays partially audible inside solid stone/wood house)
    if (profile?.categoryTransmission) {
      const matchKey =
        params.soundTags?.find((t) => profile.categoryTransmission?.[t]) ??
        Object.keys(profile.categoryTransmission).find((k) => params.busId.startsWith(k));
      if (matchKey) {
        const cat = profile.categoryTransmission[matchKey];
        const roofPortalBleed = clamp01(
          (1 - this.smoothedRoofCoverage) * 0.45 * this.smoothedEnclosure +
            this.smoothedPortalOpenness * (profile.portalBleedFactor ?? 0.48) * this.smoothedEnclosure
        );
        const catGain = clamp01(cat.gain + (1 - cat.gain) * roofPortalBleed);
        const catLp = Math.round(lerp(cat.lowpassHz, 12000, roofPortalBleed));
        gainMultiplier = catGain;
        lowpassHz = catLp;
      }
    }

    // Extra building wall attenuation when both source and listener are in DIFFERENT buildings
    if (
      params.sourceStructureId &&
      params.listenerStructureId &&
      params.sourceStructureId !== params.listenerStructureId
    ) {
      gainMultiplier *= 0.35;
      lowpassHz = Math.min(lowpassHz, 900);
    }

    // Line-of-sight occlusion ray/obstacle factor (0 = clear, 1 = blocked)
    const occ = params.occlusionEnabled ? clamp01(params.occlusionFactor ?? 0) : 0;
    if (occ > 0.01) {
      gainMultiplier *= lerp(1, 0.35, occ);
      lowpassHz = Math.min(lowpassHz, lerp(16000, 950, occ));
    }

    if (this.isUnderwater) {
      gainMultiplier *= 0.45;
      lowpassHz = Math.min(lowpassHz, 420);
    }

    return {
      gainMultiplier: clamp01(gainMultiplier),
      lowpassHz: Math.max(200, Math.min(20000, Math.round(lowpassHz))),
      reverbMix: this.smoothedReverb * 0.5,
      occluded: occ > 0.25,
    };
  }
}

import {
  Clock,
  parseDistanceM,
  parseDurationMs,
  resolvePeriodKey,
  SeededRng,
} from './clocks';
import type { ConditionEvaluator, EntityContext } from './conditionEvaluator';
import type { DisturbanceManager } from './disturbanceManager';
import type { AudioMixer } from './mixer';
import type {
  ConditionNode,
  EventReactionDefinition,
  PersistedSoundscapeState,
  QuotaPeriod,
  QuotaScope,
  RuleDiagnosticsRow,
  SimulationEvent,
  SoundDefinition,
  TimeWindowDef,
  WorldContext,
} from './types';

interface WindowCounterState {
  sampledTarget: number | null;
  count: number;
  reserved: number;
  lastTriggeredSimMs: number | null;
}

interface PendingReactionEntry {
  id: string;
  reaction: EventReactionDefinition;
  executeAtSimMs: number;
  executeAtRealMs: number;
  useSimClock: boolean;
  sourceEvent: SimulationEvent;
  reservedQuotaKey?: string;
}

export interface TriggerRequest {
  sound: SoundDefinition;
  originEvent?: SimulationEvent;
  sourceEntity?: EntityContext;
  exemptFromDisturbance?: boolean;
  skipQuotaRecord?: boolean;
}

function collectTimeWindowsFromNode(
  node: ConditionNode | undefined,
  out: TimeWindowDef[]
): void {
  if (!node) return;
  const t = node.time;
  if (t) {
    if (t.from && t.to) out.push({ from: t.from, to: t.to });
    if (t.windows) {
      for (const w of t.windows) {
        if (Array.isArray(w)) out.push({ from: w[0], to: w[1] });
        else out.push(w);
      }
    }
  }
  if (node.all) {
    for (const child of node.all) {
      collectTimeWindowsFromNode(child, out);
    }
  }
  if (node.any) {
    for (const child of node.any) {
      collectTimeWindowsFromNode(child, out);
    }
  }
}

function extractTimeWindows(def: SoundDefinition): TimeWindowDef[] {
  const out: TimeWindowDef[] = [];
  collectTimeWindowsFromNode(def.conditions, out);
  return out;
}

export class RuleScheduler {
  private windowStates = new Map<string, WindowCounterState>();
  private cooldownUntilSimMs = new Map<string, number>();
  private nextAttemptSimMs = new Map<string, number>();
  private nextAttemptRealMs = new Map<string, number>();
  private lastTriggerSimMs = new Map<string, number>();
  private pendingReactions: PendingReactionEntry[] = [];
  private chainEventCounts = new Map<string, number>();
  private prevSimMs: number | null = null;
  private reactionSeq = 1;

  private buildScopeId(
    scope: QuotaScope | undefined,
    world: WorldContext,
    event?: SimulationEvent | null,
    sourceEntity?: EntityContext
  ): string {
    switch (scope) {
      case 'global':
        return 'global';
      case 'player':
        return world.listener.id || 'player';
      case 'region':
        return world.geography.regionId || 'region_default';
      case 'biome':
        return sourceEntity?.biome ?? world.listener.biome;
      case 'emitter':
        return sourceEntity?.id ?? event?.sourceEntityId ?? 'emitter_default';
      case 'entity':
        return event?.targetEntityId ?? event?.sourceEntityId ?? 'entity_default';
      default:
        return world.listener.id || 'player';
    }
  }

  private getWindowKey(
    groupKey: string,
    period: QuotaPeriod,
    scopeId: string,
    simTimeMs: number,
    windows: readonly TimeWindowDef[],
    isNight: boolean
  ): string {
    const pKey = resolvePeriodKey(simTimeMs, period, windows, isNight);
    return `${groupKey}|${scopeId}|${pKey}`;
  }

  private getOrCreateWindowState(
    key: string,
    range: [number, number] | undefined,
    rng: SeededRng
  ): WindowCounterState {
    let st = this.windowStates.get(key);
    if (!st) {
      st = {
        sampledTarget: range ? rng.int(range[0], range[1]) : null,
        count: 0,
        reserved: 0,
        lastTriggeredSimMs: null,
      };
      this.windowStates.set(key, st);
    }
    return st;
  }

  reconcileClockJump(nowSimMs: number, nowRealMs: number): void {
    if (this.prevSimMs !== null && nowSimMs < this.prevSimMs) {
      // Backward clock jump: clamp future timers & cooldowns so rules don't freeze
      const backDelta = this.prevSimMs - nowSimMs;
      for (const [k, until] of this.cooldownUntilSimMs) {
        if (until > nowSimMs) {
          this.cooldownUntilSimMs.set(k, Math.max(nowSimMs, until - backDelta));
        }
      }
      for (const [k, due] of this.nextAttemptSimMs) {
        if (due > nowSimMs) {
          this.nextAttemptSimMs.set(k, Math.max(nowSimMs, due - backDelta));
        }
      }
      for (const [k, last] of this.lastTriggerSimMs) {
        if (last > nowSimMs) {
          this.lastTriggerSimMs.set(k, nowSimMs);
        }
      }
      for (const pr of this.pendingReactions) {
        if (pr.useSimClock && pr.executeAtSimMs > nowSimMs) {
          pr.executeAtSimMs = Math.max(nowSimMs, pr.executeAtSimMs - backDelta);
        }
      }
      for (const st of this.windowStates.values()) {
        if (st.lastTriggeredSimMs !== null && st.lastTriggeredSimMs > nowSimMs) {
          st.lastTriggeredSimMs = nowSimMs;
        }
      }
    }
    this.prevSimMs = nowSimMs;
    void nowRealMs;
  }

  canTriggerSound(params: {
    sound: SoundDefinition;
    world: WorldContext;
    evaluator: ConditionEvaluator;
    disturbances: DisturbanceManager;
    mixer: AudioMixer;
    rng: SeededRng;
    nowSimMs: number;
    nowRealMs: number;
    event?: SimulationEvent | null;
    sourceEntity?: EntityContext;
    exemptFromDisturbance?: boolean;
  }): { eligible: boolean; reasons: string[]; quotaKey: string; maxAllowed: number | null; sampledTarget: number | null; currentUsed: number } {
    const { sound, world, evaluator, disturbances, mixer, rng, nowSimMs, nowRealMs, event, sourceEntity } = params;
    const reasons: string[] = [];

    // Check embedded thunder safeguard
    if (sound.embeddedThunderSuppressed && world.settings.useEmbeddedThunderAmbience) {
      return {
        eligible: false,
        reasons: ['suppressed because embedded_thunder weather loop is enabled'],
        quotaKey: '',
        maxAllowed: null,
        sampledTarget: null,
        currentUsed: 0,
      };
    }

    // 1. Disturbance generation block check (suppressed calls do NOT consume quotas!)
    const checkPos = sourceEntity?.position ?? event?.position ?? world.listener.position;
    const distRes = disturbances.evaluateSuppression({
      soundId: sound.id,
      busId: sound.bus,
      tags: sound.tags,
      position: checkPos,
      simTimeMs: nowSimMs,
      mixer,
      exemptFromDisturbance: params.exemptFromDisturbance,
    });
    if (distRes.blockNewEvents) {
      return {
        eligible: false,
        reasons: ['blocked by active spatial disturbance'],
        quotaKey: '',
        maxAllowed: null,
        sampledTarget: null,
        currentUsed: 0,
      };
    }

    // 2. Conditions evaluation (conditions take precedence over targets!)
    const condRes = evaluator.evaluate(
      sound.conditions,
      {
        world,
        event,
        source: sourceEntity,
        isDisturbedAtListener: disturbances.isListenerInDisturbance(world.listener.position, nowSimMs),
      },
      `sound:${sound.id}`,
      nowRealMs
    );
    if (!condRes.passed) {
      reasons.push(...condRes.reasons);
    }

    // 3. Quota & interval check
    const windows = extractTimeWindows(sound);
    const period: QuotaPeriod =
      sound.limits?.quotaPeriod ??
      sound.schedule?.quotaPeriod ??
      (windows.length > 0 ? 'window' : 'all_time');
    const scope = sound.limits?.scope ?? sound.schedule?.quotaScope ?? 'player';
    const scopeId = this.buildScopeId(scope, world, event, sourceEntity);
    const groupKey = sound.limits?.quotaGroup ?? sound.schedule?.quotaGroup ?? sound.id;
    const quotaKey = this.getWindowKey(groupKey, period, scopeId, nowSimMs, windows, world.astronomy.isNight);

    const st = this.getOrCreateWindowState(quotaKey, sound.schedule?.occurrencesPerWindow, rng);
    const maxCap = sound.limits?.maxOccurrences ?? sound.schedule?.maxOccurrences ?? null;
    const effectiveLimit =
      st.sampledTarget !== null && maxCap !== null
        ? Math.min(st.sampledTarget, maxCap)
        : st.sampledTarget ?? maxCap;

    const used = st.count + st.reserved;
    if (effectiveLimit !== null && used >= effectiveLimit) {
      reasons.push(`quota reached (${used}/${effectiveLimit} in ${quotaKey})`);
    }

    const minIntMs = Math.max(
      parseDurationMs(sound.limits?.minInterval, 0),
      parseDurationMs(sound.schedule?.minInterval, 0),
      parseDurationMs(sound.limits?.cooldown, 0)
    );
    if (minIntMs > 0) {
      const last = this.lastTriggerSimMs.get(groupKey) ?? st.lastTriggeredSimMs;
      if (last !== null && nowSimMs - last < minIntMs) {
        const remSec = Math.ceil((minIntMs - (nowSimMs - last)) / 1000);
        reasons.push(`cooldown active (${remSec}s sim remaining)`);
      }
      const cdUntil = this.cooldownUntilSimMs.get(`${groupKey}|${scopeId}`);
      if (cdUntil !== undefined && nowSimMs < cdUntil) {
        reasons.push(`scoped cooldown active`);
      }
    }

    return {
      eligible: reasons.length === 0,
      reasons,
      quotaKey,
      maxAllowed: maxCap,
      sampledTarget: st.sampledTarget,
      currentUsed: used,
    };
  }

  recordSoundAccepted(
    sound: SoundDefinition,
    world: WorldContext,
    rng: SeededRng,
    nowSimMs: number,
    event?: SimulationEvent | null,
    sourceEntity?: EntityContext
  ): void {
    const windows = extractTimeWindows(sound);
    const period: QuotaPeriod =
      sound.limits?.quotaPeriod ??
      sound.schedule?.quotaPeriod ??
      (windows.length > 0 ? 'window' : 'all_time');
    const scope = sound.limits?.scope ?? sound.schedule?.quotaScope ?? 'player';
    const scopeId = this.buildScopeId(scope, world, event, sourceEntity);
    const groupKey = sound.limits?.quotaGroup ?? sound.schedule?.quotaGroup ?? sound.id;
    const quotaKey = this.getWindowKey(groupKey, period, scopeId, nowSimMs, windows, world.astronomy.isNight);

    const st = this.getOrCreateWindowState(quotaKey, sound.schedule?.occurrencesPerWindow, rng);
    st.count += 1;
    st.lastTriggeredSimMs = nowSimMs;
    this.lastTriggerSimMs.set(groupKey, nowSimMs);

    const minIntMs = Math.max(
      parseDurationMs(sound.limits?.minInterval, 0),
      parseDurationMs(sound.schedule?.minInterval, 0),
      parseDurationMs(sound.limits?.cooldown, 0)
    );
    if (minIntMs > 0) {
      this.cooldownUntilSimMs.set(`${groupKey}|${scopeId}`, nowSimMs + minIntMs);
    }
  }

  stepScheduledAndStochastic(params: {
    sounds: readonly SoundDefinition[];
    world: WorldContext;
    dtSimMs: number;
    dtRealMs: number;
    nowSimMs: number;
    nowRealMs: number;
    evaluator: ConditionEvaluator;
    disturbances: DisturbanceManager;
    mixer: AudioMixer;
    rng: SeededRng;
    onTrigger: (req: TriggerRequest) => void;
  }): RuleDiagnosticsRow[] {
    const { sounds, world, dtSimMs, dtRealMs, nowSimMs, nowRealMs, evaluator, disturbances, mixer, rng, onTrigger } = params;
    this.reconcileClockJump(nowSimMs, nowRealMs);

    const diagRows: RuleDiagnosticsRow[] = [];

    for (const sound of sounds) {
      if (sound.trigger.type !== 'scheduled' && sound.trigger.type !== 'stochastic' && sound.trigger.type !== 'repeating') {
        continue;
      }

      const eligibility = this.canTriggerSound({
        sound,
        world,
        evaluator,
        disturbances,
        mixer,
        rng,
        nowSimMs,
        nowRealMs,
      });

      const useSimClock = (sound.schedule?.clock ?? 'simulation') === 'simulation';
      const nowClockMs = useSimClock ? nowSimMs : nowRealMs;
      const dtClockMs = Math.max(0, useSimClock ? dtSimMs : dtRealMs);
      const dueMap = useSimClock ? this.nextAttemptSimMs : this.nextAttemptRealMs;
      let nextDue = dueMap.get(sound.id);

      const hasInterval = Boolean(sound.schedule?.interval);
      const minIntMs = parseDurationMs(sound.limits?.minInterval ?? sound.schedule?.minInterval, 0);

      if (sound.trigger.type === 'scheduled') {
        // Sample window target & compute spaced scheduled trigger times inside active window
        const remainingNeed =
          eligibility.sampledTarget !== null
            ? Math.max(0, eligibility.sampledTarget - eligibility.currentUsed)
            : 0;

        if (eligibility.eligible && remainingNeed > 0) {
          if (nextDue === undefined) {
            const delayBase = Math.max(minIntMs, 30_000);
            if (eligibility.currentUsed === 0) {
              const firstMin = Math.min(5000, delayBase * 0.1);
              const firstMax = Math.min(delayBase * 0.65, 2_400_000);
              nextDue = nowClockMs + rng.range(firstMin, Math.max(firstMin, firstMax));
            } else {
              nextDue = nowClockMs + rng.range(Math.min(5000, delayBase * 0.2), delayBase * 1.4);
            }
            dueMap.set(sound.id, nextDue);
          } else if (nowClockMs >= nextDue) {
            // Execute at most ONCE per tick (missed_occurrence: skip — no bursts on time acceleration!)
            const minNext = minIntMs + 5000;
            const spreadMs = Math.max(minNext + 60_000, minIntMs * 1.35, 90_000);
            dueMap.set(sound.id, nowClockMs + rng.range(minNext, spreadMs));
            onTrigger({ sound });
          }
        } else if (nextDue !== undefined && nowClockMs > nextDue && sound.schedule?.missedOccurrence !== 'play_latest') {
          // Clear expired schedule cleanly when conditions are lost or quota exhausted;
          // cooldowns remain enforced independently via cooldownUntilSimMs/lastTriggerSimMs.
          dueMap.delete(sound.id);
        }
      } else if (sound.trigger.type === 'stochastic' || sound.trigger.type === 'repeating') {
        if (sound.schedule?.ratePerMinute !== undefined) {
          if (eligibility.eligible && dtClockMs > 0) {
            // Frame-rate-independent Poisson process; clamp large dt jumps to prevent bursts after acceleration/pause
            const effectiveDtSec = Math.min(2.0, dtClockMs / 1000);
            const p = 1 - Math.exp(-(sound.schedule.ratePerMinute / 60) * effectiveDtSec);
            if (rng.next() < p) {
              onTrigger({ sound });
            }
          }
        } else if (hasInterval) {
          const [rawA, rawB] = sound.schedule!.interval!;
          const minMs = parseDurationMs(rawA, 5000);
          const maxMs = parseDurationMs(rawB, minMs);
          if (nextDue === undefined) {
            const initDelay = parseDurationMs(sound.schedule?.initialDelay, -1);
            nextDue = nowClockMs + (initDelay >= 0 ? initDelay : rng.range(minMs, maxMs));
            dueMap.set(sound.id, nextDue);
          } else if (nowClockMs >= nextDue) {
            // Never burst-play missed occurrences after time skip
            dueMap.set(sound.id, nowClockMs + rng.range(minMs, maxMs));
            if (eligibility.eligible) {
              const prob = sound.schedule?.probabilityPerAttempt ?? 1;
              if (rng.next() <= prob) {
                onTrigger({ sound });
              }
            }
          }
        }
      }

      const groupKey = sound.limits?.quotaGroup ?? sound.schedule?.quotaGroup ?? sound.id;
      const lastTrig = this.lastTriggerSimMs.get(groupKey);
      const cdRem =
        minIntMs > 0 && lastTrig !== undefined
          ? Math.max(0, (minIntMs - (nowSimMs - lastTrig)) / 1000)
          : 0;

      diagRows.push({
        soundId: sound.id,
        triggerType: sound.trigger.type,
        bus: sound.bus,
        eligible: eligibility.eligible,
        reasons: eligibility.reasons,
        quotaUsed: eligibility.currentUsed,
        quotaTarget: eligibility.sampledTarget,
        quotaMax: eligibility.maxAllowed,
        cooldownRemainingSimSec: Math.round(cdRem * 10) / 10,
        nextScheduledSimSec:
          useSimClock && nextDue !== undefined
            ? Math.max(0, Math.round(((nextDue - nowSimMs) / 1000) * 10) / 10)
            : null,
      });
    }

    return diagRows;
  }

  scheduleReactionsForEvent(params: {
    event: SimulationEvent;
    reactions: readonly EventReactionDefinition[];
    soundsMap: ReadonlyMap<string, SoundDefinition>;
    world: WorldContext;
    evaluator: ConditionEvaluator;
    disturbances: DisturbanceManager;
    mixer: AudioMixer;
    rng: SeededRng;
    nowSimMs: number;
    nowRealMs: number;
    maxChainDepth: number;
    maxEventsPerChain: number;
    maxPendingEvents: number;
    onExecuteReaction: (reaction: EventReactionDefinition, sourceEvent: SimulationEvent) => void;
  }): void {
    const {
      event,
      reactions,
      soundsMap,
      world,
      evaluator,
      disturbances,
      mixer,
      rng,
      nowSimMs,
      nowRealMs,
      maxChainDepth,
      maxEventsPerChain,
      maxPendingEvents,
      onExecuteReaction,
    } = params;

    if (event.chainDepth >= maxChainDepth) return;
    const corrId = event.correlationId ?? event.id;
    const chainCount = this.chainEventCounts.get(corrId) ?? 0;
    if (chainCount >= maxEventsPerChain) return;

    for (const rx of reactions) {
      if (rx.event !== event.type) continue;

      // Trigger distance constraint check
      if (rx.triggerDistanceMaxM !== undefined && event.position) {
        const maxD = parseDistanceM(rx.triggerDistanceMaxM, Infinity);
        const d = Math.hypot(
          event.position.x - world.listener.position.x,
          event.position.y - world.listener.position.y,
          event.position.z - world.listener.position.z
        );
        if (d > maxD) continue;
      }

      // Check reaction cooldown & quota
      const rxScope = this.buildScopeId(rx.scope ?? 'player', world, event);
      const rxPeriod = rx.quotaPeriod ?? 'all_time';
      const groupKey = rx.quotaGroup ?? rx.id;
      const quotaKey = this.getWindowKey(groupKey, rxPeriod, rxScope, nowSimMs, [], world.astronomy.isNight);
      const st = this.getOrCreateWindowState(quotaKey, undefined, rng);

      if (rx.maxOccurrences !== undefined && st.count + st.reserved >= rx.maxOccurrences) {
        continue;
      }

      if (rx.cooldownMs !== undefined) {
        const cdMs = parseDurationMs(rx.cooldownMs, 0);
        const last = this.lastTriggerSimMs.get(groupKey) ?? st.lastTriggeredSimMs;
        if (last !== null && nowSimMs - last < cdMs) continue;
      }

      // Check scheduleConditions
      const schedCond = evaluator.evaluate(
        rx.scheduleConditions,
        { world, event },
        `rx_sched:${rx.id}`,
        nowRealMs
      );
      if (!schedCond.passed) continue;

      // If playSound is configured, verify disturbance / target eligibility BEFORE consuming probability
      if (rx.playSound) {
        const targetSound = soundsMap.get(rx.playSound);
        if (targetSound) {
          const check = this.canTriggerSound({
            sound: targetSound,
            world,
            evaluator,
            disturbances,
            mixer,
            rng,
            nowSimMs,
            nowRealMs,
            event,
            exemptFromDisturbance: rx.exemptFromDisturbance,
          });
          if (!check.eligible) continue;
        }
      }

      const prob = rx.probability ?? 1;
      if (rng.next() > prob) continue;

      // Chain cap tracking
      const nextCount = (this.chainEventCounts.get(corrId) ?? 0) + 1;
      if (nextCount > maxEventsPerChain) break;
      this.chainEventCounts.set(corrId, nextCount);

      const delayMin = rx.delayMs ? parseDurationMs(rx.delayMs[0], 0) : 0;
      const delayMax = rx.delayMs ? parseDurationMs(rx.delayMs[1], delayMin) : delayMin;
      const chosenDelayMs = rng.range(delayMin, delayMax);

      // Reserve quota atomically when scheduling delayed reaction!
      if (chosenDelayMs <= 0) {
        const execCond = evaluator.evaluate(
          rx.executeConditions,
          { world, event },
          `rx_exec:${rx.id}`,
          nowRealMs
        );
        if (!execCond.passed) continue;
        st.count += 1;
        st.lastTriggeredSimMs = nowSimMs;
        this.lastTriggerSimMs.set(groupKey, nowSimMs);
        onExecuteReaction(rx, event);
      } else if (this.pendingReactions.length < maxPendingEvents) {
        st.reserved += 1;
        const useSimClock = (rx.clock ?? 'simulation') === 'simulation';
        this.pendingReactions.push({
          id: `pr_${this.reactionSeq++}`,
          reaction: rx,
          executeAtSimMs: nowSimMs + chosenDelayMs,
          executeAtRealMs: nowRealMs + chosenDelayMs,
          useSimClock,
          sourceEvent: event,
          reservedQuotaKey: quotaKey,
        });
      }
    }
  }

  stepPendingReactions(params: {
    world: WorldContext;
    evaluator: ConditionEvaluator;
    nowSimMs: number;
    nowRealMs: number;
    onExecuteReaction: (reaction: EventReactionDefinition, sourceEvent: SimulationEvent) => void;
  }): void {
    const { world, evaluator, nowSimMs, nowRealMs, onExecuteReaction } = params;
    const remaining: PendingReactionEntry[] = [];

    for (const pr of this.pendingReactions) {
      const due = pr.useSimClock ? nowSimMs >= pr.executeAtSimMs : nowRealMs >= pr.executeAtRealMs;
      if (!due) {
        remaining.push(pr);
        continue;
      }

      const st = pr.reservedQuotaKey ? this.windowStates.get(pr.reservedQuotaKey) : undefined;
      if (st && st.reserved > 0) {
        st.reserved -= 1;
      }

      const execCond = evaluator.evaluate(
        pr.reaction.executeConditions,
        { world, event: pr.sourceEvent },
        `rx_exec:${pr.reaction.id}`,
        nowRealMs
      );
      if (!execCond.passed) {
        // Released reservation without incrementing count!
        continue;
      }

      const groupKey = pr.reaction.quotaGroup ?? pr.reaction.id;
      if (st) {
        st.count += 1;
        st.lastTriggeredSimMs = nowSimMs;
      }
      this.lastTriggerSimMs.set(groupKey, nowSimMs);
      onExecuteReaction(pr.reaction, pr.sourceEvent);
    }

    this.pendingReactions = remaining;
  }

  exportState(): {
    windowStates: PersistedSoundscapeState['windowStates'];
    cooldowns: PersistedSoundscapeState['cooldowns'];
    pendingReactions: PersistedSoundscapeState['pendingReactions'];
  } {
    const windowStates: PersistedSoundscapeState['windowStates'] = [];
    for (const [key, st] of this.windowStates) {
      windowStates.push({
        key,
        sampledTarget: st.sampledTarget,
        count: st.count,
        lastTriggeredSimMs: st.lastTriggeredSimMs,
      });
    }
    const cooldowns: PersistedSoundscapeState['cooldowns'] = [];
    for (const [key, untilSimMs] of this.cooldownUntilSimMs) {
      cooldowns.push({ key, untilSimMs });
    }
    const pendingReactions: PersistedSoundscapeState['pendingReactions'] = this.pendingReactions.map(
      (pr) => ({
        id: pr.id,
        reactionId: pr.reaction.id,
        executeAtSimMs: pr.executeAtSimMs,
        sourceEvent: pr.sourceEvent,
        reservedQuotaKey: pr.reservedQuotaKey,
      })
    );
    return { windowStates, cooldowns, pendingReactions };
  }

  importState(
    saved: {
      windowStates: PersistedSoundscapeState['windowStates'];
      cooldowns: PersistedSoundscapeState['cooldowns'];
      pendingReactions: PersistedSoundscapeState['pendingReactions'];
    },
    reactions: readonly EventReactionDefinition[],
    nowSimMs: number,
    realClock: Clock
  ): void {
    this.windowStates.clear();
    for (const w of saved.windowStates) {
      this.windowStates.set(w.key, {
        sampledTarget: w.sampledTarget,
        count: w.count,
        reserved: 0,
        lastTriggeredSimMs: w.lastTriggeredSimMs,
      });
    }
    this.cooldownUntilSimMs.clear();
    for (const c of saved.cooldowns) {
      if (c.untilSimMs > nowSimMs) {
        this.cooldownUntilSimMs.set(c.key, c.untilSimMs);
      }
    }
    const rxById = new Map(reactions.map((r) => [r.id, r]));
    this.pendingReactions = [];
    const nowReal = realClock.nowMs();
    for (const pr of saved.pendingReactions) {
      const rx = rxById.get(pr.reactionId);
      if (!rx) continue;
      // Do not replay stale transient reactions that already expired before save/load
      if (pr.executeAtSimMs < nowSimMs - 2000) continue;
      const remMs = Math.max(0, pr.executeAtSimMs - nowSimMs);
      if (pr.reservedQuotaKey) {
        const st = this.windowStates.get(pr.reservedQuotaKey);
        if (st) st.reserved += 1;
      }
      this.pendingReactions.push({
        id: pr.id,
        reaction: rx,
        executeAtSimMs: pr.executeAtSimMs,
        executeAtRealMs: nowReal + remMs,
        useSimClock: (rx.clock ?? 'simulation') === 'simulation',
        sourceEvent: pr.sourceEvent,
        reservedQuotaKey: pr.reservedQuotaKey,
      });
    }
  }

  resetQuotasAndCooldowns(): void {
    this.windowStates.clear();
    this.cooldownUntilSimMs.clear();
    this.nextAttemptSimMs.clear();
    this.nextAttemptRealMs.clear();
    this.lastTriggerSimMs.clear();
    this.pendingReactions = [];
    this.chainEventCounts.clear();
  }
}

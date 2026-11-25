import type { EventOrigin, SimulationEvent, Vector3 } from './types';

export type SimulationEventHandler = (event: SimulationEvent) => void;

export interface EmitEventInput<T = Record<string, unknown>> {
  type: string;
  origin: EventOrigin;
  simulationTimestamp: number;
  position?: Vector3;
  sourceEntityId?: string;
  targetEntityId?: string;
  intensity?: number;
  correlationId?: string;
  causationId?: string;
  chainDepth?: number;
  dedupeKey?: string;
  dedupeWindowMs?: number;
  payload?: T;
}

export class SimulationEventBus {
  private seq = 1;
  private handlers = new Map<string, Set<SimulationEventHandler>>();
  private wildcardHandlers = new Set<SimulationEventHandler>();
  private recentDedupe = new Map<string, number>();
  private traceHistory: SimulationEvent[] = [];
  private readonly maxTraceSize: number;

  constructor(maxTraceSize = 80) {
    this.maxTraceSize = maxTraceSize;
  }

  on(eventType: string, handler: SimulationEventHandler): () => void {
    if (eventType === '*') {
      this.wildcardHandlers.add(handler);
      return () => this.wildcardHandlers.delete(handler);
    }
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<T = Record<string, unknown>>(input: EmitEventInput<T>): {
    accepted: boolean;
    event: SimulationEvent<T> | null;
    deduped: boolean;
  } {
    const nowSim = input.simulationTimestamp;

    if (input.dedupeKey) {
      const windowMs = input.dedupeWindowMs ?? 120;
      const last = this.recentDedupe.get(input.dedupeKey);
      if (last !== undefined && nowSim >= last && nowSim - last < windowMs) {
        return { accepted: false, event: null, deduped: true };
      }
      this.recentDedupe.set(input.dedupeKey, nowSim);
      // Prune stale dedupe keys opportunistically
      if (this.recentDedupe.size > 200) {
        for (const [k, ts] of this.recentDedupe) {
          if (nowSim - ts > 5000 || nowSim < ts) this.recentDedupe.delete(k);
        }
      }
    }

    const id = `evt_${this.seq++}`;
    const event: SimulationEvent<T> = {
      id,
      type: input.type,
      origin: input.origin,
      simulationTimestamp: nowSim,
      position: input.position ? { ...input.position } : undefined,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      intensity: input.intensity,
      correlationId: input.correlationId ?? id,
      causationId: input.causationId,
      chainDepth: input.chainDepth ?? 0,
      dedupeKey: input.dedupeKey,
      dedupeWindowMs: input.dedupeWindowMs,
      payload: (input.payload ?? {}) as T,
    };

    const untypedEvent = event as unknown as SimulationEvent;
    this.traceHistory.push(untypedEvent);
    if (this.traceHistory.length > this.maxTraceSize) {
      this.traceHistory.shift();
    }

    const specific = this.handlers.get(event.type);
    if (specific) {
      for (const h of specific) h(untypedEvent);
    }
    for (const h of this.wildcardHandlers) h(untypedEvent);

    return { accepted: true, event, deduped: false };
  }

  getTraceHistory(): readonly SimulationEvent[] {
    return this.traceHistory;
  }

  clearHistory(): void {
    this.traceHistory = [];
    this.recentDedupe.clear();
  }
}

import type { DistanceInput, DurationInput, TimeWindowDef } from './types';

export interface Clock {
  nowMs(): number;
}

export class SystemRealClock implements Clock {
  nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private currentMs: number;

  constructor(initialMs = 0) {
    this.currentMs = initialMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  setMs(ms: number): void {
    this.currentMs = ms;
  }

  advanceMs(deltaMs: number): void {
    this.currentMs += deltaMs;
  }
}

/**
 * Deterministic serializable Mulberry32 PRNG.
 */
export class SeededRng {
  private state: number;

  constructor(seed = 2026) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    if (max <= min) return min;
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxInclusive: number): number {
    if (maxInclusive <= minInclusive) return minInclusive;
    return Math.floor(this.range(minInclusive, maxInclusive + 0.999999));
  }

  pickWeighted<T extends { weight?: number }>(items: readonly T[]): T | null {
    if (items.length === 0) return null;
    let total = 0;
    for (const item of items) {
      total += Math.max(0, item.weight ?? 1);
    }
    if (total <= 0) return items[0];
    let cursor = this.next() * total;
    for (const item of items) {
      cursor -= Math.max(0, item.weight ?? 1);
      if (cursor <= 0) return item;
    }
    return items[items.length - 1];
  }

  exportState(): number {
    return this.state >>> 0;
  }

  importState(state: number): void {
    this.state = state >>> 0 || 1;
  }
}

const DURATION_RE = /^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i;
const DISTANCE_RE = /^(-?\d+(?:\.\d+)?)\s*(m|km)?$/i;

export function parseDurationMs(input: DurationInput | undefined, fallback = 0): number {
  if (input === undefined) return fallback;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : NaN;
  }
  const m = DURATION_RE.exec(input.trim());
  if (!m) return NaN;
  const val = parseFloat(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  switch (unit) {
    case 'ms':
      return val;
    case 's':
      return val * 1000;
    case 'm':
      return val * 60_000;
    case 'h':
      return val * 3_600_000;
    default:
      return NaN;
  }
}

export function parseDistanceM(input: DistanceInput | undefined, fallback = 0): number {
  if (input === undefined) return fallback;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : NaN;
  }
  const m = DISTANCE_RE.exec(input.trim());
  if (!m) return NaN;
  const val = parseFloat(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  if (unit === 'km') return val * 1000;
  return val;
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function parseTimeToMinutes(hhmm: string): number {
  const m = TIME_RE.exec(hhmm.trim());
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return NaN;
  }
  return hh * 60 + mm;
}

export function isMinutesInWindow(minuteOfDay: number, win: TimeWindowDef): boolean {
  const fromMin = parseTimeToMinutes(win.from);
  const toMin = parseTimeToMinutes(win.to);
  if (!Number.isFinite(fromMin) || !Number.isFinite(toMin)) return false;
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  if (fromMin === toMin) return true;
  if (fromMin < toMin) {
    return m >= fromMin && m < toMin;
  }
  // Crosses midnight, e.g. 23:00 -> 04:00
  return m >= fromMin || m < toMin;
}

/**
 * Returns a stable window instance identifier for midnight-crossing or daytime windows.
 * Example: for window 23:00-04:00 on day 3 at 23:30 OR day 4 at 01:15, both belong to "day3:w0".
 * Separate windows in the same day (e.g. 05:00-08:00 vs 16:00-19:00) return distinct keys.
 */
export function resolveActiveWindowInstance(
  simTimeMs: number,
  windows: readonly TimeWindowDef[]
): { windowIndex: number; key: string; startSimMs: number; endSimMs: number } | null {
  const DAY_MS = 86_400_000;
  const simDay = Math.floor(simTimeMs / DAY_MS);
  const msInDay = ((simTimeMs % DAY_MS) + DAY_MS) % DAY_MS;
  const minuteOfDay = msInDay / 60_000;

  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    if (!isMinutesInWindow(minuteOfDay, win)) continue;
    const fromMin = parseTimeToMinutes(win.from);
    const toMin = parseTimeToMinutes(win.to);
    const crossesMidnight = fromMin > toMin;
    const anchorDay = crossesMidnight && minuteOfDay < toMin ? simDay - 1 : simDay;
    const startSimMs = anchorDay * DAY_MS + fromMin * 60_000;
    const endSimMs = (crossesMidnight ? anchorDay + 1 : anchorDay) * DAY_MS + toMin * 60_000;
    return {
      windowIndex: i,
      key: `d${anchorDay}:w${i}`,
      startSimMs,
      endSimMs,
    };
  }
  return null;
}

export function resolvePeriodKey(
  simTimeMs: number,
  period: 'day' | 'night' | 'window' | 'rolling' | 'all_time',
  windows?: readonly TimeWindowDef[],
  isNightNow?: boolean
): string {
  const DAY_MS = 86_400_000;
  const simDay = Math.floor(simTimeMs / DAY_MS);
  const msInDay = ((simTimeMs % DAY_MS) + DAY_MS) % DAY_MS;
  const hour = msInDay / 3_600_000;

  if (period === 'window' && windows && windows.length > 0) {
    const active = resolveActiveWindowInstance(simTimeMs, windows);
    if (active) return active.key;
  }
  if (period === 'night') {
    // Anchor overnight period from 18:00..06:00 onto the evening start day so 23:30 & 01:00 share one night quota
    const anchorDay = hour < 12 ? simDay - 1 : simDay;
    if (isNightNow === false) return `daylight:${simDay}`;
    return `night:${anchorDay}`;
  }
  if (period === 'day') {
    return `day:${simDay}`;
  }
  if (period === 'rolling') {
    return 'rolling';
  }
  return 'all_time';
}

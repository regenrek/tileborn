export type DeterministicClockMode = "virtual" | "system";

export interface DeterministicClockOptions {
  readonly mode?: DeterministicClockMode;
  readonly startMs?: number;
  readonly seed?: number;
  readonly now?: () => number;
}

const DEFAULT_SEED = 0x9e3779b9;

const normalizeSeed = (seed: number): number => seed >>> 0;

/** Controllable performance.now-like clock for replay and tests. */
export class DeterministicClock {
  readonly mode: DeterministicClockMode;
  private readonly systemNow: () => number;
  private readonly startMs: number;
  private readonly seed: number;
  private currentMs: number;
  private rngState: number;
  private lastObservedMs: number;

  constructor(options: DeterministicClockOptions = {}) {
    this.mode = options.mode ?? "virtual";
    this.systemNow = options.now ?? (() => performance.now());
    this.startMs = options.startMs ?? 0;
    this.currentMs = this.startMs;
    this.lastObservedMs = this.startMs;
    this.seed = normalizeSeed(options.seed ?? DEFAULT_SEED);
    this.rngState = this.seed;
  }

  now(): number {
    const next = this.mode === "system" ? Math.max(this.lastObservedMs, this.systemNow()) : this.currentMs;
    this.lastObservedMs = next;
    return next;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError("clock advance must be a finite non-negative number");
    }
    this.currentMs += ms;
    this.lastObservedMs = Math.max(this.lastObservedMs, this.currentMs);
    return this.currentMs;
  }

  reset(startMs = this.startMs): void {
    this.currentMs = startMs;
    this.lastObservedMs = startMs;
    this.rngState = this.seed;
  }

  random(): number {
    this.rngState = (1664525 * this.rngState + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }
}

import { DeterministicClock } from '../clock/deterministic-clock.js';

const ACCUMULATOR_EPSILON_MS = 1e-9;

export interface GameLoopOptions {
  readonly tickRate?: number;
  readonly maxCatchupTicks?: number;
  readonly clock?: DeterministicClock;
  readonly update: (dt: number, tick: number) => void;
  readonly render?: (alpha: number) => void;
}

export interface GameLoopRunResult {
  readonly updates: number;
  readonly alpha: number;
  readonly tick: number;
}

export class GameLoop {
  readonly tickRate: number;
  readonly stepMs: number;
  readonly maxCatchupTicks: number;
  private readonly clock: DeterministicClock;
  private readonly update: (dt: number, tick: number) => void;
  private readonly render: ((alpha: number) => void) | undefined;
  private accumulatorMs = 0;
  private lastTimeMs = 0;
  private running = false;
  private currentTick = 0;

  constructor(options: GameLoopOptions) {
    this.tickRate = options.tickRate ?? 60;
    if (!Number.isFinite(this.tickRate) || this.tickRate <= 0) {
      throw new RangeError('tickRate must be a positive finite number');
    }
    this.stepMs = 1000 / this.tickRate;
    this.maxCatchupTicks = options.maxCatchupTicks ?? 5;
    this.clock = options.clock ?? new DeterministicClock();
    this.update = options.update;
    this.render = options.render;
    this.lastTimeMs = this.clock.now();
  }

  start(): void {
    this.running = true;
    this.lastTimeMs = this.clock.now();
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.start();
  }

  stop(): void {
    this.running = false;
    this.accumulatorMs = 0;
    this.currentTick = 0;
    this.lastTimeMs = this.clock.now();
  }

  step(ticks = 1): number {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new RangeError('step ticks must be a non-negative integer');
    }
    for (let index = 0; index < ticks; index += 1) {
      this.currentTick += 1;
      this.update(this.stepMs / 1000, this.currentTick);
    }
    this.render?.(0);
    return this.currentTick;
  }

  runFrame(nowMs = this.clock.now()): GameLoopRunResult {
    if (!this.running) {
      return { updates: 0, alpha: this.alpha(), tick: this.currentTick };
    }
    const deltaMs = Math.max(0, nowMs - this.lastTimeMs);
    this.lastTimeMs = nowMs;
    this.accumulatorMs += deltaMs;
    let updates = 0;
    while (
      this.accumulatorMs + ACCUMULATOR_EPSILON_MS >= this.stepMs &&
      updates < this.maxCatchupTicks
    ) {
      this.accumulatorMs -= this.stepMs;
      if (Math.abs(this.accumulatorMs) <= ACCUMULATOR_EPSILON_MS) {
        this.accumulatorMs = 0;
      }
      this.currentTick += 1;
      updates += 1;
      this.update(this.stepMs / 1000, this.currentTick);
    }
    if (updates === this.maxCatchupTicks && this.accumulatorMs >= this.stepMs) {
      this.accumulatorMs = 0;
    }
    const alpha = this.alpha();
    this.render?.(alpha);
    return { updates, alpha, tick: this.currentTick };
  }

  get tick(): number {
    return this.currentTick;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }
}

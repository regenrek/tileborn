export interface InterpolatedFullState {
  readonly previous: unknown;
  readonly current: unknown;
  readonly alpha: number;
}

interface SnapshotEntry {
  readonly serverTickMs: number;
  readonly fullState: unknown;
}

const DEFAULT_INTERPOLATION_DELAY_MS = 100;
const MAX_SNAPSHOT_ENTRIES = 30;

const clampAlpha = (value: number): number => Math.min(1, Math.max(0, value));

export class SnapshotInterpolator {
  private entries: SnapshotEntry[] = [];
  private interpolationDelayMs = DEFAULT_INTERPOLATION_DELAY_MS;

  push(serverTickMs: number, fullState: unknown): void {
    if (!Number.isFinite(serverTickMs)) {
      return;
    }

    const entry = { serverTickMs, fullState };
    const insertAt = this.entries.findIndex((candidate) => candidate.serverTickMs > serverTickMs);
    if (insertAt === -1) {
      this.entries.push(entry);
    } else {
      this.entries.splice(insertAt, 0, entry);
    }

    if (this.entries.length > MAX_SNAPSHOT_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_SNAPSHOT_ENTRIES);
    }
  }

  sample(nowMs: number): InterpolatedFullState | undefined {
    if (this.entries.length < 2 || !Number.isFinite(nowMs)) {
      return undefined;
    }

    const targetTickMs = nowMs - this.interpolationDelayMs;
    const [first, second] = this.entries;
    if (targetTickMs <= first!.serverTickMs) {
      return this.interpolate(first!, second!, targetTickMs);
    }

    for (let index = 1; index < this.entries.length; index += 1) {
      const previous = this.entries[index - 1]!;
      const current = this.entries[index]!;
      if (targetTickMs <= current.serverTickMs) {
        return this.interpolate(previous, current, targetTickMs);
      }
    }

    const previous = this.entries[this.entries.length - 2]!;
    const current = this.entries[this.entries.length - 1]!;
    return this.interpolate(previous, current, targetTickMs);
  }

  setInterpolationDelayMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError("Interpolation delay must be a non-negative finite number");
    }
    this.interpolationDelayMs = ms;
  }

  clear(): void {
    this.entries = [];
  }

  private interpolate(previous: SnapshotEntry, current: SnapshotEntry, targetTickMs: number): InterpolatedFullState {
    const durationMs = current.serverTickMs - previous.serverTickMs;
    const alpha = durationMs <= 0 ? 1 : clampAlpha((targetTickMs - previous.serverTickMs) / durationMs);
    return {
      previous: previous.fullState,
      current: current.fullState,
      alpha,
    };
  }
}

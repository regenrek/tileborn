import { type InterpolatedFullState, SnapshotInterpolator } from "./snapshot-interpolator.js";

export interface SnapshotEntityWithId {
  readonly id: string;
}

export type SnapshotFrameMerger = (previousFullState: unknown | undefined, frame: unknown) => unknown;
export type SnapshotFrameTimestampExtractor = (frame: unknown) => number | undefined;

export interface SnapshotEntityStoreOptions {
  readonly enableInterpolation?: boolean;
  readonly interpolationDelayMs?: number;
  readonly getFrameTimestamp?: SnapshotFrameTimestampExtractor;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSnapshotEntityWithId = (value: unknown): value is SnapshotEntityWithId =>
  isRecord(value) && typeof value.id === "string";

const numericProperty = (value: unknown, keys: readonly string[]): number | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const extractServerTimestamp = (frame: unknown): number | undefined =>
  numericProperty(frame, ["serverTimestampMs"]);

const currentClientTimestampMs = (): number => globalThis.performance?.now() ?? Date.now();

const defaultEntitiesFromSnapshot = (snapshot: unknown): readonly SnapshotEntityWithId[] => {
  if (Array.isArray(snapshot)) {
    return snapshot.filter(isSnapshotEntityWithId);
  }
  if (!isRecord(snapshot)) {
    return [];
  }

  return Object.values(snapshot).flatMap((value) =>
    Array.isArray(value) ? value.filter(isSnapshotEntityWithId) : [],
  );
};

const byId = <Entity extends SnapshotEntityWithId>(
  entities: readonly Entity[],
): ReadonlyMap<string, Entity> => {
  const result = new Map<string, Entity>();
  for (const entity of entities) {
    result.set(entity.id, entity);
  }
  return result;
};

export class SnapshotEntityStore {
  private previous: unknown;
  private current: unknown;
  private previousServerTimestamp: number | undefined;
  private currentServerTimestamp: number | undefined;
  private serverTimeOffsetMs: number | undefined;
  private readonly interpolator: SnapshotInterpolator | undefined;
  private readonly getFrameTimestamp: SnapshotFrameTimestampExtractor;

  constructor(
    private readonly mergeFrame: SnapshotFrameMerger = (_previous, frame) => frame,
    options: SnapshotEntityStoreOptions = {},
  ) {
    this.getFrameTimestamp = options.getFrameTimestamp ?? extractServerTimestamp;
    if (options.enableInterpolation === true) {
      this.interpolator = new SnapshotInterpolator();
      if (options.interpolationDelayMs !== undefined) {
        this.interpolator.setInterpolationDelayMs(options.interpolationDelayMs);
      }
    }
  }

  apply(frame: unknown, clientNowMs: number = currentClientTimestampMs()): void {
    this.previous = this.current;
    this.previousServerTimestamp = this.currentServerTimestamp;
    this.current = this.mergeFrame(this.current, frame);
    this.currentServerTimestamp = this.getFrameTimestamp(frame);
    if (this.currentServerTimestamp !== undefined) {
      this.serverTimeOffsetMs = this.currentServerTimestamp - clientNowMs;
      this.interpolator?.push(this.currentServerTimestamp, this.current);
    }
  }

  getCurrentFullState(): unknown {
    return this.current;
  }

  getPreviousFullState(): unknown {
    return this.previous;
  }

  getCurrentSnapshot(): unknown {
    return this.getCurrentFullState();
  }

  getPreviousSnapshot(): unknown {
    return this.getPreviousFullState();
  }

  getCurrentServerTimestamp(): number | undefined {
    return this.currentServerTimestamp;
  }

  getPreviousServerTimestamp(): number | undefined {
    return this.previousServerTimestamp;
  }

  sampleInterpolatedFullState(nowMs: number): InterpolatedFullState | undefined {
    const serverNowMs =
      this.serverTimeOffsetMs === undefined ? nowMs : nowMs + this.serverTimeOffsetMs;
    return this.interpolator?.sample(serverNowMs);
  }

  setInterpolationDelayMs(ms: number): void {
    this.interpolator?.setInterpolationDelayMs(ms);
  }

  previousById(): ReadonlyMap<string, SnapshotEntityWithId> {
    if (this.previous === undefined) {
      return new Map();
    }
    return byId(defaultEntitiesFromSnapshot(this.previous));
  }
}

export const createSnapshotEntityStore = (
  mergeFrame?: SnapshotFrameMerger,
  options?: SnapshotEntityStoreOptions,
): SnapshotEntityStore => new SnapshotEntityStore(mergeFrame, options);

import type { AnimationId, TileId } from "../schemas/ids.js";

/** Precomputed animation frame with cumulative timing within one loop cycle. */
export type CompiledAnimationFrame = {
  readonly tileId: TileId;
  readonly durationMs: number;
  /** Exclusive cumulative end time for this frame within one loop cycle. */
  readonly endTimeMs: number;
};

/** Animation metadata prepared for fast frame lookup at runtime. */
export type CompiledAnimation = {
  readonly id: AnimationId;
  readonly loop: boolean;
  readonly frames: ReadonlyArray<CompiledAnimationFrame>;
  readonly totalDurationMs: number;
};

export type AnimationCompileDiagnostic = {
  readonly _tag: "EmptyAnimationFrames";
  readonly animationId: string;
  readonly path: string;
  readonly message: string;
  readonly severity: "error";
};

export type CompileAnimationResult = {
  readonly value?: CompiledAnimation;
  readonly diagnostics: ReadonlyArray<AnimationCompileDiagnostic>;
};

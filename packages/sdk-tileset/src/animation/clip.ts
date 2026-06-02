/**
 * Shared, pure clip-timeline math for multi-frame sprite clips. Both the editor
 * viewport and the runtime renderer advance a single shared animation clock and
 * compute the active frame via `(clock * speed + offset) % duration` — there are
 * no per-sprite tickers. Keeping the math here guarantees the editor preview and
 * runtime playback stay frame-identical.
 */

const DEFAULT_FRAME_DURATION_MS = 100;

export interface ClipFrameTiming {
  readonly durationMs: number;
  /** Exclusive cumulative end time of this frame within one loop cycle. */
  readonly endTimeMs: number;
}

export interface CompiledClip {
  readonly loop: boolean;
  readonly frameCount: number;
  readonly totalDurationMs: number;
  readonly frames: readonly ClipFrameTiming[];
}

/**
 * Compile a list of per-frame durations into a cumulative timeline. Frame
 * durations that are missing or non-positive fall back to `defaultDurationMs`
 * (then to {@link DEFAULT_FRAME_DURATION_MS}).
 */
export const compileClipTimeline = (
  frameDurationsMs: readonly (number | undefined)[],
  options: { readonly loop: boolean; readonly defaultDurationMs?: number },
): CompiledClip => {
  const fallback =
    options.defaultDurationMs !== undefined && options.defaultDurationMs > 0
      ? options.defaultDurationMs
      : DEFAULT_FRAME_DURATION_MS;
  const frames: ClipFrameTiming[] = [];
  let cumulative = 0;
  for (const raw of frameDurationsMs) {
    const durationMs = raw !== undefined && raw > 0 ? raw : fallback;
    cumulative += durationMs;
    frames.push({ durationMs, endTimeMs: cumulative });
  }
  return {
    loop: options.loop,
    frameCount: frames.length,
    totalDurationMs: cumulative,
    frames,
  };
};

/**
 * Resolve the 0-based frame index active at `clockMs` for a compiled clip.
 *
 * - Empty clips resolve to `0`.
 * - `speed` scales the clock (1 = authored speed); non-positive speed freezes on
 *   frame 0.
 * - `offsetMs` desynchronizes instances sharing the global clock.
 * - Looping clips wrap with modulo; non-looping clips clamp on the final frame.
 */
export const resolveClipFrameIndex = (
  clip: CompiledClip,
  clockMs: number,
  options: { readonly speed?: number; readonly offsetMs?: number } = {},
): number => {
  if (clip.frameCount === 0) {
    return 0;
  }
  if (clip.frameCount === 1 || clip.totalDurationMs <= 0) {
    return 0;
  }
  const speed = options.speed ?? 1;
  if (speed <= 0) {
    return 0;
  }
  const elapsed = (clockMs + (options.offsetMs ?? 0)) * speed;
  if (elapsed <= 0) {
    return 0;
  }
  const resolvedTimeMs = clip.loop
    ? elapsed % clip.totalDurationMs
    : elapsed >= clip.totalDurationMs
      ? clip.totalDurationMs
      : elapsed;
  for (let index = 0; index < clip.frames.length; index += 1) {
    if (resolvedTimeMs < clip.frames[index]!.endTimeMs) {
      return index;
    }
  }
  return clip.frameCount - 1;
};

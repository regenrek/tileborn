/**
 * Minimal clip-timeline math for runtime sprite animation. This mirrors
 * `@tileborne/sdk-tileset`'s `compileClipTimeline`/`resolveClipFrameIndex` so
 * playtest playback stays frame-identical to the editor preview. It is inlined
 * (rather than importing the sdk) to keep the runtime's tsc project-reference
 * graph free of the tsup-built sdk-tileset package. Keep the two in sync.
 */

const DEFAULT_FRAME_DURATION_MS = 100;

export interface CompiledClipFrame {
  readonly durationMs: number;
  readonly endTimeMs: number;
}

export interface CompiledClip {
  readonly loop: boolean;
  readonly frameCount: number;
  readonly totalDurationMs: number;
  readonly frames: readonly CompiledClipFrame[];
}

export const compileClipTimeline = (
  frameDurationsMs: readonly (number | undefined)[],
  options: { readonly loop: boolean; readonly defaultDurationMs?: number },
): CompiledClip => {
  const fallback =
    options.defaultDurationMs !== undefined && options.defaultDurationMs > 0
      ? options.defaultDurationMs
      : DEFAULT_FRAME_DURATION_MS;
  const frames: CompiledClipFrame[] = [];
  let cumulative = 0;
  for (const raw of frameDurationsMs) {
    const durationMs = raw !== undefined && raw > 0 ? raw : fallback;
    cumulative += durationMs;
    frames.push({ durationMs, endTimeMs: cumulative });
  }
  return { loop: options.loop, frameCount: frames.length, totalDurationMs: cumulative, frames };
};

export const resolveClipFrameIndex = (
  clip: CompiledClip,
  clockMs: number,
  options: { readonly speed?: number; readonly offsetMs?: number } = {},
): number => {
  if (clip.frameCount <= 1 || clip.totalDurationMs <= 0) {
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

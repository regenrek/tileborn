import type { TileId } from '../schemas/ids.js';

import type { CompiledAnimation } from './types.js';

/**
 * Returns the tile id for the animation frame active at `timeMs`.
 *
 * Negative `timeMs` resolves to frame 0. Looping animations wrap time with modulo
 * over `totalDurationMs`. Non-looping animations clamp to the final frame once
 * time reaches or exceeds the total duration.
 */
export const resolveAnimatedTile = (compiled: CompiledAnimation, timeMs: number): TileId => {
  const { frames, totalDurationMs, loop } = compiled;

  if (frames.length === 0) {
    throw new Error('Cannot resolve empty compiled animation');
  }

  if (timeMs < 0) {
    return frames[0]!.tileId;
  }

  if (totalDurationMs <= 0) {
    return frames[0]!.tileId;
  }

  const resolvedTimeMs =
    loop && totalDurationMs > 0
      ? timeMs % totalDurationMs
      : timeMs >= totalDurationMs
        ? totalDurationMs
        : timeMs;

  for (const frame of frames) {
    if (resolvedTimeMs < frame.endTimeMs) {
      return frame.tileId;
    }
  }

  return frames[frames.length - 1]!.tileId;
};

import type { Animation } from "../schemas/animation.js";

import type { CompileAnimationResult, CompiledAnimation, CompiledAnimationFrame } from "./types.js";

export const compileAnimation = (animation: Animation): CompileAnimationResult => {
  if (animation.frames.length === 0) {
    return {
      diagnostics: [
        {
          _tag: "EmptyAnimationFrames",
          animationId: animation.id,
          path: `/animations/${animation.id}/frames`,
          message: "Animation must contain at least one frame",
          severity: "error",
        },
      ],
    };
  }

  let endTimeMs = 0;
  const frames: CompiledAnimationFrame[] = animation.frames.map((frame) => {
    endTimeMs += frame.durationMs;
    return {
      tileId: frame.tileId,
      durationMs: frame.durationMs,
      endTimeMs,
    };
  });

  const compiled: CompiledAnimation = {
    id: animation.id,
    loop: animation.loop,
    frames,
    totalDurationMs: endTimeMs,
  };

  return {
    value: compiled,
    diagnostics: [],
  };
};

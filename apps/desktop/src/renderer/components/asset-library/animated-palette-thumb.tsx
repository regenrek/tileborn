import { compileClipTimeline, resolveClipFrameIndex } from '@tileborne/sdk-tileset/animation';
import { useMemo } from 'react';

import { LibraryPreviewThumb } from '@/components/asset-library/library-preview-thumb';
import { useAnimationClock } from '@/hooks/use-animation-clock';
import type { SpriteThumbnailFrames } from '@/lib/sprite-thumbnail-frames';

interface AnimatedPaletteThumbProps {
  readonly packId: string;
  readonly frames: SpriteThumbnailFrames;
  readonly sizePx?: number | undefined;
  readonly testId?: string | undefined;
  readonly integrityHash?: string | undefined;
}

/**
 * Animated sprite palette thumbnail. Cycles the clip's frame crops using the
 * shared clip-timeline math (`compileClipTimeline`/`resolveClipFrameIndex`) and
 * the single shared animation clock, so the palette thumbnail animates
 * frame-identically to the Studio preview and the placed object. Falls back to
 * a static thumbnail when the clip has a single frame.
 */
export function AnimatedPaletteThumb({
  packId,
  frames,
  sizePx,
  testId,
  integrityHash,
}: AnimatedPaletteThumbProps) {
  const multiFrame = frames.frames.length > 1;
  const clockMs = useAnimationClock(multiFrame);
  const compiled = useMemo(
    () =>
      compileClipTimeline(frames.durationsMs, {
        loop: frames.loop,
        ...(frames.defaultDurationMs === undefined
          ? {}
          : { defaultDurationMs: frames.defaultDurationMs }),
      }),
    [frames],
  );

  const frameIndex = multiFrame ? resolveClipFrameIndex(compiled, clockMs) : 0;
  const preview = frames.frames[frameIndex] ?? frames.frames[0]!;

  return (
    <LibraryPreviewThumb
      packId={packId}
      preview={preview}
      sizePx={sizePx}
      testId={testId}
      integrityHash={integrityHash}
      eager
    />
  );
}

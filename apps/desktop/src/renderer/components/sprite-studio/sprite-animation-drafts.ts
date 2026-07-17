export interface ClipDraft {
  readonly id: string;
  readonly name: string;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly fps: number;
  readonly loop: boolean;
}

export const reorderClipDrafts = (
  clips: readonly ClipDraft[],
  clipId: string,
  direction: -1 | 1,
): readonly ClipDraft[] => {
  const from = clips.findIndex((clip) => clip.id === clipId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= clips.length) {
    return clips;
  }
  const next = [...clips];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return clips;
  }
  next.splice(to, 0, moved);
  return next;
};

export const clampClipDraftsToFrameCount = (
  clips: readonly ClipDraft[],
  frameCount: number,
): readonly ClipDraft[] => {
  if (frameCount <= 0) {
    return clips;
  }
  const lastFrame = frameCount - 1;
  return clips.map((clip) => {
    const fromFrame = Math.min(lastFrame, Math.max(0, clip.fromFrame));
    const toFrame = Math.min(lastFrame, Math.max(fromFrame, clip.toFrame));
    return fromFrame === clip.fromFrame && toFrame === clip.toFrame
      ? clip
      : { ...clip, fromFrame, toFrame };
  });
};

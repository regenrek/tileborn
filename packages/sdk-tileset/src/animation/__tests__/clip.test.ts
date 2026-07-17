import { describe, expect, it } from 'vitest';

import { compileClipTimeline, resolveClipFrameIndex } from '../clip.js';

describe('compileClipTimeline', () => {
  it('accumulates per-frame durations', () => {
    const clip = compileClipTimeline([100, 200, 100], { loop: true });
    expect(clip.totalDurationMs).toBe(400);
    expect(clip.frames.map((frame) => frame.endTimeMs)).toEqual([100, 300, 400]);
  });

  it('falls back to defaultDurationMs then 100ms', () => {
    const clip = compileClipTimeline([undefined, 0], { loop: false, defaultDurationMs: 50 });
    expect(clip.frames.map((frame) => frame.durationMs)).toEqual([50, 50]);
    const noDefault = compileClipTimeline([undefined], { loop: false });
    expect(noDefault.frames[0]!.durationMs).toBe(100);
  });
});

describe('resolveClipFrameIndex', () => {
  const clip = compileClipTimeline([100, 100, 100], { loop: true });

  it('returns frame 0 at time 0 and negative time', () => {
    expect(resolveClipFrameIndex(clip, 0)).toBe(0);
    expect(resolveClipFrameIndex(clip, -50)).toBe(0);
  });

  it('advances through frames over time', () => {
    expect(resolveClipFrameIndex(clip, 50)).toBe(0);
    expect(resolveClipFrameIndex(clip, 150)).toBe(1);
    expect(resolveClipFrameIndex(clip, 250)).toBe(2);
  });

  it('loops with modulo', () => {
    expect(resolveClipFrameIndex(clip, 350)).toBe(0);
    expect(resolveClipFrameIndex(clip, 450)).toBe(1);
  });

  it('clamps non-looping clips on the final frame', () => {
    const once = compileClipTimeline([100, 100], { loop: false });
    expect(resolveClipFrameIndex(once, 50)).toBe(0);
    expect(resolveClipFrameIndex(once, 1000)).toBe(1);
  });

  it('scales by speed and offset', () => {
    expect(resolveClipFrameIndex(clip, 50, { speed: 2 })).toBe(1);
    expect(resolveClipFrameIndex(clip, 0, { offsetMs: 150 })).toBe(1);
    expect(resolveClipFrameIndex(clip, 100, { speed: 0 })).toBe(0);
  });

  it('returns 0 for single-frame or empty clips', () => {
    expect(resolveClipFrameIndex(compileClipTimeline([100], { loop: true }), 500)).toBe(0);
    expect(resolveClipFrameIndex(compileClipTimeline([], { loop: true }), 500)).toBe(0);
  });
});

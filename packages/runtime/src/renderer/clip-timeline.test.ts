import { describe, expect, it } from "vitest";

import { compileClipTimeline, resolveClipFrameIndex } from "./clip-timeline.js";

describe("runtime clip timeline (editor parity)", () => {
  const clip = compileClipTimeline([100, 100, 100], { loop: true });

  it("advances and loops by the shared clock", () => {
    expect(resolveClipFrameIndex(clip, 0)).toBe(0);
    expect(resolveClipFrameIndex(clip, 150)).toBe(1);
    expect(resolveClipFrameIndex(clip, 250)).toBe(2);
    expect(resolveClipFrameIndex(clip, 350)).toBe(0);
  });

  it("clamps non-looping clips and honors speed/offset", () => {
    const once = compileClipTimeline([100, 100], { loop: false });
    expect(resolveClipFrameIndex(once, 1000)).toBe(1);
    expect(resolveClipFrameIndex(clip, 50, { speed: 2 })).toBe(1);
    expect(resolveClipFrameIndex(clip, 0, { offsetMs: 150 })).toBe(1);
  });

  it("freezes single-frame clips", () => {
    expect(resolveClipFrameIndex(compileClipTimeline([100], { loop: true }), 500)).toBe(0);
  });
});

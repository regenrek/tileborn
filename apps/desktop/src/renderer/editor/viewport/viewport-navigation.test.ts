import { describe, expect, it } from 'vitest';

import {
  wheelDeltaPixels,
  zoomCameraAtClientPoint,
  zoomCameraByWheel,
} from './viewport-navigation';

describe('viewport navigation camera helpers', () => {
  it('zooms around the world point under the cursor', () => {
    const camera = { zoom: 1, panX: 20, panY: 10 };
    const next = zoomCameraAtClientPoint(camera, { left: 100, top: 50 }, 220, 160, 2);

    expect(next.zoom).toBe(2);
    expect(next.panX).toBe(-80);
    expect(next.panY).toBe(-90);
  });

  it('converts wheel delta modes before zooming', () => {
    expect(wheelDeltaPixels(2, 1)).toBe(32);
    expect(wheelDeltaPixels(1, 2)).toBe(800);
    expect(wheelDeltaPixels(12, 0)).toBe(12);
  });

  it('zooms in for negative pinch deltas', () => {
    const next = zoomCameraByWheel(
      { zoom: 1, panX: 0, panY: 0 },
      { left: 0, top: 0 },
      100,
      100,
      -100,
    );

    expect(next.zoom).toBeGreaterThan(1);
    expect(next.panX).toBeLessThan(0);
    expect(next.panY).toBeLessThan(0);
  });
});

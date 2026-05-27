import { describe, expect, it } from 'vitest';

import {
  mapPointFromMinimapPosition,
  minimapPanForMapPoint,
  minimapViewportRect,
} from './editor-minimap';

describe('editor minimap geometry', () => {
  it('projects the visible camera region into minimap coordinates', () => {
    const rect = minimapViewportRect(
      200,
      100,
      400,
      200,
      { zoom: 1, panX: -100, panY: -50 },
      160,
      80,
    );

    expect(rect).toEqual({ x: 40, y: 20, width: 80, height: 40 });
  });

  it('centers the viewport on a minimap target point', () => {
    expect(minimapPanForMapPoint(300, 120, 800, 600, 2)).toEqual({
      panX: -200,
      panY: 60,
    });
  });

  it('converts minimap positions to clamped map points', () => {
    expect(mapPointFromMinimapPosition(80, 40, 160, 80, 400, 200)).toEqual({
      x: 200,
      y: 100,
    });
    expect(mapPointFromMinimapPosition(999, -10, 160, 80, 400, 200)).toEqual({
      x: 400,
      y: 0,
    });
  });
});

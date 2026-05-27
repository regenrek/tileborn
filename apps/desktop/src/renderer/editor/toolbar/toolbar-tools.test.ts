import { describe, expect, it } from 'vitest';

import { MAP_EDITOR_TOOLBAR_TOOLS } from './toolbar-tools.js';
import { clampZoom, zoomInFrom, zoomOutFrom } from './zoom.js';

describe('map editor toolbar tools', () => {
  it('lists the primary editor tools in palette order', () => {
    expect(MAP_EDITOR_TOOLBAR_TOOLS.map((tool) => tool.id)).toEqual([
      'select',
      'tileBrush',
      'rectangleFill',
      'eraser',
      'objectPlace',
      'collisionPaint',
      'regionMark',
    ]);
  });

  it('binds each tool to the shared keymap shortcut', () => {
    for (const tool of MAP_EDITOR_TOOLBAR_TOOLS) {
      expect(tool.shortcut).toMatch(/^[A-Z]$/);
      expect(tool.label.length).toBeGreaterThan(0);
    }
  });
});

describe('map editor zoom helpers', () => {
  it('clamps zoom within supported bounds', () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(8)).toBe(4);
  });

  it('steps zoom in and out', () => {
    expect(zoomInFrom(1)).toBe(1.25);
    expect(zoomOutFrom(1)).toBe(0.75);
  });
});

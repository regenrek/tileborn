import { CORE_HUD_WIDGETS, HudLayout, standardHudLayout } from '@tileborne/core';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodeHudLayout, resolveEffectiveHudLayout } from './hud-layout-registry.js';

const decodeLayout = (data: unknown): HudLayout => Schema.decodeUnknownSync(HudLayout)(data);

describe('decodeHudLayout', () => {
  it('decodes valid contribution data into a typed HudLayout', () => {
    const result = decodeHudLayout('test-hud', {
      id: 'mode-hud',
      widgets: [
        {
          id: 'minimap',
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: 'top-right',
          order: 0,
          enabled: true,
        },
      ],
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.widgets[0]?.anchor).toBe('top-right');
    }
  });

  it('fails with a tagged error for invalid data', () => {
    const result = decodeHudLayout('test-hud', { id: 'broken', widgets: [{ id: 'x' }] });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('InvalidHudLayoutContributionError');
      expect(result.failure.contributionId).toBe('test-hud');
    }
  });
});

describe('resolveEffectiveHudLayout', () => {
  it('returns the plugin default unchanged without an overlay', () => {
    const base = standardHudLayout();
    expect(resolveEffectiveHudLayout(base)).toBe(base);
  });

  it('replaces overridden placements, keeps untouched ones, and appends overlay-only widgets', () => {
    const base = standardHudLayout();
    const overlay = decodeLayout({
      id: 'user-hud',
      widgets: [
        // Move the minimap to the bottom-right and push it with an offset.
        {
          id: 'minimap',
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: 'bottom-right',
          order: 0,
          enabled: true,
          offset: { x: -12, y: -12 },
        },
        // Hide the scoreboard entirely.
        {
          id: 'scoreboard',
          kind: CORE_HUD_WIDGETS.Scoreboard,
          anchor: 'top-right',
          order: 2,
          enabled: false,
        },
        // A second alive counter — extra instance of an existing kind.
        {
          id: 'alive-count-2',
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: 'top-center',
          order: 0,
          enabled: true,
        },
      ],
    });

    const effective = resolveEffectiveHudLayout(base, overlay);
    const byId = new Map(effective.widgets.map((widget) => [widget.id as string, widget]));

    expect(effective.widgets).toHaveLength(base.widgets.length + 1);
    expect(byId.get('minimap')?.anchor).toBe('bottom-right');
    expect(byId.get('scoreboard')?.enabled).toBe(false);
    expect(byId.get('alive-count-2')?.anchor).toBe('top-center');
    // Untouched default keeps its placement.
    expect(byId.get('weapon-panel')?.anchor).toBe('bottom-center');
  });
});

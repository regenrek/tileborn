import { CORE_HUD_WIDGETS, HudLayout, type HudWidgetInstanceId } from '@tileborne/core';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  hudWidgetKindLabel,
  moveWidgetOrder,
  setWidgetAnchor,
  setWidgetEnabled,
  widgetsForEditor,
} from './hud-layout-editing';

const widgetId = (id: string): HudWidgetInstanceId => id as HudWidgetInstanceId;

const sampleLayout = (): HudLayout =>
  Schema.decodeUnknownSync(HudLayout)({
    id: 'edit-hud',
    widgets: [
      {
        id: 'status',
        kind: CORE_HUD_WIDGETS.LocalPlayerStatus,
        anchor: 'top-left',
        order: 0,
        enabled: true,
      },
      {
        id: 'roster',
        kind: CORE_HUD_WIDGETS.TeamRoster,
        anchor: 'top-left',
        order: 1,
        enabled: true,
      },
      {
        id: 'minimap',
        kind: CORE_HUD_WIDGETS.Minimap,
        anchor: 'top-right',
        order: 0,
        enabled: true,
        offset: { x: 4, y: 4 },
      },
    ],
  });

describe('hud-layout-editing', () => {
  it('moves a widget to a new anchor at the end of its stacking order and drops the offset', () => {
    const next = setWidgetAnchor(sampleLayout(), widgetId('minimap'), 'top-left');
    const minimap = next.widgets.find((widget) => widget.id === 'minimap');
    expect(minimap?.anchor).toBe('top-left');
    expect(minimap?.order).toBe(2);
    expect(Option.isNone(minimap?.offset ?? Option.none())).toBe(true);
    // Other widgets untouched.
    expect(next.widgets.find((widget) => widget.id === 'status')?.order).toBe(0);
  });

  it('is a no-op when moving a widget onto its current anchor', () => {
    const layout = sampleLayout();
    const next = setWidgetAnchor(layout, widgetId('minimap'), 'top-right');
    const minimap = next.widgets.find((widget) => widget.id === 'minimap');
    expect(minimap?.order).toBe(0);
    expect(Option.getOrUndefined(minimap?.offset ?? Option.none())?.x).toBe(4);
  });

  it('toggles a widget enabled flag', () => {
    const next = setWidgetEnabled(sampleLayout(), widgetId('roster'), false);
    expect(next.widgets.find((widget) => widget.id === 'roster')?.enabled).toBe(false);
    const back = setWidgetEnabled(next, widgetId('roster'), true);
    expect(back.widgets.find((widget) => widget.id === 'roster')?.enabled).toBe(true);
  });

  it('swaps stacking order with the neighbour within the same anchor', () => {
    const next = moveWidgetOrder(sampleLayout(), widgetId('roster'), 'up');
    expect(next.widgets.find((widget) => widget.id === 'roster')?.order).toBe(0);
    expect(next.widgets.find((widget) => widget.id === 'status')?.order).toBe(1);
  });

  it('is a no-op when moving past the edge or for unknown widgets', () => {
    const layout = sampleLayout();
    expect(moveWidgetOrder(layout, widgetId('status'), 'up')).toBe(layout);
    expect(moveWidgetOrder(layout, widgetId('minimap'), 'down')).toBe(layout);
    expect(moveWidgetOrder(layout, widgetId('missing'), 'up')).toBe(layout);
  });

  it('humanizes widget kind labels', () => {
    expect(hudWidgetKindLabel('core.LocalPlayerStatus')).toBe('Local Player Status');
    expect(hudWidgetKindLabel('myplugin.ManaBar')).toBe('Mana Bar');
    expect(hudWidgetKindLabel('plain')).toBe('plain');
  });

  it('lists widgets grouped by anchor then order for the editor', () => {
    const ids = widgetsForEditor(sampleLayout()).map((widget) => widget.id as string);
    expect(ids).toEqual(['status', 'roster', 'minimap']);
  });
});

import {
  HudLayout,
  HudWidgetPlacement,
  type HudAnchor,
  type HudWidgetInstanceId,
} from '@tileborne/core';
import { Option } from 'effect';

/**
 * Pure HUD-layout editing operations backing the visual HUD editor.
 *
 * Every operation takes the EFFECTIVE layout and returns a new layout — the
 * editor keeps a draft, and persistence saves that draft as either the
 * project's designer overlay or the player's personal overlay (both merge by
 * widget instance id via `resolveEffectiveHudLayout`).
 */

const replaceWidget = (
  layout: HudLayout,
  widgetId: HudWidgetInstanceId,
  update: (widget: HudWidgetPlacement) => HudWidgetPlacement,
): HudLayout =>
  new HudLayout({
    id: layout.id,
    widgets: layout.widgets.map((widget) => (widget.id === widgetId ? update(widget) : widget)),
  });

/**
 * Move a widget to another anchor. The widget keeps its enabled state, drops
 * any pixel offset (offsets are anchor-relative) and lands at the end of the
 * target anchor's stacking order.
 */
export const setWidgetAnchor = (
  layout: HudLayout,
  widgetId: HudWidgetInstanceId,
  anchor: HudAnchor,
): HudLayout => {
  const maxOrder = layout.widgets
    .filter((widget) => widget.anchor === anchor && widget.id !== widgetId)
    .reduce((max, widget) => Math.max(max, widget.order), -1);
  return replaceWidget(layout, widgetId, (widget) =>
    widget.anchor === anchor
      ? widget
      : new HudWidgetPlacement({
          id: widget.id,
          kind: widget.kind,
          anchor,
          order: maxOrder + 1,
          enabled: widget.enabled,
          offset: Option.none(),
        }),
  );
};

/** Show or hide a widget without removing it from the layout. */
export const setWidgetEnabled = (
  layout: HudLayout,
  widgetId: HudWidgetInstanceId,
  enabled: boolean,
): HudLayout =>
  replaceWidget(layout, widgetId, (widget) =>
    widget.enabled === enabled
      ? widget
      : new HudWidgetPlacement({
          id: widget.id,
          kind: widget.kind,
          anchor: widget.anchor,
          order: widget.order,
          enabled,
          offset: widget.offset,
        }),
  );

/**
 * Swap a widget's stacking order with its neighbour within the same anchor.
 * No-op at the edges.
 */
export const moveWidgetOrder = (
  layout: HudLayout,
  widgetId: HudWidgetInstanceId,
  direction: 'up' | 'down',
): HudLayout => {
  const widget = layout.widgets.find((entry) => entry.id === widgetId);
  if (widget === undefined) {
    return layout;
  }
  const siblings = layout.widgets
    .filter((entry) => entry.anchor === widget.anchor)
    .sort((a, b) => a.order - b.order);
  const index = siblings.findIndex((entry) => entry.id === widgetId);
  const neighbour = siblings[direction === 'up' ? index - 1 : index + 1];
  if (neighbour === undefined) {
    return layout;
  }
  return new HudLayout({
    id: layout.id,
    widgets: layout.widgets.map((entry) => {
      if (entry.id === widget.id) {
        return new HudWidgetPlacement({ ...entry, order: neighbour.order });
      }
      if (entry.id === neighbour.id) {
        return new HudWidgetPlacement({ ...entry, order: widget.order });
      }
      return entry;
    }),
  });
};

/** Human label for a widget kind, e.g. `core.LocalPlayerStatus` → `Local Player Status`. */
export const hudWidgetKindLabel = (kind: string): string => {
  const name = kind.split('.').at(-1) ?? kind;
  return name.replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ');
};

/** Stable ordering of all widgets for the editor's list: by anchor, then order. */
export const widgetsForEditor = (layout: HudLayout): readonly HudWidgetPlacement[] =>
  [...layout.widgets].sort((a, b) =>
    a.anchor === b.anchor ? a.order - b.order : a.anchor.localeCompare(b.anchor),
  );

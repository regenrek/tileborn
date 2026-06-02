import type { PackId } from '@tileborne/core';

import type { BrushIntent, PaletteActionIcon } from '@/stores/editor-ui-store';

export type { PaletteActionIcon };

/**
 * A declarative palette "action" item contributed by a plugin. Each item is
 * surfaced as a first-class, selectable palette brush (a `plugin-object`
 * brush). The generic editor path keys purely on the abstract `objectKind`
 * plus presentation (`label`/`icon`) — never on any plugin-specific identity —
 * so a future game-mode plugin (e.g. an RPG top-down spawn point) contributes
 * one of these verbatim and reuses the exact same selection + placement flow.
 */
export interface PaletteActionItem {
  /** Stable identity for the contributed item (used for React keys/tests). */
  readonly id: string;
  /** Abstract object kind stamped on the map when this brush places. */
  readonly objectKind: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly icon: PaletteActionIcon;
  /** Currently always sticky: the brush stays active and places repeatedly. */
  readonly placement: 'sticky';
  /** Optional originating pack; markers/tools are usually pack-agnostic. */
  readonly packId?: PackId | undefined;
}

/** A plugin's contributed palette actions, keyed by its plugin id. */
export interface PaletteActionContribution {
  readonly pluginId: string;
  readonly items: readonly PaletteActionItem[];
}

/**
 * Resolves the palette action items contributed by the currently enabled
 * plugins. Pure: callers pass the enabled plugin ids and the registered
 * contributions, so it is trivially testable and never reaches for globals.
 */
export const resolvePaletteActions = (
  enabledPluginIds: Iterable<string>,
  contributions: readonly PaletteActionContribution[],
): readonly PaletteActionItem[] => {
  const enabled = new Set(enabledPluginIds);
  return contributions
    .filter((contribution) => enabled.has(contribution.pluginId))
    .flatMap((contribution) => contribution.items);
};

/** Builds the `plugin-object` brush that selecting a palette action activates. */
export const paletteActionBrushIntent = (item: PaletteActionItem): BrushIntent => ({
  kind: 'plugin-object',
  objectKind: item.objectKind,
  label: item.label,
  icon: item.icon,
  ...(item.packId === undefined ? {} : { packId: item.packId }),
});

/** True when `intent` is the plugin-object brush for `item` (single-highlight). */
export const brushIntentMatchesPaletteAction = (
  intent: BrushIntent,
  item: PaletteActionItem,
): boolean =>
  intent.kind === 'plugin-object' &&
  intent.objectKind === item.objectKind &&
  intent.packId === item.packId;

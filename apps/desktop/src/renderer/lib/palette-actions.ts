import type { PackId } from '@tileborne/core';

import type { BrushIntent, PaletteActionIcon } from '@/stores/editor-ui-store';

export type { PaletteActionIcon };

/**
 * A selectable palette "action" item projected from the resolved catalog. Each
 * item is surfaced as a first-class palette brush (a `plugin-object` brush). The
 * generic editor path keys purely on the abstract `objectKind` (the resolved
 * `GameObjectTypeId`) plus presentation (`label`/`icon`) — never on any
 * plugin-specific identity — so a new game-mode plugin's object types surface
 * here with zero editor edits and reuse the exact same selection + placement
 * flow.
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

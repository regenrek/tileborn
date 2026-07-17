import type { GameObjectTypeId, RuntimeCatalogEntry } from '@tileborne/core';

import { LOOT_CRATE_KIND } from './constants.js';

/**
 * Shared reads over neutral package data (instance properties, catalog
 * components) used by both the mode-data exporter and the runtime-state
 * builder — one definition so the two derivations can never drift.
 */

export const readNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const readString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

/**
 * Build BR's loot-source predicate from the merged runtime catalog: a
 * placement is a loot source when it is the well-known loot-crate type or its
 * catalog type carries the neutral `loot-source` component.
 */
export const makeIsLootSourceType = (
  catalog: readonly RuntimeCatalogEntry[],
): ((typeId: GameObjectTypeId) => boolean) => {
  const lootTypeIds = new Set(
    catalog
      .filter((entry) =>
        entry.objectType.components.some((component) => component._tag === 'loot-source'),
      )
      .map((entry) => String(entry.objectType.id)),
  );
  return (typeId) => typeId === LOOT_CRATE_KIND || lootTypeIds.has(String(typeId));
};

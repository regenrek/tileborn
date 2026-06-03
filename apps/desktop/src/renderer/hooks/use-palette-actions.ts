import { useMemo } from 'react';

import { useResolvedCatalog } from '@/hooks/queries';
import {
  groupCatalogPaletteActions,
  type CatalogPaletteGroup,
} from '@/lib/catalog-palette-projection';

const EMPTY_GROUPS: readonly CatalogPaletteGroup[] = [];

/**
 * Object-type palette actions projected from the resolved merged catalog
 * (`tileborne:catalog:resolve`), grouped by their open `family` tag. This is the
 * catalog-driven replacement for the former hardcoded `PLUGIN_PALETTE_CONTRIBUTIONS`
 * plugin import (ADR-0025 slice 4): object kinds now flow from the public catalog
 * contribution slot, so a new game-mode plugin surfaces objects with zero editor
 * edits. Returns no groups while the catalog loads or when it is empty, so the
 * Working Palette can omit the "Objects" group entirely.
 */
export function useCatalogPaletteGroups(
  projectId: string | null | undefined,
): readonly CatalogPaletteGroup[] {
  const catalogQuery = useResolvedCatalog(projectId ?? undefined);
  const objectTypes = catalogQuery.data?.objectTypes;
  return useMemo(
    () => (objectTypes === undefined ? EMPTY_GROUPS : groupCatalogPaletteActions(objectTypes)),
    [objectTypes],
  );
}

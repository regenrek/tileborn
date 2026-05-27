import type { TileId } from "../schemas/ids.js";
import type { TerrainClass } from "../schemas/terrain-class.js";
import type { VariantFilter } from "../schemas/variant-filter.js";
import type { ParseDiagnostic } from "../diagnostics.js";
import { mixSeed } from "./hash.js";

export type VariantContext = {
  readonly mapSeed: number | string;
  readonly layerId: string;
  readonly cellX: number;
  readonly cellY: number;
  readonly terrainClass?: TerrainClass;
  /** Present for animated tiles; must not influence variant selection. */
  readonly timeMs?: number;
};

export type VariantSelection = {
  readonly tileId: TileId;
  readonly weight: number;
  readonly index: number;
};

export type SelectVariantResult = VariantSelection & {
  readonly diagnostics: ReadonlyArray<ParseDiagnostic>;
};

type WeightedEntry = {
  readonly index: number;
  readonly tileId: TileId;
  readonly weight: number;
};

const emptyVariantDiagnostic = (filter: VariantFilter): ParseDiagnostic => ({
  _tag: "EmptyVariantSelection",
  path: `/variantFilters/${filter.id}`,
  message: "No positive variant weights; using first tile as fallback",
  severity: "warning",
  filterId: filter.id,
});

const negativeWeightDiagnostic = (
  filter: VariantFilter,
  weightIndex: number,
  weight: number,
): ParseDiagnostic => ({
  _tag: "VariantWeightOutOfRange",
  path: `/variantFilters/${filter.id}/weights/${weightIndex}`,
  message: "Variant weight must be non-negative",
  severity: "warning",
  filterId: filter.id,
  weightIndex,
  weight,
});

const weightCountMismatchDiagnostic = (filter: VariantFilter): ParseDiagnostic => ({
  _tag: "VariantWeightCountMismatch",
  path: `/variantFilters/${filter.id}`,
  message: "Variant weight count must match tile id count",
  severity: "warning",
  filterId: filter.id,
  tileCount: filter.tileIds.length,
  weightCount: filter.weights.length,
});

const buildWeightedEntries = (
  filter: VariantFilter,
  diagnostics: ParseDiagnostic[],
): readonly WeightedEntry[] => {
  const entries: WeightedEntry[] = [];

  for (let index = 0; index < filter.tileIds.length; index += 1) {
    const tileId = filter.tileIds[index]!;
    const weight = filter.weights[index];

    if (weight === undefined) {
      continue;
    }

    if (weight < 0) {
      diagnostics.push(negativeWeightDiagnostic(filter, index, weight));
      continue;
    }

    if (weight === 0) {
      continue;
    }

    entries.push({ index, tileId, weight });
  }

  return entries;
};

const selectWeightedIndex = (hash: number, entries: readonly WeightedEntry[]): WeightedEntry => {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let bucket = hash % totalWeight;

  for (const entry of entries) {
    if (bucket < entry.weight) {
      return entry;
    }
    bucket -= entry.weight;
  }

  return entries[entries.length - 1]!;
};

const fallbackSelection = (filter: VariantFilter): VariantSelection => ({
  tileId: filter.tileIds[0]!,
  weight: filter.weights[0] ?? 0,
  index: 0,
});

/**
 * Deterministically selects a weighted tile variant for a map cell.
 * Stable for the same seed, layer, coordinates, terrain class, and seed salt.
 */
export const selectVariant = (
  filter: VariantFilter,
  context: VariantContext,
): SelectVariantResult => {
  const diagnostics: ParseDiagnostic[] = [];

  if (filter.weights.length !== filter.tileIds.length) {
    diagnostics.push(weightCountMismatchDiagnostic(filter));
  }

  const entries = buildWeightedEntries(filter, diagnostics);

  if (entries.length === 0) {
    diagnostics.push(emptyVariantDiagnostic(filter));
    return {
      ...fallbackSelection(filter),
      diagnostics,
    };
  }

  const hash = mixSeed(
    context.mapSeed,
    context.layerId,
    context.cellX,
    context.cellY,
    context.terrainClass,
    filter.seedSalt,
  );

  const selected = selectWeightedIndex(hash, entries);

  return {
    tileId: selected.tileId,
    weight: selected.weight,
    index: selected.index,
    diagnostics,
  };
};

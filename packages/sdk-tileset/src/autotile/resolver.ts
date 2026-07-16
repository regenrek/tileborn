import { Option } from 'effect';

import type { TileId, VariantFilterId } from '../schemas/ids.js';
import type { AutotileRule } from '../schemas/autotile-rule.js';
import type { TerrainClass } from '../schemas/terrain-class.js';

import { formatMaskKey, projectBlobMask } from './mask.js';
import { NEIGHBORHOODS, type Neighborhood } from './neighborhoods.js';

export type ContributingNeighbor = {
  readonly dx: number;
  readonly dy: number;
  readonly terrain: TerrainClass;
};

export type VariantHook = {
  readonly filterId: VariantFilterId;
  readonly weight: number;
};

export type ResolveDebug = {
  readonly mask: number;
  readonly matchedPatternIndex: number | null;
  readonly fallback: boolean;
  readonly contributingNeighbors: ReadonlyArray<ContributingNeighbor>;
  readonly variantHooks?: ReadonlyArray<VariantHook>;
};

export type ResolveResult = {
  readonly tileId: TileId;
  readonly debug: ResolveDebug;
};

export type AutotileResolveLookups = {
  readonly patternForMask?: (rule: AutotileRule, mask: number) => ReadonlyArray<TileId> | undefined;
  readonly contributingNeighbors?: ReadonlyArray<ContributingNeighbor>;
  readonly variantHooks?: ReadonlyArray<VariantHook>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readCustomNeighborhood = (rule: AutotileRule): Neighborhood | undefined => {
  if (rule._tag !== 'custom' || !isRecord(rule.source)) {
    return undefined;
  }

  const neighborhood = rule.source.neighborhood;
  if (neighborhood === 'edge4') {
    return NEIGHBORHOODS.edge4;
  }
  if (neighborhood === 'corner4') {
    return NEIGHBORHOODS.corner4;
  }
  if (neighborhood === 'around8') {
    return NEIGHBORHOODS.around8;
  }

  return undefined;
};

/** Map an autotile rule variant to its canonical neighborhood. */
export const neighborhoodForRule = (rule: AutotileRule): Neighborhood => {
  switch (rule._tag) {
    case 'wang2edge':
    case 'rpgmA3':
    case 'rpgmA4':
      return NEIGHBORHOODS.edge4;
    case 'wang2corner':
    case 'wang4corner':
      return NEIGHBORHOODS.corner4;
    case 'blob47':
    case 'rpgmA2':
      return NEIGHBORHOODS.around8;
    case 'custom':
      return readCustomNeighborhood(rule) ?? NEIGHBORHOODS.around8;
    default: {
      const unreachable: never = rule;
      throw new Error(`Unsupported autotile rule tag: ${String(unreachable)}`);
    }
  }
};

const projectMaskForRule = (rule: AutotileRule, mask: number): number => {
  switch (rule._tag) {
    case 'blob47':
    case 'rpgmA2':
      return projectBlobMask(mask);
    case 'wang2edge':
    case 'rpgmA3':
    case 'rpgmA4':
      return mask & NEIGHBORHOODS.edge4.bits.reduce((bits, { bit }) => bits | (1 << bit), 0);
    case 'wang2corner':
    case 'wang4corner':
      return mask & NEIGHBORHOODS.corner4.bits.reduce((bits, { bit }) => bits | (1 << bit), 0);
    default:
      return mask;
  }
};

const tileIdsFromRule = (rule: AutotileRule, mask: number): ReadonlyArray<TileId> | undefined => {
  const neighborhood = neighborhoodForRule(rule);
  const key = formatMaskKey(mask, neighborhood);
  return rule.maskToTileIds[key];
};

const resolveTileIds = (
  rule: AutotileRule,
  mask: number,
  lookups: AutotileResolveLookups,
): {
  readonly tileIds: ReadonlyArray<TileId>;
  readonly matchedPatternIndex: number | null;
  readonly fallback: boolean;
} => {
  const fromLookup = lookups.patternForMask?.(rule, mask);
  if (fromLookup !== undefined && fromLookup.length > 0) {
    return { tileIds: fromLookup, matchedPatternIndex: 0, fallback: false };
  }

  const fromRule = tileIdsFromRule(rule, mask);
  if (fromRule !== undefined && fromRule.length > 0) {
    return { tileIds: fromRule, matchedPatternIndex: 0, fallback: false };
  }

  if (Option.isSome(rule.fallbackTileId)) {
    return {
      tileIds: [rule.fallbackTileId.value],
      matchedPatternIndex: null,
      fallback: true,
    };
  }

  throw new Error(
    `No autotile match for rule ${rule.id} with mask ${mask.toString()} (${formatMaskKey(mask, neighborhoodForRule(rule))})`,
  );
};

/** Resolve a tile for a precomputed neighborhood mask. */
export const resolveAutotile = (
  rule: AutotileRule,
  mask: number,
  lookups: AutotileResolveLookups = {},
): ResolveResult => {
  const projectedMask = projectMaskForRule(rule, mask);
  const { tileIds, matchedPatternIndex, fallback } = resolveTileIds(rule, projectedMask, lookups);

  return {
    tileId: tileIds[0]!,
    debug: {
      mask: projectedMask,
      matchedPatternIndex,
      fallback,
      contributingNeighbors: lookups.contributingNeighbors ?? [],
      ...(lookups.variantHooks !== undefined ? { variantHooks: lookups.variantHooks } : {}),
    },
  };
};

import type {
  AutotileRuleIdType,
  TerrainClassType,
  TileIdType,
  TilesetPack,
} from '@tileborne/sdk-tileset/schemas';
import {
  cellsNeedingRefresh,
  computeMask,
  formatMaskKey,
  neighborhoodForRule,
  resolveAutotile,
  type GridCell,
} from '@tileborne/sdk-tileset/autotile';
import type { AutotileRule } from '@tileborne/sdk-tileset/schemas';
import { Option } from 'effect';

export interface AutotilePaintBrush {
  readonly kind: 'paintAutotile';
  readonly ruleId: AutotileRuleIdType;
  readonly rule: AutotileRule;
  readonly tileIndexes: ReadonlySet<number>;
  readonly previewTileIndex: number;
}

export interface AutotilePaintResolver {
  readonly brushForRuleId: (ruleId: AutotileRuleIdType) => AutotilePaintBrush | undefined;
  readonly brushForTerrainClass: (
    terrainClass: TerrainClassType,
  ) => AutotilePaintBrush | undefined;
  readonly brushForTileIndex: (tileIndex: number) => AutotilePaintBrush | undefined;
  readonly directTileIndexForTerrainClass: (terrainClass: TerrainClassType) => number | undefined;
}

export const autotileCellsToRefresh = (
  changedCell: GridCell,
  brush: AutotilePaintBrush,
): readonly GridCell[] => cellsNeedingRefresh(changedCell, neighborhoodForRule(brush.rule));

export const resolveAutotileTileIndex = (
  brush: AutotilePaintBrush,
  cell: GridCell,
  tileIndexAt: (x: number, y: number) => number,
): number | undefined => {
  const neighborhood = neighborhoodForRule(brush.rule);
  const mask = computeMask(neighborhood, (dx, dy) =>
    brush.tileIndexes.has(tileIndexAt(cell.x + dx, cell.y + dy)),
  );
  const tileId = resolveAutotileTileId(brush.rule, mask);
  return tileId === undefined ? undefined : tileIndexForTileId(brush, tileId);
};

const tileIndexForTileId = (
  brush: AutotilePaintBrush,
  tileId: TileIdType,
): number | undefined => {
  for (const tileIndex of brush.tileIndexes) {
    if (brushTileIdByIndex.get(brush)?.get(tileIndex) === tileId) {
      return tileIndex;
    }
  }
  return undefined;
};

const brushTileIdByIndex = new WeakMap<AutotilePaintBrush, ReadonlyMap<number, TileIdType>>();

export const createAutotilePaintResolver = (
  pack: TilesetPack | undefined,
  tileIndexByTileId: ReadonlyMap<TileIdType, number>,
): AutotilePaintResolver | undefined => {
  if (pack === undefined) {
    return undefined;
  }

  const tileIdByTileIndex = new Map<number, TileIdType>();
  for (const [tileId, tileIndex] of tileIndexByTileId.entries()) {
    tileIdByTileIndex.set(tileIndex, tileId);
  }

  const directTileIndexByTerrainClass = new Map<TerrainClassType, number>();
  const brushByRuleId = new Map<AutotileRuleIdType, AutotilePaintBrush>();
  const brushByTerrainClass = new Map<TerrainClassType, AutotilePaintBrush>();
  const brushByTileIndex = new Map<number, AutotilePaintBrush>();

  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      const terrainClass = Option.getOrUndefined(tile.terrainClass);
      const tileIndex = tileIndexByTileId.get(tile.id);
      if (terrainClass !== undefined && tileIndex !== undefined) {
        directTileIndexByTerrainClass.set(terrainClass, tileIndex);
      }
    }

    for (const rule of tileset.autotileRules) {
      const tileIndexes = new Set<number>();
      for (const tileId of ruleTileIds(rule)) {
        const tileIndex = tileIndexByTileId.get(tileId);
        if (tileIndex !== undefined) {
          tileIndexes.add(tileIndex);
        }
      }
      if (tileIndexes.size === 0) {
        continue;
      }

      const previewTileId = previewTileIdForRule(rule);
      const previewTileIndex =
        previewTileId === undefined ? undefined : tileIndexByTileId.get(previewTileId);
      const firstTileIndex = tileIndexes.values().next().value as number | undefined;
      if (firstTileIndex === undefined) {
        continue;
      }

      const brush: AutotilePaintBrush = {
        kind: 'paintAutotile',
        ruleId: rule.id,
        rule,
        tileIndexes,
        previewTileIndex: previewTileIndex ?? firstTileIndex,
      };
      brushTileIdByIndex.set(brush, tileIdByTileIndex);
      brushByRuleId.set(rule.id, brush);
      for (const terrainClass of rule.terrainClasses) {
        if (!brushByTerrainClass.has(terrainClass)) {
          brushByTerrainClass.set(terrainClass, brush);
        }
      }
      for (const tileIndex of tileIndexes) {
        if (!brushByTileIndex.has(tileIndex)) {
          brushByTileIndex.set(tileIndex, brush);
        }
      }
    }
  }

  return {
    brushForRuleId: (ruleId) => brushByRuleId.get(ruleId),
    brushForTerrainClass: (terrainClass) => brushByTerrainClass.get(terrainClass),
    brushForTileIndex: (tileIndex) => brushByTileIndex.get(tileIndex),
    directTileIndexForTerrainClass: (terrainClass) =>
      directTileIndexByTerrainClass.get(terrainClass),
  };
};

const ruleTileIds = (rule: AutotileRule): readonly TileIdType[] => [
  ...Object.values(rule.maskToTileIds).flat(),
  ...Option.match(rule.fallbackTileId, {
    onNone: () => [],
    onSome: (tileId) => [tileId],
  }),
];

const previewTileIdForRule = (rule: AutotileRule): TileIdType | undefined => {
  try {
    return resolveAutotile(rule, 0).tileId;
  } catch {
    return ruleTileIds(rule)[0];
  }
};

const resolveAutotileTileId = (
  rule: AutotileRule,
  mask: number,
): TileIdType | undefined => {
  try {
    return resolveAutotile(rule, mask).tileId;
  } catch {
    return closestAvailableTileId(rule, mask);
  }
};

const closestAvailableTileId = (
  rule: AutotileRule,
  mask: number,
): TileIdType | undefined => {
  const neighborhood = neighborhoodForRule(rule);
  const requestedKey = formatMaskKey(mask, neighborhood);
  let best: { readonly distance: number; readonly commonBits: number; readonly tileId: TileIdType } | undefined;

  for (const [key, tileIds] of Object.entries(rule.maskToTileIds)) {
    const tileId = tileIds[0];
    if (tileId === undefined) {
      continue;
    }
    const distance = hammingDistance(requestedKey, key);
    const commonBits = countCommonEnabledBits(requestedKey, key);
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && commonBits > best.commonBits)
    ) {
      best = { distance, commonBits, tileId };
    }
  }

  return best?.tileId ?? Option.getOrUndefined(rule.fallbackTileId);
};

const hammingDistance = (left: string, right: string): number => {
  const length = Math.max(left.length, right.length);
  let distance = 0;
  for (let index = 0; index < length; index += 1) {
    if ((left[index] ?? '0') !== (right[index] ?? '0')) {
      distance += 1;
    }
  }
  return distance;
};

const countCommonEnabledBits = (left: string, right: string): number => {
  const length = Math.max(left.length, right.length);
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === '1' && right[index] === '1') {
      count += 1;
    }
  }
  return count;
};

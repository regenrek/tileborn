import type { AssetId } from "@tileborne/core";
import { Option } from "effect";

import { compileAnimation } from "../animation/compile.js";
import type { CompiledAnimation } from "../animation/types.js";
import type { AnimationId, TileId } from "../schemas/ids.js";
import type { TilesetPack } from "../schemas/tileset-pack.js";
import type { VariantFilter } from "../schemas/variant-filter.js";
import { selectVariant, type VariantContext } from "../variants/select.js";

import type { FrameLookupResult } from "./types.js";

export type FrameIndex = {
  readonly lookup: (tileId: TileId) => FrameLookupResult | undefined;
  readonly lookupWithVariant: (
    tileId: TileId,
    context: VariantContext,
  ) => FrameLookupResult | undefined;
  readonly resolveVariantTileId: (tileId: TileId, context: VariantContext) => TileId;
  readonly getCompiledAnimation: (animationId: AnimationId) => CompiledAnimation | undefined;
};

type TileEntry = {
  readonly imageAssetId: AssetId;
  readonly uv: FrameLookupResult["uv"];
  readonly animationId?: AnimationId;
  readonly sourceAssetPaths: ReadonlyArray<string>;
};

const tileIdKey = (tileId: TileId): string => String(tileId);

const variantFiltersForTile = (
  filtersByTileId: ReadonlyMap<string, readonly VariantFilter[]>,
  tileId: TileId,
): readonly VariantFilter[] => filtersByTileId.get(tileIdKey(tileId)) ?? [];

const pickVariantFilter = (
  filters: readonly VariantFilter[],
  context: VariantContext,
): VariantFilter | undefined => {
  if (filters.length === 0) {
    return undefined;
  }

  if (context.terrainClass !== undefined) {
    const terrainMatch = filters.find((filter) =>
      Option.match(filter.terrainClass, {
        onNone: () => false,
        onSome: (terrainClass) => terrainClass === context.terrainClass,
      }),
    );
    if (terrainMatch !== undefined) {
      return terrainMatch;
    }
  }

  return filters[0];
};

/** Build a renderer-neutral tile id → frame lookup table from a tileset pack. */
export const buildFrameIndex = (pack: TilesetPack): FrameIndex => {
  const assetPathById = new Map<string, string>(
    pack.assets.map((asset) => [String(asset.id), asset.path]),
  );

  const tilesById = new Map<string, TileEntry>();
  const filtersByTileId = new Map<string, VariantFilter[]>();
  const compiledAnimations = new Map<string, CompiledAnimation>();

  for (const tileset of pack.tilesets) {
    const atlasAssetId = tileset.atlasAssetId;
    const sourceAssetPaths = [assetPathById.get(String(atlasAssetId))].filter(
      (path): path is string => path !== undefined,
    );

    for (const tile of tileset.tiles) {
      const animation = Option.getOrUndefined(tile.animation);
      if (animation !== undefined) {
        const compiled = compileAnimation(animation);
        if (compiled.value !== undefined) {
          compiledAnimations.set(String(animation.id), compiled.value);
        }
      }

      tilesById.set(tileIdKey(tile.id), {
        imageAssetId: atlasAssetId,
        uv: tile.uv,
        ...(animation === undefined ? {} : { animationId: animation.id }),
        sourceAssetPaths,
      });
    }

    for (const filter of tileset.variantFilters) {
      for (const variantTileId of filter.tileIds) {
        const key = tileIdKey(variantTileId);
        const existing = filtersByTileId.get(key) ?? [];
        existing.push(filter);
        filtersByTileId.set(key, existing);
      }
    }
  }

  const lookup = (tileId: TileId): FrameLookupResult | undefined => {
    const entry = tilesById.get(tileIdKey(tileId));
    if (entry === undefined) {
      return undefined;
    }

    return {
      imageAssetId: entry.imageAssetId,
      uv: entry.uv,
      ...(entry.animationId === undefined ? {} : { animationId: entry.animationId }),
      sourceAssetPaths: entry.sourceAssetPaths,
    };
  };

  const resolveVariantTileId = (tileId: TileId, context: VariantContext): TileId => {
    const filter = pickVariantFilter(variantFiltersForTile(filtersByTileId, tileId), context);
    return filter === undefined ? tileId : selectVariant(filter, context).tileId;
  };

  const lookupWithVariant = (
    tileId: TileId,
    context: VariantContext,
  ): FrameLookupResult | undefined => lookup(resolveVariantTileId(tileId, context));

  const getCompiledAnimation = (animationId: AnimationId): CompiledAnimation | undefined =>
    compiledAnimations.get(String(animationId));

  return {
    lookup,
    lookupWithVariant,
    resolveVariantTileId,
    getCompiledAnimation,
  };
};

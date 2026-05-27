import { resolveAnimatedTile } from '@tileborne/sdk-tileset/animation';
import { buildFrameIndex, type FrameIndex } from '@tileborne/sdk-tileset/renderer';
import { Option } from 'effect';
import {
  AssetLibraryReference,
  type AssetLibraryGroup,
  type AssetLibraryGroupKind,
} from '@tileborne/core';
import type {
  Placeable,
  TileIdType,
  TilesetPack,
} from '@tileborne/sdk-tileset/schemas';

import type { WorkingPaletteItemDraft } from '@/lib/working-palettes-bridge';

export interface LibraryPreviewRef {
  /** Asset image path relative to the pack root. */
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type LibraryTabKind = Extract<
  AssetLibraryGroupKind,
  'tileset' | 'terrain' | 'autotile' | 'placeable'
>;

/**
 * Convert a sourceful identifier (`namespace:source=foo/Bar Tiles.tmx`) into a
 * compact human label. Mirrors the convention used by the existing tileset
 * palette so the asset library reads consistently across the app.
 */
const titleCaseWord = (word: string): string => {
  if (/^[A-Z0-9]+$/.test(word)) {
    return word;
  }
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
};

export const humanizeIdentifier = (
  value: string,
  options: { readonly dropTerrainSuffix?: boolean } = {},
): string => {
  const namespaced = value.includes(':') ? value.split(':').slice(1).join(':') : value;
  const sourceTail =
    namespaced
      .replace(/^source=/i, '')
      .replaceAll('\\', '/')
      .split('/')
      .filter(Boolean)
      .at(-1) ?? namespaced;
  const normalized = sourceTail
    .replace(/\.(?:tmx|tsx|png|json)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutTerrainSuffix =
    options.dropTerrainSuffix && normalized.split(' ').length > 1
      ? normalized.replace(/\s+terrain$/i, '')
      : normalized;
  const displayName = withoutTerrainSuffix.split(' ').filter(Boolean).map(titleCaseWord).join(' ');
  return displayName.length > 0 ? displayName : value;
};

const currentTileId = (
  frameIndex: FrameIndex,
  tileId: TileIdType,
  animationTimeMs: number,
): TileIdType => {
  const frame = frameIndex.lookup(tileId);
  if (frame?.animationId === undefined) {
    return tileId;
  }
  const animation = frameIndex.getCompiledAnimation(frame.animationId);
  return animation === undefined ? tileId : resolveAnimatedTile(animation, animationTimeMs);
};

const tilePreview = (
  tileId: TileIdType,
  frameIndex: FrameIndex,
  animationTimeMs: number,
): LibraryPreviewRef | undefined => {
  const frame = frameIndex.lookup(currentTileId(frameIndex, tileId, animationTimeMs));
  const assetPath = frame?.sourceAssetPaths[0];
  if (frame === undefined || assetPath === undefined) {
    return undefined;
  }
  return {
    assetPath,
    x: frame.uv.x,
    y: frame.uv.y,
    width: frame.uv.w,
    height: frame.uv.h,
  };
};

const placeablePreview = (
  placeable: Placeable,
  assetPathById: ReadonlyMap<string, string>,
): LibraryPreviewRef | undefined => {
  const frame = placeable.frames[0];
  if (frame === undefined) {
    return undefined;
  }
  const assetPath = assetPathById.get(String(frame.assetId));
  if (assetPath === undefined) {
    return undefined;
  }
  return {
    assetPath,
    x: frame.uv.x,
    y: frame.uv.y,
    width: placeable.size.width,
    height: placeable.size.height,
  };
};

export interface LibraryPreviewIndex {
  readonly previewForRef: (ref: AssetLibraryReference) => LibraryPreviewRef | undefined;
  readonly previewsForRefs: (
    refs: readonly AssetLibraryReference[],
  ) => readonly LibraryPreviewRef[];
  readonly refsForGroup: (
    group: AssetLibraryGroup,
    options?: { readonly limit?: number | undefined },
  ) => readonly AssetLibraryReference[];
}

export const buildLibraryPreviewIndex = (
  pack: TilesetPack,
  options: { readonly animationTimeMs?: number } = {},
): LibraryPreviewIndex => {
  const frameIndex = buildFrameIndex(pack);
  const animationTimeMs = options.animationTimeMs ?? 0;
  const assetPathById = new Map(pack.assets.map((asset) => [String(asset.id), asset.path]));
  const tileRefsByTilesetId = new Map<string, readonly AssetLibraryReference[]>();
  const tileRefsByTerrainClass = new Map<string, readonly AssetLibraryReference[]>();
  const tileRefsByAutotileRuleId = new Map<string, readonly AssetLibraryReference[]>();
  const placeableRefsBySource = new Map<string, readonly AssetLibraryReference[]>();
  const placeableById = new Map(
    (pack.placeables ?? []).map((placeable) => [String(placeable.id), placeable] as const),
  );
  const makeTileRef = (tileId: TileIdType): AssetLibraryReference =>
    new AssetLibraryReference({
      packId: pack.id,
      kind: 'tile',
      refId: tileId,
      tileId,
    });
  const makePlaceableRef = (placeable: Placeable): AssetLibraryReference =>
    new AssetLibraryReference({
      packId: pack.id,
      kind: 'placeable',
      refId: placeable.id,
      tileId: placeable.frames[0]?.tileId,
    });
  const uniqueTileRefs = (tileIds: Iterable<TileIdType>): readonly AssetLibraryReference[] => {
    const seen = new Set<string>();
    const refs: AssetLibraryReference[] = [];
    for (const tileId of tileIds) {
      if (seen.has(tileId)) {
        continue;
      }
      seen.add(tileId);
      refs.push(makeTileRef(tileId));
    }
    return refs;
  };

  for (const tileset of pack.tilesets) {
    tileRefsByTilesetId.set(
      String(tileset.id),
      tileset.tiles.map((tile) => makeTileRef(tile.id)),
    );
    for (const tile of tileset.tiles) {
      const terrainClass = Option.isOption(tile.terrainClass)
        ? Option.getOrUndefined(tile.terrainClass)
        : tile.terrainClass;
      if (terrainClass !== undefined) {
        tileRefsByTerrainClass.set(terrainClass, [
          ...(tileRefsByTerrainClass.get(terrainClass) ?? []),
          makeTileRef(tile.id),
        ]);
      }
    }
    for (const rule of tileset.autotileRules) {
      const ruleTileIds = Object.values(rule.maskToTileIds).flat();
      const fallbackTileId = Option.getOrUndefined(rule.fallbackTileId);
      tileRefsByAutotileRuleId.set(
        rule.id,
        uniqueTileRefs(fallbackTileId === undefined ? ruleTileIds : [...ruleTileIds, fallbackTileId]),
      );
    }
  }

  for (const placeable of pack.placeables ?? []) {
    const source = placeable.source.tilesetName;
    placeableRefsBySource.set(source, [
      ...(placeableRefsBySource.get(source) ?? []),
      makePlaceableRef(placeable),
    ]);
  }

  const previewForRef = (ref: AssetLibraryReference): LibraryPreviewRef | undefined => {
    if (ref.kind === 'placeable') {
      const placeable = placeableById.get(ref.refId);
      if (placeable !== undefined) {
        return placeablePreview(placeable, assetPathById);
      }
    }
    const rulePreviewTileId = tileRefsByAutotileRuleId.get(ref.refId)?.[0]?.tileId;
    const terrainPreviewTileId = tileRefsByTerrainClass.get(ref.refId)?.[0]?.tileId;
    const tileId =
      ref.tileId ??
      (ref.kind === 'tile'
        ? (ref.refId as TileIdType)
        : ref.kind === 'autotile'
          ? rulePreviewTileId
          : ref.kind === 'terrain'
            ? terrainPreviewTileId
            : undefined);
    return tileId === undefined ? undefined : tilePreview(tileId, frameIndex, animationTimeMs);
  };

  const previewsForRefs = (refs: readonly AssetLibraryReference[]): readonly LibraryPreviewRef[] =>
    refs.flatMap((ref) => {
      const preview = previewForRef(ref);
      return preview === undefined ? [] : [preview];
    });

  const refsForGroup = (
    group: AssetLibraryGroup,
    groupOptions: { readonly limit?: number | undefined } = {},
  ): readonly AssetLibraryReference[] => {
    const refs =
      group.kind === 'tileset'
        ? (tileRefsByTilesetId.get(group.metadata.tilesetId ?? '') ?? group.previewRefs)
        : group.kind === 'terrain'
          ? (tileRefsByTerrainClass.get(group.metadata.terrainClass ?? group.primaryRef?.refId ?? '') ??
            group.previewRefs)
          : group.kind === 'autotile'
            ? (tileRefsByAutotileRuleId.get(group.metadata.ruleId ?? group.primaryRef?.refId ?? '') ??
              group.previewRefs)
            : group.kind === 'source'
              ? (placeableRefsBySource.get(group.metadata.source ?? '') ?? group.previewRefs)
              : group.primaryRef === undefined
                ? group.previewRefs
                : [group.primaryRef];
    return groupOptions.limit === undefined ? refs : refs.slice(0, groupOptions.limit);
  };

  return { previewForRef, previewsForRefs, refsForGroup };
};

export const libraryGroupToPaletteDrafts = (
  group: AssetLibraryGroup,
): readonly WorkingPaletteItemDraft[] => {
  if (group.primaryRef !== undefined) {
    return [{ ref: group.primaryRef, label: group.label }];
  }
  return group.previewRefs.map((ref) => ({ ref, label: group.label }));
};

export const libraryGroupPrimaryPreview = (
  group: AssetLibraryGroup,
  previewIndex: LibraryPreviewIndex | undefined,
): LibraryPreviewRef | undefined => {
  if (previewIndex === undefined) {
    return undefined;
  }
  const primary = group.primaryRef ?? group.previewRefs[0];
  return primary === undefined ? undefined : previewIndex.previewForRef(primary);
};

export const libraryGroupPreviews = (
  group: AssetLibraryGroup,
  previewIndex: LibraryPreviewIndex | undefined,
  options: { readonly limit?: number | undefined } = {},
): readonly LibraryPreviewRef[] =>
  previewIndex === undefined
    ? []
    : previewIndex.previewsForRefs(
        options.limit === undefined ? group.previewRefs : group.previewRefs.slice(0, options.limit),
      );

export const libraryGroupPreviewRefs = (
  group: AssetLibraryGroup,
  previewIndex: LibraryPreviewIndex | undefined,
  options: { readonly limit?: number | undefined } = {},
): readonly AssetLibraryReference[] =>
  previewIndex === undefined
    ? options.limit === undefined
      ? group.previewRefs
      : group.previewRefs.slice(0, options.limit)
    : previewIndex.refsForGroup(group, options);

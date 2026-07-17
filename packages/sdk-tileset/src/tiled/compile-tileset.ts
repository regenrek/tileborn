import { Option } from 'effect';

import type { ParseDiagnostic, ParseResult } from '../diagnostics.js';
import { sliceAtlas } from '../atlas/slice.js';
import { Animation, AnimationFrame } from '../schemas/animation.js';
import type { CollisionMask } from '../schemas/collision-mask.js';
import { PolygonCollisionMask } from '../schemas/collision-mask.js';
import type { TilesetPackAsset } from '../schemas/tileset-pack.js';
import { TilesetPackAsset as TilesetPackAssetClass } from '../schemas/tileset-pack.js';
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  TiledPlaceableSource,
} from '../schemas/placeable.js';
import { CellSize, Tileset } from '../schemas/tileset.js';
import { Tile } from '../schemas/tile.js';
import { UVRect } from '../schemas/uv-rect.js';
import { VariantFilter } from '../schemas/variant-filter.js';
import { TerrainClass } from '../schemas/terrain-class.js';
import { Schema } from 'effect';

import { compileWangSets } from './compile-wang.js';
import {
  deterministicAnimationId,
  deterministicAssetId,
  deterministicTileId,
  deterministicTilesetId,
  deterministicPlaceableId,
  deterministicVariantFilterId,
} from './deterministic-ids.js';
import {
  primitivePropertyValue,
  propertiesToPrimitiveRecord,
  unsupportedClassPropertyFeaturesForTileset,
  unsupportedFeatureDiagnostic,
} from './support-policy.js';
import type {
  TiledJsonObject,
  TiledJsonProperty,
  TiledJsonTile,
  TiledJsonTileset,
} from './types.js';
import type { TiledImportProfile } from './types.js';

const terrainFromProperty = (seed: string, value: string): typeof TerrainClass.Type =>
  Schema.decodeUnknownSync(TerrainClass)(`${seed}:${value}`.replace(/[^A-Za-z0-9:_-]+/g, '-'));

const propertiesToRecord = propertiesToPrimitiveRecord;

const propertyTags = (properties: readonly TiledJsonProperty[] | undefined): readonly string[] =>
  (properties ?? []).map((property) => `tiled:${property.name}=${String(property.value)}`);

const propertyValue = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): string | number | boolean | undefined =>
  primitivePropertyValue(properties?.find((property) => property.name === name));

const boolProperty = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): boolean => propertyValue(properties, name) === true;

const numberProperty = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): number | undefined => {
  const value = propertyValue(properties, name);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const stringProperty = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): string | undefined => {
  const value = propertyValue(properties, name);
  return typeof value === 'string' ? value : undefined;
};

const compileCollision = (object: TiledJsonObject): CollisionMask | undefined => {
  if (object.polygon && object.polygon.length > 0) {
    return new PolygonCollisionMask({
      edges: object.polygon.map((point, index, points) => {
        const next = points[(index + 1) % points.length]!;
        return { x1: point.x, y1: point.y, x2: next.x, y2: next.y };
      }),
      passable: false,
      blocksMovement: true,
      blocksProjectiles: true,
    });
  }
  if (object.width && object.height) {
    return new PolygonCollisionMask({
      edges: [
        { x1: 0, y1: 0, x2: object.width, y2: 0 },
        { x1: object.width, y1: 0, x2: object.width, y2: object.height },
        { x1: object.width, y1: object.height, x2: 0, y2: object.height },
        { x1: 0, y1: object.height, x2: 0, y2: 0 },
      ],
      passable: false,
      blocksMovement: true,
      blocksProjectiles: true,
    });
  }
  return undefined;
};

export type CompiledTileset = {
  readonly tileset: Tileset;
  readonly assets: readonly TilesetPackAsset[];
  readonly placeables: readonly Placeable[];
  readonly sourceTileCount: number;
};

export const compileTiledTileset = (input: {
  readonly packSeed: string;
  readonly tilesetSeed: string;
  readonly source: TiledJsonTileset;
  readonly profile?: TiledImportProfile | undefined;
}): ParseResult<CompiledTileset> & { readonly diagnostics: readonly ParseDiagnostic[] } => {
  const diagnostics: ParseDiagnostic[] = [];
  const source = input.source;
  diagnostics.push(
    ...unsupportedClassPropertyFeaturesForTileset(source).map(unsupportedFeatureDiagnostic),
  );
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return { diagnostics };

  const isImageCollection = source.columns === 0;
  const margin = source.margin ?? 0;
  const spacing = source.spacing ?? 0;
  const assets: TilesetPackAsset[] = [];

  const atlasAssetId = source.image
    ? deterministicAssetId(`${input.packSeed}/${input.tilesetSeed}/${source.image}`)
    : undefined;

  if (source.image && atlasAssetId) {
    assets.push(
      new TilesetPackAssetClass({
        id: atlasAssetId,
        path: source.image,
        mime: 'image/png',
      }),
    );
  }

  const explicitTiles = new Map<number, TiledJsonTile>();
  for (const tile of source.tiles ?? []) explicitTiles.set(tile.id, tile);

  const tileIds = new Map<number, ReturnType<typeof deterministicTileId>>();
  const declaredTileIds = Array.from({ length: source.tilecount }, (_, index) => index);
  const sourceTileIds = isImageCollection
    ? [...new Set([...declaredTileIds, ...explicitTiles.keys()])].sort(
        (left, right) => left - right,
      )
    : declaredTileIds;
  const referencedTileIds = new Set<number>(sourceTileIds);
  for (const tile of explicitTiles.values()) {
    for (const frame of tile.animation ?? []) referencedTileIds.add(frame.tileid);
  }
  for (const wangset of source.wangsets ?? []) {
    for (const wangtile of wangset.wangtiles) referencedTileIds.add(wangtile.tileid);
  }
  for (const index of [...referencedTileIds].sort((left, right) => left - right)) {
    tileIds.set(index, deterministicTileId(`${input.tilesetSeed}/tile/${index}`));
  }

  const uvByIndex = new Map<number, UVRect>();
  const assetIdByIndex = new Map<number, ReturnType<typeof deterministicAssetId>>();
  if (isImageCollection) {
    for (const tile of explicitTiles.values()) {
      if (!tile.image) continue;
      const tileAssetId = deterministicAssetId(
        `${input.packSeed}/${input.tilesetSeed}/${tile.image}`,
      );
      uvByIndex.set(
        tile.id,
        new UVRect({
          x: 0,
          y: 0,
          w: tile.imagewidth ?? source.tilewidth,
          h: tile.imageheight ?? source.tileheight,
        }),
      );
      assetIdByIndex.set(tile.id, tileAssetId);
      assets.push(
        new TilesetPackAssetClass({
          id: tileAssetId,
          path: tile.image,
          mime: 'image/png',
        }),
      );
    }
  } else if (source.imagewidth && source.imageheight) {
    const sliced = sliceAtlas({
      imageWidth: source.imagewidth,
      imageHeight: source.imageheight,
      cellWidth: source.tilewidth,
      cellHeight: source.tileheight,
      margin,
      spacing,
      columns: source.columns,
      tileCount: source.tilecount,
    });
    diagnostics.push(...sliced.diagnostics);
    for (const [index, uv] of (sliced.value?.tiles ?? []).entries()) {
      uvByIndex.set(index, new UVRect(uv));
    }
  } else {
    const columns = Math.max(1, source.columns);
    for (let index = 0; index < source.tilecount; index += 1) {
      uvByIndex.set(
        index,
        new UVRect({
          x: (index % columns) * source.tilewidth,
          y: Math.floor(index / columns) * source.tileheight,
          w: source.tilewidth,
          h: source.tileheight,
        }),
      );
    }
  }

  const tiles: Tile[] = [];
  const placeables: Placeable[] = [];
  for (const index of sourceTileIds) {
    const explicit = explicitTiles.get(index);
    const tileId = tileIds.get(index)!;
    const uv = uvByIndex.get(index);
    if (!uv) continue;

    const props = explicit?.properties;
    const tags = [
      ...propertyTags(props),
      ...(explicit?.type ? [`tiled:type=${explicit.type}`] : []),
      ...(explicit?.class ? [`tiled:class=${explicit.class}`] : []),
    ];
    const terrainProperty = props?.find(
      (property) => property.name === 'terrain' || property.name === 'terrainClass',
    );
    const animation =
      explicit?.animation && explicit.animation.length > 0
        ? new Animation({
            id: deterministicAnimationId(`${input.tilesetSeed}/animation/${index}`),
            loop: true,
            frames: explicit.animation.map(
              (frame) =>
                new AnimationFrame({
                  tileId:
                    tileIds.get(frame.tileid) ??
                    deterministicTileId(`${input.tilesetSeed}/tile/${frame.tileid}`),
                  durationMs: frame.duration,
                }),
            ) as [AnimationFrame, ...AnimationFrame[]],
          })
        : undefined;

    const collisionObject = explicit?.objectgroup?.objects[0];
    const collision = collisionObject ? compileCollision(collisionObject) : undefined;
    if (!isImageCollection) {
      tiles.push(
        new Tile({
          id: tileId,
          uv,
          tags,
          terrainClass: terrainProperty
            ? Option.some(terrainFromProperty(input.tilesetSeed, String(terrainProperty.value)))
            : Option.none(),
          collisionMask: collision ? Option.some(collision) : Option.none(),
          animation: animation ? Option.some(animation) : Option.none(),
        }),
      );
    }

    const hintedPlaceable =
      !isImageCollection &&
      input.profile === 'standard-plus-hints' &&
      boolProperty(props, 'tileborne.placeable');
    if ((isImageCollection && explicit?.image) || hintedPlaceable) {
      const assetId =
        assetIdByIndex.get(index) ??
        atlasAssetId ??
        assets[0]?.id ??
        deterministicAssetId(`${input.tilesetSeed}/atlas`);
      const hintedWidth = numberProperty(props, 'tileborne.objectWidth');
      const hintedHeight = numberProperty(props, 'tileborne.objectHeight');
      const category = stringProperty(props, 'tileborne.category');
      const paintable = !isImageCollection && propertyValue(props, 'tileborne.paintable') !== false;
      placeables.push(
        new Placeable({
          id: deterministicPlaceableId(`${input.tilesetSeed}/placeable/${index}`),
          name: explicit?.class ?? explicit?.type ?? explicit?.image ?? `${source.name} ${index}`,
          size: new PlaceableSize({ width: hintedWidth ?? uv.w, height: hintedHeight ?? uv.h }),
          frames: [
            new PlaceableFrameRef({
              assetId,
              tileId,
              uv: new UVRect({
                x: uv.x,
                y: uv.y,
                w: hintedWidth ?? uv.w,
                h: hintedHeight ?? uv.h,
              }),
              durationMs: Option.none(),
            }),
          ],
          tags: category === undefined ? tags : [category, ...tags],
          placementMode: paintable && !isImageCollection ? 'tile-and-object' : 'object',
          source: new TiledPlaceableSource({
            format: 'tiled',
            tilesetName: source.name,
            localTileId: index,
            image:
              explicit?.image === undefined
                ? Option.fromNullishOr(source.image)
                : Option.some(explicit.image),
            imageWidth:
              explicit?.imagewidth === undefined
                ? hintedWidth === undefined
                  ? Option.none()
                  : Option.some(hintedWidth)
                : Option.some(explicit.imagewidth),
            imageHeight:
              explicit?.imageheight === undefined
                ? hintedHeight === undefined
                  ? Option.none()
                  : Option.some(hintedHeight)
                : Option.some(explicit.imageheight),
            objectType: explicit?.type === undefined ? Option.none() : Option.some(explicit.type),
            objectClass:
              explicit?.class === undefined ? Option.none() : Option.some(explicit.class),
            properties: {
              ...propertiesToRecord(props),
              'tileborne.anchor': 'top-left',
            },
          }),
        }),
      );
    }
  }

  const variantTiles = [...explicitTiles.values()].filter(
    (tile) => tile.probability !== undefined && tile.probability < 1,
  );
  const variantFilters =
    variantTiles.length > 0
      ? [
          new VariantFilter({
            id: deterministicVariantFilterId(`${input.tilesetSeed}/probability`),
            terrainClass: Option.none(),
            tileIds: variantTiles.map((tile) => tileIds.get(tile.id)!) as [
              ReturnType<typeof deterministicTileId>,
              ...ReturnType<typeof deterministicTileId>[],
            ],
            weights: variantTiles.map((tile) => tile.probability ?? 1),
            seedSalt: `${input.tilesetSeed}:probability`,
            stableAcrossAnimationFrames: true,
          }),
        ]
      : [];

  const tileIdForRenderableIndex = (localIndex: number) =>
    uvByIndex.has(localIndex) ? tileIds.get(localIndex) : undefined;

  const wang = compileWangSets({
    packSeed: input.packSeed,
    tilesetSeed: input.tilesetSeed,
    tileIdForIndex: tileIdForRenderableIndex,
    wangsets: source.wangsets,
  });
  diagnostics.push(...wang.diagnostics);

  const tileset = new Tileset({
    id: deterministicTilesetId(`${input.packSeed}/${input.tilesetSeed}`),
    name: source.name,
    atlasAssetId:
      atlasAssetId ?? assets[0]?.id ?? deterministicAssetId(`${input.tilesetSeed}/atlas`),
    cellSize: new CellSize({ width: source.tilewidth, height: source.tileheight }),
    margin,
    spacing,
    tiles,
    autotileRules: wang.rules,
    variantFilters,
    terrainTransitions: [],
  });

  return {
    value: { tileset, assets, placeables, sourceTileCount: source.tilecount },
    diagnostics,
  };
};

export const propertiesToMetadata = propertiesToRecord;

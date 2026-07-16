import { Option } from 'effect';

import type { TilesetPack } from '../schemas/tileset-pack.js';
import type { LayoutSnapshot } from '../renderer/layout-snapshot.js';
import { uvKey } from './helpers.js';

const tileSemanticKey = (pack: TilesetPack, tileId: string): string => {
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      if (String(tile.id) === tileId) {
        return uvKey(tile.uv);
      }
    }
  }
  return tileId;
};

/** Canonical pack shape for cross-format comparison (IDs replaced by UV keys). */
export const normalizePackForComparison = (pack: TilesetPack): unknown => {
  const tiles = pack.tilesets
    .flatMap((tileset) =>
      tileset.tiles.map((tile) => ({
        key: uvKey(tile.uv),
        uv: {
          x: tile.uv.x,
          y: tile.uv.y,
          w: tile.uv.w,
          h: tile.uv.h,
        },
        terrainClass: Option.getOrUndefined(tile.terrainClass),
        tags: [...tile.tags].sort(),
        hasAnimation: Option.isSome(tile.animation),
        collision: Option.match(tile.collisionMask, {
          onNone: () => undefined,
          onSome: (mask) => ({
            tag: mask._tag,
            ...(mask._tag === 'bitmask'
              ? { passable: mask.passable, blocked: mask.blocked }
              : {
                  edgeCount: mask.edges.length,
                  blocksMovement: mask.blocksMovement,
                }),
          }),
        }),
      })),
    )
    .sort((left, right) => left.key.localeCompare(right.key));

  const autotileRules = pack.tilesets
    .flatMap((tileset) =>
      tileset.autotileRules.map((rule) => ({
        tag: rule._tag,
        name: rule.name,
        terrainClasses: [...rule.terrainClasses].sort(),
        maskKeys: Object.keys(rule.maskToTileIds).sort(),
        maskToTileKeys: Object.fromEntries(
          Object.entries(rule.maskToTileIds)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([mask, tileIds]) => [
              mask,
              tileIds.map((id) => tileSemanticKey(pack, String(id))).sort(),
            ]),
        ),
      })),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    tilesetCount: pack.tilesets.length,
    tileCount: tiles.length,
    assetPaths: pack.assets.map((asset) => asset.path).sort(),
    tilesets: pack.tilesets.map((tileset) => ({
      name: tileset.name,
      cellSize: tileset.cellSize,
      margin: tileset.margin,
      spacing: tileset.spacing,
      tileCount: tileset.tiles.length,
    })),
    tiles,
    autotileRules,
    terrainClasses: [
      ...new Set(tiles.flatMap((tile) => (tile.terrainClass ? [tile.terrainClass] : []))),
    ].sort(),
  };
};

/** Canonical layout snapshot with semantic tile keys instead of opaque IDs. */
export const normalizeLayoutSnapshot = (pack: TilesetPack, snapshot: LayoutSnapshot): unknown => ({
  width: snapshot.width,
  height: snapshot.height,
  cells: snapshot.cells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    tileKey: tileSemanticKey(pack, cell.tileId),
    resolvedTileKey: tileSemanticKey(pack, cell.resolvedTileId),
    uv: cell.uv,
    ...(cell.flipH === undefined ? {} : { flipH: cell.flipH }),
    ...(cell.flipV === undefined ? {} : { flipV: cell.flipV }),
    ...(cell.flipD === undefined ? {} : { flipD: cell.flipD }),
    sourceAssetPaths: [...cell.sourceAssetPaths].sort(),
    ...(cell.animationId === undefined ? {} : { hasAnimation: true }),
  })),
});

/** Normalize map layer cells to local tile UV keys. */
export const normalizeMapCells = (
  pack: TilesetPack,
  cells: ReadonlyArray<{ readonly x: number; readonly y: number; readonly tileId: string }>,
): unknown =>
  cells
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      tileKey: tileSemanticKey(pack, cell.tileId),
    }))
    .sort((left, right) => (left.y === right.y ? left.x - right.x : left.y - right.y));

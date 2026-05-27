import { Tile } from "../../schemas/tile.js";
import { Tileset } from "../../schemas/tileset.js";
import type { TilesetId, TileId } from "../../schemas/ids.js";

export type TiledSourceTileProvenance = {
  readonly tilesetId: TilesetId;
  readonly tileId: TileId;
  readonly sourcePath: string;
  readonly localTileId: number;
};

export const tileProvenanceTags = (
  sourcePath: string,
  localTileId: number,
): readonly string[] => [`tiled-source:source=${sourcePath}`, `tiled-source:tile=${localTileId}`];

export const attachTileProvenanceTags = (
  tileset: Tileset,
  sourcePath: string,
): Tileset =>
  new Tileset({
    id: tileset.id,
    name: tileset.name,
    atlasAssetId: tileset.atlasAssetId,
    cellSize: tileset.cellSize,
    margin: tileset.margin,
    spacing: tileset.spacing,
    tiles: tileset.tiles.map(
      (tile, localTileId) =>
        new Tile({
          id: tile.id,
          uv: tile.uv,
          tags: [...tile.tags, ...tileProvenanceTags(sourcePath, localTileId)],
          terrainClass: tile.terrainClass,
          collisionMask: tile.collisionMask,
          animation: tile.animation,
        }),
    ),
    autotileRules: tileset.autotileRules,
    variantFilters: tileset.variantFilters,
    terrainTransitions: tileset.terrainTransitions,
  });

export const captureTileProvenance = (
  tileset: Tileset,
  sourcePath: string,
): readonly TiledSourceTileProvenance[] =>
  tileset.tiles.map((tile, localTileId) => ({
    tilesetId: tileset.id,
    tileId: tile.id,
    sourcePath,
    localTileId,
  }));

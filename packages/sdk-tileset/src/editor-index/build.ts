import { Option, Schema } from 'effect';

import { buildFrameIndex } from '../renderer/frame-index.js';
import { AutotileRule } from '../schemas/autotile-rule.js';
import { CollisionMask } from '../schemas/collision-mask.js';
import type { TileId } from '../schemas/ids.js';
import { Placeable } from '../schemas/placeable.js';
import type { TerrainClass } from '../schemas/terrain-class.js';
import { TerrainTransition } from '../schemas/terrain-transition.js';
import type { TilesetPack } from '../schemas/tileset-pack.js';

import {
  EDITOR_TILESET_INDEX_SCHEMA_VERSION,
  type EditorIndexCollisionEntry,
  type EditorIndexFrame,
  type EditorIndexLicense,
  type EditorTilesetIndexJson,
} from './types.js';

const AutotileRulesCodec = Schema.Array(AutotileRule);
const TerrainTransitionsCodec = Schema.Array(TerrainTransition);
const PlaceablesCodec = Schema.Array(Placeable);

const encodeLicense = (license: TilesetPack['license']): EditorIndexLicense => ({
  spdxId: license.spdxId,
  ...(Option.isSome(license.attribution) ? { attribution: license.attribution.value } : {}),
  ...(Option.isSome(license.sourceUrl) ? { sourceUrl: license.sourceUrl.value } : {}),
  ...(license.sourcePath === undefined ? {} : { sourcePath: license.sourcePath }),
  ...(license.modifications === undefined ? {} : { modifications: license.modifications }),
  ...(Option.isSome(license.notes) ? { notes: license.notes.value } : {}),
  redistributable: license.redistributable,
});

const tileIdsForRule = (rule: AutotileRule): readonly TileId[] => [
  ...Object.values(rule.maskToTileIds).flat(),
  ...Option.match(rule.fallbackTileId, {
    onNone: () => [],
    onSome: (tileId) => [tileId],
  }),
];

const addTerrainRepresentative = (
  terrainFirstTileId: Record<string, string>,
  directTileIndexByTerrainClass: Record<string, number>,
  terrainClass: TerrainClass,
  tileId: TileId,
  tileIndex: number,
): void => {
  const key = String(terrainClass);
  if (terrainFirstTileId[key] === undefined) {
    terrainFirstTileId[key] = String(tileId);
  }
  if (directTileIndexByTerrainClass[key] === undefined) {
    directTileIndexByTerrainClass[key] = tileIndex;
  }
};

/**
 * Build the compact, plain-JSON editor index from a parsed pack. Runs on the
 * main process; the global tile-index ordering (1..N) follows the exact
 * `pack.tilesets[].tiles[]` iteration used by `tileset-pack.ts`, so saved map
 * tile indices stay valid.
 */
export const buildEditorTilesetIndex = (
  pack: TilesetPack,
  integrityHash: string,
): EditorTilesetIndexJson => {
  const frameIndex = buildFrameIndex(pack);

  const orderedTileIds: string[] = [];
  const frames: Record<string, EditorIndexFrame> = {};
  const collisionByTileIndex: EditorIndexCollisionEntry[] = [];
  const terrainFirstTileId: Record<string, string> = {};
  const directTileIndexByTerrainClass: Record<string, number> = {};
  const tileIndexByTileId = new Map<string, number>();

  let tileIndex = 0;
  for (const tileset of pack.tilesets) {
    for (const tile of tileset.tiles) {
      tileIndex += 1;
      const tileIdStr = String(tile.id);
      orderedTileIds.push(tileIdStr);
      tileIndexByTileId.set(tileIdStr, tileIndex);

      const frame = frameIndex.lookup(tile.id);
      const assetPath = frame?.sourceAssetPaths[0];
      if (frame !== undefined && assetPath !== undefined) {
        frames[tileIdStr] = {
          assetPath,
          uv: { x: frame.uv.x, y: frame.uv.y, w: frame.uv.w, h: frame.uv.h },
          ...(frame.animationId === undefined ? {} : { animationId: String(frame.animationId) }),
        };
      }

      const mask = Option.getOrUndefined(tile.collisionMask);
      if (mask !== undefined) {
        collisionByTileIndex.push({
          tileIndex,
          mask: Schema.encodeUnknownSync(CollisionMask)(mask),
        });
      }

      const terrainClass = Option.getOrUndefined(tile.terrainClass);
      if (terrainClass !== undefined) {
        if (terrainFirstTileId[terrainClass] === undefined) {
          terrainFirstTileId[terrainClass] = tileIdStr;
        }
        directTileIndexByTerrainClass[terrainClass] = tileIndex;
      }
    }
  }

  for (const tileset of pack.tilesets) {
    for (const rule of tileset.autotileRules) {
      for (const terrainClass of rule.terrainClasses) {
        for (const tileId of tileIdsForRule(rule)) {
          const tileIndexForRule = tileIndexByTileId.get(String(tileId));
          if (tileIndexForRule === undefined) {
            continue;
          }
          addTerrainRepresentative(
            terrainFirstTileId,
            directTileIndexByTerrainClass,
            terrainClass,
            tileId,
            tileIndexForRule,
          );
          break;
        }
      }
    }
  }

  const assetPathById = new Map(pack.assets.map((asset) => [String(asset.id), asset.path]));
  const atlasAssetPaths = [
    ...new Set(
      pack.tilesets
        .map((tileset) => assetPathById.get(String(tileset.atlasAssetId)))
        .filter((path): path is string => path !== undefined),
    ),
  ];

  return {
    schemaVersion: EDITOR_TILESET_INDEX_SCHEMA_VERSION,
    integrityHash,
    packMeta: {
      id: String(pack.id),
      name: pack.name,
      version: pack.version,
      license: encodeLicense(pack.license),
    },
    assets: pack.assets.map((asset) => ({
      id: String(asset.id),
      path: asset.path,
      mime: asset.mime,
    })),
    orderedTileIds,
    frames,
    collisionByTileIndex,
    terrainFirstTileId,
    directTileIndexByTerrainClass,
    autotileRules: Schema.encodeUnknownSync(AutotileRulesCodec)(
      pack.tilesets.flatMap((tileset) => tileset.autotileRules),
    ) as readonly unknown[],
    terrainTransitions: Schema.encodeUnknownSync(TerrainTransitionsCodec)(
      pack.tilesets.flatMap((tileset) => tileset.terrainTransitions),
    ) as readonly unknown[],
    placeables: Schema.encodeUnknownSync(PlaceablesCodec)(
      pack.placeables ?? [],
    ) as readonly unknown[],
    atlasAssetPaths,
  };
};

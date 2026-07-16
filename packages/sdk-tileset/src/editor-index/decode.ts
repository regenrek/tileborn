import type { AssetId, JsonObject, PackId } from '@tileborne/core';
import { Option } from 'effect';

import {
  AutotileRule,
  Blob47AutotileRule,
  CustomAutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from '../schemas/autotile-rule.js';
import type { CollisionMask } from '../schemas/collision-mask.js';
import type { AutotileRuleId, TileId } from '../schemas/ids.js';
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  SpriteClip,
  TiledPlaceableSource,
  type PlaceablePlacementMode,
} from '../schemas/placeable.js';
import type { ClipId } from '../schemas/ids.js';
import type { TerrainClass } from '../schemas/terrain-class.js';
import { TerrainTransition } from '../schemas/terrain-transition.js';
import { UVRect } from '../schemas/uv-rect.js';

import type { EditorIndexAsset, EditorIndexPackMeta, EditorTilesetIndexJson } from './types.js';

/** Precomputed tile frame, equivalent to `toPixiDescriptor(frameIndex.lookup(tileId))`. */
export interface EditorTileFrame {
  readonly tileId: TileId;
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Runtime view of a decoded editor index for one pack. */
export interface DecodedEditorTilesetIndex {
  readonly packId: PackId;
  readonly packMeta: EditorIndexPackMeta;
  readonly assets: readonly EditorIndexAsset[];
  readonly tileIndexByTileId: ReadonlyMap<TileId, number>;
  readonly tileIdByTileIndex: ReadonlyMap<number, TileId>;
  readonly tileFramesByIndex: ReadonlyMap<number, EditorTileFrame>;
  readonly collisionMaskByTileIndex: ReadonlyMap<number, CollisionMask>;
  readonly terrainFirstTileId: ReadonlyMap<TerrainClass, TileId>;
  readonly directTileIndexByTerrainClass: ReadonlyMap<TerrainClass, number>;
  readonly autotileRules: readonly AutotileRule[];
  readonly terrainTransitions: readonly TerrainTransition[];
  readonly placeables: readonly Placeable[];
  readonly atlasAssetPaths: readonly string[];
}

const toOption = <A>(value: A | undefined | null): Option.Option<A> =>
  value === undefined || value === null ? Option.none() : Option.some(value);

type RawUv = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

interface RawAutotileRule {
  readonly _tag: string;
  readonly id: string;
  readonly name: string;
  readonly terrainClasses: readonly string[];
  readonly maskToTileIds: Record<string, readonly string[]>;
  readonly fallbackTileId?: string;
  readonly source?: unknown;
}

interface RawPlaceableFrame {
  readonly assetId: string;
  readonly tileId: string;
  readonly uv: RawUv;
  readonly durationMs?: number;
}

interface RawSpriteClip {
  readonly id: string;
  readonly name: string;
  readonly frames: readonly RawPlaceableFrame[];
  readonly loop: boolean;
  readonly defaultDurationMs: number;
}

interface RawPlaceableSource {
  readonly format: 'tiled';
  readonly tilesetName: string;
  readonly localTileId: number;
  readonly image?: string;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly objectType?: string;
  readonly objectClass?: string;
  readonly properties: JsonObject;
}

interface RawPlaceable {
  readonly id: string;
  readonly name: string;
  readonly size: { readonly width: number; readonly height: number };
  readonly frames: readonly RawPlaceableFrame[];
  readonly clips?: readonly RawSpriteClip[];
  readonly tags: readonly string[];
  readonly placementMode: string;
  readonly source: RawPlaceableSource;
}

interface RawTerrainTransition {
  readonly from: string;
  readonly to: string;
  readonly ruleId: string;
}

/**
 * Reconstruct a runtime {@link AutotileRule} from its plain-JSON form. This
 * mirrors the manifest parser's `toAutotileRule` (the rules were already
 * sanitized when the source pack was parsed) and is JSON-round-trip safe:
 * `fallbackTileId` becomes a real `Option` even when the key is absent.
 */
const reconstructAutotileRule = (raw: RawAutotileRule): AutotileRule => {
  const base = {
    id: raw.id as AutotileRuleId,
    name: raw.name,
    terrainClasses: raw.terrainClasses as readonly TerrainClass[],
    maskToTileIds: raw.maskToTileIds as Record<string, readonly [TileId, ...TileId[]]>,
    fallbackTileId: toOption(raw.fallbackTileId as TileId | undefined),
  };
  switch (raw._tag) {
    case 'wang2corner':
      return new Wang2CornerAutotileRule(base);
    case 'wang2edge':
      return new Wang2EdgeAutotileRule(base);
    case 'wang4corner':
      return new Wang4CornerAutotileRule(base);
    case 'blob47':
      return new Blob47AutotileRule(base);
    case 'rpgmA2':
      return new RpgmA2AutotileRule(base);
    case 'rpgmA3':
      return new RpgmA3AutotileRule(base);
    case 'rpgmA4':
      return new RpgmA4AutotileRule(base);
    case 'custom':
      return new CustomAutotileRule({ ...base, source: raw.source });
    default:
      throw new Error(`Unsupported autotile rule tag in editor index: ${raw._tag}`);
  }
};

const reconstructPlaceableFrame = (frame: RawPlaceableFrame): PlaceableFrameRef =>
  new PlaceableFrameRef({
    assetId: frame.assetId as AssetId,
    tileId: frame.tileId as TileId,
    uv: new UVRect(frame.uv),
    durationMs: toOption(frame.durationMs),
  });

const reconstructPlaceable = (raw: RawPlaceable): Placeable =>
  new Placeable({
    id: raw.id as Placeable['id'],
    name: raw.name,
    size: new PlaceableSize({ width: raw.size.width, height: raw.size.height }),
    frames: raw.frames.map(reconstructPlaceableFrame) as [
      PlaceableFrameRef,
      ...PlaceableFrameRef[],
    ],
    ...(raw.clips === undefined
      ? {}
      : {
          clips: raw.clips.map(
            (clip) =>
              new SpriteClip({
                id: clip.id as ClipId,
                name: clip.name,
                frames: clip.frames.map(reconstructPlaceableFrame) as [
                  PlaceableFrameRef,
                  ...PlaceableFrameRef[],
                ],
                loop: clip.loop,
                defaultDurationMs: clip.defaultDurationMs,
              }),
          ),
        }),
    tags: raw.tags as string[],
    placementMode: raw.placementMode as PlaceablePlacementMode,
    source: new TiledPlaceableSource({
      format: raw.source.format,
      tilesetName: raw.source.tilesetName,
      localTileId: raw.source.localTileId,
      image: toOption(raw.source.image),
      imageWidth: toOption(raw.source.imageWidth),
      imageHeight: toOption(raw.source.imageHeight),
      objectType: toOption(raw.source.objectType),
      objectClass: toOption(raw.source.objectClass),
      properties: raw.source.properties,
    }),
  });

/**
 * Decode a persisted editor index into renderer-ready lookups. Tile-scale data
 * (tile ids, frames, collision masks) is reconstructed without per-tile Schema
 * decoding — branded ids are structurally plain strings so casting is sound and
 * keeps the hot path O(N) map building instead of O(N) Schema validation. The
 * small rule/placeable/transition collections are rebuilt into their exact
 * runtime instances (incl. `Option` fields), preserving paint correctness.
 */
export const decodeEditorTilesetIndex = (
  json: EditorTilesetIndexJson,
): DecodedEditorTilesetIndex => {
  const tileIndexByTileId = new Map<TileId, number>();
  const tileIdByTileIndex = new Map<number, TileId>();
  const tileFramesByIndex = new Map<number, EditorTileFrame>();

  json.orderedTileIds.forEach((tileIdStr, position) => {
    const tileIndex = position + 1;
    const tileId = tileIdStr as TileId;
    tileIndexByTileId.set(tileId, tileIndex);
    tileIdByTileIndex.set(tileIndex, tileId);
    const frame = json.frames[tileIdStr];
    if (frame !== undefined) {
      tileFramesByIndex.set(tileIndex, {
        tileId,
        assetPath: frame.assetPath,
        x: frame.uv.x,
        y: frame.uv.y,
        width: frame.uv.w,
        height: frame.uv.h,
      });
    }
  });

  const collisionMaskByTileIndex = new Map<number, CollisionMask>();
  for (const entry of json.collisionByTileIndex) {
    collisionMaskByTileIndex.set(entry.tileIndex, entry.mask as CollisionMask);
  }

  const terrainFirstTileId = new Map<TerrainClass, TileId>();
  for (const [terrainClass, tileId] of Object.entries(json.terrainFirstTileId)) {
    terrainFirstTileId.set(terrainClass as TerrainClass, tileId as TileId);
  }

  const directTileIndexByTerrainClass = new Map<TerrainClass, number>();
  for (const [terrainClass, tileIndex] of Object.entries(json.directTileIndexByTerrainClass)) {
    directTileIndexByTerrainClass.set(terrainClass as TerrainClass, tileIndex);
  }

  return {
    packId: json.packMeta.id as PackId,
    packMeta: json.packMeta,
    assets: json.assets,
    tileIndexByTileId,
    tileIdByTileIndex,
    tileFramesByIndex,
    collisionMaskByTileIndex,
    terrainFirstTileId,
    directTileIndexByTerrainClass,
    autotileRules: (json.autotileRules as readonly RawAutotileRule[]).map(reconstructAutotileRule),
    terrainTransitions: (json.terrainTransitions as readonly RawTerrainTransition[]).map(
      (raw) =>
        new TerrainTransition({
          from: raw.from as TerrainClass,
          to: raw.to as TerrainClass,
          ruleId: raw.ruleId as AutotileRuleId,
        }),
    ),
    placeables: (json.placeables as readonly RawPlaceable[]).map(reconstructPlaceable),
    atlasAssetPaths: json.atlasAssetPaths,
  };
};

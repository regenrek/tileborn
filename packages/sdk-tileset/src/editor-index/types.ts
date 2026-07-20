import { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';

/**
 * Compact, plain-JSON editor/runtime index for a tileset pack.
 *
 * Built once on the main process from the parsed {@link TilesetPack} (the
 * canonical `tileborne-asset-pack.json` stays the source of truth), persisted
 * content-addressed by integrity hash, and consumed by the renderer viewport so
 * it no longer has to Effect-Schema decode the full ~30k-tile manifest on the
 * hot path.
 *
 * Everything here is serializable plain JSON: no Effect `Option` values and no
 * Schema class instances. Tile-scale data (`orderedTileIds`, `frames`,
 * `collisionByTileIndex`) is precomputed into flat lookups so the renderer never
 * iterates the full tile set. The small per-pack rule/placeable collections are
 * stored as Schema-encoded JSON (still plain JSON) so the renderer can decode
 * them back into the exact same instances the manifest parser would have
 * produced — preserving autotile/terrain/placeable paint correctness.
 */
export const EDITOR_TILESET_INDEX_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.editorTilesetIndex;

/** Atlas rectangle for one tile/frame (matches `UVRect`). */
export interface EditorIndexUv {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Frame lookup for one tile id (mirrors `FrameIndex.lookup` output). */
export interface EditorIndexFrame {
  /** `FrameLookupResult.sourceAssetPaths[0]` — the atlas image path. */
  readonly assetPath: string;
  readonly uv: EditorIndexUv;
  readonly animationId?: string;
}

/** Sparse collision entry keyed by global tile index (1..N). */
export interface EditorIndexCollisionEntry {
  readonly tileIndex: number;
  /** Schema-encoded `CollisionMask` (plain JSON tagged union). */
  readonly mask: unknown;
}

export interface EditorIndexAsset {
  readonly id: string;
  readonly path: string;
  readonly mime: string;
}

export interface EditorIndexLicense {
  readonly spdxId: string;
  readonly attribution?: string;
  readonly sourceUrl?: string;
  readonly sourcePath?: string;
  readonly modifications?: string;
  readonly notes?: string;
  readonly redistributable: boolean;
}

export interface EditorIndexPackMeta {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: EditorIndexLicense;
}

/**
 * Persisted, serializable editor index. `orderedTileIds[k]` is the tile id at
 * the global tile index `k + 1`, matching the canonical
 * `tileset-pack.ts` iteration so saved map tile indices stay valid.
 */
export interface EditorTilesetIndexJson {
  readonly schemaVersion: number;
  readonly integrityHash: string;
  readonly packMeta: EditorIndexPackMeta;
  readonly assets: readonly EditorIndexAsset[];
  readonly orderedTileIds: readonly string[];
  readonly frames: Readonly<Record<string, EditorIndexFrame>>;
  readonly collisionByTileIndex: readonly EditorIndexCollisionEntry[];
  /** First tile id seen per terrain class (terrain-brush representative tile). */
  readonly terrainFirstTileId: Readonly<Record<string, string>>;
  /** Last tile index seen per terrain class (autotile-resolver direct mapping). */
  readonly directTileIndexByTerrainClass: Readonly<Record<string, number>>;
  /** Schema-encoded `AutotileRule[]`, flattened across tilesets in pack order. */
  readonly autotileRules: readonly unknown[];
  /** Schema-encoded `TerrainTransition[]`, flattened across tilesets in pack order. */
  readonly terrainTransitions: readonly unknown[];
  /** Schema-encoded `Placeable[]`. */
  readonly placeables: readonly unknown[];
  /** Atlas image paths (deduped, pack order) for building `renderableAssetIdByPath`. */
  readonly atlasAssetPaths: readonly string[];
}

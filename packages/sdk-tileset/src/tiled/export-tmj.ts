import type { ParseDiagnostic } from '../diagnostics.js';

import { buildTilesetWindows } from './compile-map.js';
import { encodeTiledGid, tiledGidForTileborneTileIndex, type TiledTilesetWindow } from './gid.js';
import type {
  TiledJsonAnyLayer,
  TiledJsonMap,
  TiledJsonObject,
  TiledJsonProperty,
  TiledJsonTileLayer,
  TiledJsonTileset,
  TiledMapImport,
  TiledMapLayer,
  TiledMapObject,
  TiledMapTileLayer,
} from './types.js';

/**
 * A Tiled tileset definition paired with its `firstgid` window. This is the
 * inverse of the `TiledJsonTilesetRef` the importer reads: the exporter needs
 * the original tileset metadata (name/dimensions/tile entries) plus a firstgid
 * to project Tileborne tile indices back to Tiled global ids. `firstgid` may be
 * omitted, in which case the exporter assigns sequential firstgids in input
 * order (1, then `prev.firstgid + prev.tilecount`).
 */
export type TmjExportTileset = { readonly firstgid?: number } & TiledJsonTileset;

export type ExportTiledMapToTmjInput = {
  readonly map: TiledMapImport;
  readonly tilesets: readonly TmjExportTileset[];
  readonly version?: string;
  readonly tiledversion?: string;
};

export type ExportTiledMapToTmjResult = {
  readonly tmj: TiledJsonMap;
  readonly diagnostics: readonly ParseDiagnostic[];
};

/**
 * Object property keys that the importer synthesizes from non-property fields.
 * They are re-projected back onto their structural slots on export rather than
 * emitted as Tiled custom properties.
 */
const SYNTHETIC_OBJECT_PROPERTY_KEYS = new Set(['tileborne.anchor', 'point', 'ellipse']);

const TILED_DEFAULT_VERSION = '1.10';

const inferTiledPropertyType = (value: string | number | boolean): TiledJsonProperty['type'] => {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  return 'string';
};

/**
 * Project a flattened Tileborne property record back to Tiled custom properties.
 * Property keys are sorted for deterministic output. Number values are emitted
 * as `int` when integral, otherwise `float`; the neutral schema does not retain
 * Tiled's `color`/`file`/`object`/`class` distinctions (they are flattened to
 * primitives on import), so those are emitted as their primitive carrier type.
 */
export const metadataToTiledProperties = (
  properties: Readonly<Record<string, string | number | boolean>>,
): readonly TiledJsonProperty[] =>
  Object.keys(properties)
    .sort()
    .map((name) => {
      const value = properties[name]!;
      return { name, type: inferTiledPropertyType(value), value };
    });

const tilesetExportWindows = (
  tilesets: readonly { readonly firstgid: number; readonly tileset: TiledJsonTileset }[],
): readonly TiledTilesetWindow[] =>
  buildTilesetWindows(
    tilesets.map((entry) => ({
      firstgid: entry.firstgid,
      tilecount: entry.tileset.tilecount,
      // Image-collection tilesets (columns === 0) contribute no paintable grid
      // tiles, matching the import-side tile-index allocation.
      tileborneTileCount: entry.tileset.columns === 0 ? 0 : entry.tileset.tilecount,
      name: entry.tileset.name,
    })),
  );

const assignFirstgids = (
  tilesets: readonly TmjExportTileset[],
): readonly { readonly firstgid: number; readonly tileset: TiledJsonTileset }[] => {
  let nextFirstgid = 1;
  return tilesets.map((entry) => {
    const { firstgid: providedFirstgid, ...tileset } = entry;
    const firstgid = providedFirstgid ?? nextFirstgid;
    nextFirstgid = firstgid + tileset.tilecount;
    return { firstgid, tileset };
  });
};

const tileLayerData = (
  layer: TiledMapTileLayer,
  windows: readonly TiledTilesetWindow[],
): readonly number[] =>
  layer.cells.map((cell) => {
    const gid = tiledGidForTileborneTileIndex(cell.tileIndex, windows);
    // Re-apply flip/rotation flags via the inverse of the import-side decode.
    // Fall back to the original raw gid when the tile index could not be
    // resolved (e.g. it referenced a non-paintable tileset) so we never
    // silently drop a non-empty cell.
    if (gid === 0 && cell.rawGid !== 0) return cell.rawGid;
    return encodeTiledGid({ gid, transform: cell.transform });
  });

const tileLayerJson = (
  layer: TiledMapTileLayer,
  windows: readonly TiledTilesetWindow[],
): TiledJsonTileLayer => {
  const properties = metadataToTiledProperties(layer.properties);
  return {
    type: 'tilelayer',
    name: layer.name,
    ...(layer.class === undefined ? {} : { class: layer.class }),
    width: layer.width,
    height: layer.height,
    data: tileLayerData(layer, windows),
    ...(layer.visible ? {} : { visible: false }),
    ...(layer.opacity === 1 ? {} : { opacity: layer.opacity }),
    ...(properties.length === 0 ? {} : { properties }),
  };
};

const numericObjectId = (sourceId: string, fallback: number): number => {
  const match = /object:(\d+)$/.exec(sourceId);
  return match ? Number(match[1]) : fallback;
};

const objectJson = (object: TiledMapObject, fallbackId: number): TiledJsonObject => {
  const properties = metadataToTiledProperties(
    Object.fromEntries(
      Object.entries(object.properties).filter(([key]) => !SYNTHETIC_OBJECT_PROPERTY_KEYS.has(key)),
    ),
  );
  const isPoint = object.properties['point'] === true;
  const isEllipse = object.properties['ellipse'] === true;

  const gid =
    object.tileRef === undefined
      ? undefined
      : encodeTiledGid({ gid: object.tileRef.gid, transform: object.tileRef.transform });

  // Tile objects are stored top-left anchored in the neutral schema; Tiled's
  // default tile-object anchor is bottom-left, so re-project the y origin.
  const y = gid !== undefined && object.height !== undefined ? object.y + object.height : object.y;

  return {
    id: numericObjectId(object.id, fallbackId),
    x: object.x,
    y,
    ...(gid === undefined ? {} : { gid }),
    ...(object.width === undefined ? {} : { width: object.width }),
    ...(object.height === undefined ? {} : { height: object.height }),
    ...(object.class === undefined ? {} : { type: object.class }),
    ...(object.name === '' ? {} : { name: object.name }),
    ...(isPoint ? { point: true } : {}),
    ...(isEllipse ? { ellipse: true } : {}),
    ...(properties.length === 0 ? {} : { properties }),
  };
};

type TiledJsonObjectGroupLayer = Extract<TiledJsonAnyLayer, { readonly type: 'objectgroup' }>;

const objectGroupJson = (objects: readonly TiledMapObject[]): TiledJsonObjectGroupLayer => {
  const first = objects[0]!;
  return {
    type: 'objectgroup',
    name: first.layerName,
    ...(first.layerVisible ? {} : { visible: false }),
    ...(first.layerOpacity === 1 ? {} : { opacity: first.layerOpacity }),
    objects: objects.map((object, index) => objectJson(object, index + 1)),
  };
};

const collectLayers = (
  layers: readonly TiledMapLayer[],
  windows: readonly TiledTilesetWindow[],
  diagnostics: ParseDiagnostic[],
): readonly TiledJsonAnyLayer[] => {
  const out: TiledJsonAnyLayer[] = [];
  let pendingLayerId: string | undefined;
  let pendingObjects: TiledMapObject[] = [];

  const flushObjects = (): void => {
    if (pendingObjects.length === 0) return;
    out.push(objectGroupJson(pendingObjects));
    pendingObjects = [];
    pendingLayerId = undefined;
  };

  for (const layer of layers) {
    if (layer.kind === 'object') {
      if (pendingLayerId !== undefined && pendingLayerId !== layer.layerId) flushObjects();
      pendingLayerId = layer.layerId;
      pendingObjects.push(layer);
      continue;
    }

    flushObjects();

    if (layer.kind === 'tile') {
      out.push(tileLayerJson(layer, windows));
      continue;
    }

    if (layer.kind === 'image') {
      out.push({
        type: 'imagelayer',
        name: layer.name,
        image: layer.image,
        ...(layer.x === undefined ? {} : { x: layer.x }),
        ...(layer.y === undefined ? {} : { y: layer.y }),
        ...(layer.visible ? {} : { visible: false }),
        ...(layer.opacity === 1 ? {} : { opacity: layer.opacity }),
        ...(Object.keys(layer.properties).length === 0
          ? {}
          : { properties: metadataToTiledProperties(layer.properties) }),
      });
      continue;
    }

    // Group layers are flattened on export (Tileborne stays flat at v1 per
    // ADR-0020). Nested layers are emitted inline at the top level.
    diagnostics.push({
      _tag: 'TiledUnsupportedFeature',
      path: `/layers/${layer.name}`,
      message: `Group layer "${layer.name}" was flattened on export; Tileborne maps are flat at v1.`,
      severity: 'info',
      feature: 'group-layer-flattened',
    });
    out.push(...collectLayers(layer.layers, windows, diagnostics));
  }

  flushObjects();
  return out;
};

/**
 * Export a neutral Tileborne Tiled map (the `tiledMap` produced by the importer)
 * back to a Tiled JSON (TMJ) map. This is the inverse of {@link compileTiledMap}:
 * tile indices are re-encoded to global ids (with flip/rotation flags re-applied
 * via {@link encodeTiledGid}), tilesets are emitted with firstgid windows, object
 * layers are reconstructed, and custom properties are round-tripped.
 *
 * TMX/TSX (XML) writing is intentionally deferred (ADR-0020 Phase 4); TMJ is the
 * canonical round-trip target.
 */
export const exportTiledMapToTmj = (input: ExportTiledMapToTmjInput): ExportTiledMapToTmjResult => {
  const diagnostics: ParseDiagnostic[] = [];
  const assignedTilesets = assignFirstgids(input.tilesets);
  const windows = tilesetExportWindows(assignedTilesets);
  const layers = collectLayers(input.map.layers, windows, diagnostics);
  const properties = metadataToTiledProperties(input.map.properties);

  const tmj: TiledJsonMap = {
    type: 'map',
    version: input.version ?? TILED_DEFAULT_VERSION,
    ...(input.tiledversion === undefined ? {} : { tiledversion: input.tiledversion }),
    orientation: input.map.orientation,
    width: input.map.width,
    height: input.map.height,
    tilewidth: input.map.tileWidth,
    tileheight: input.map.tileHeight,
    tilesets: assignedTilesets.map((entry) => ({ firstgid: entry.firstgid, ...entry.tileset })),
    layers,
    ...(properties.length === 0 ? {} : { properties }),
  };

  return { tmj, diagnostics };
};

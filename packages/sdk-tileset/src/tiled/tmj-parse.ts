import { Option } from "effect";

import type { ParseDiagnostic, ParseResult } from "../diagnostics.js";
import { TilesetPack, TilesetPackLicense } from "../schemas/tileset-pack.js";

import { buildTilesetWindows, compileTiledMap } from "./compile-map.js";
import { compileTiledTileset } from "./compile-tileset.js";
import { compileTileborneMap } from "./core-map.js";
import { deterministicPackId } from "./deterministic-ids.js";
import {
  isSupportedTilesetSource,
  readExternalText,
  resolveExternalPath,
  tilesetIdFromSource,
} from "./external-resolve.js";
import { decodeTileLayerDataAsync, decodeTileLayerDataSync } from "./tile-data.js";
import { normalizeJsonTileLayers, validateTiledJsonMap } from "./validate.js";
import { parseTsj } from "./tsj-parse.js";
import { parseTsx } from "./tsx-parse.js";
import { normalizeTiledTilesetImageAssetPaths } from "./image-paths.js";
import type { TiledImportOptions, TiledImportSuccess, TiledJsonAnyLayer, TiledJsonMap, TiledJsonTileLayer, TiledJsonTileset } from "./types.js";

const hasBlockingDiagnostics = (diagnostics: readonly ParseDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");

const layerDecodeInput = (
  layer: TiledJsonTileLayer & { readonly text?: string },
): import("./tile-data.js").DecodeTileLayerDataInput => ({
  layerName: layer.name,
  width: layer.width,
  height: layer.height,
  ...(layer.encoding ? { encoding: layer.encoding } : {}),
  ...(layer.compression ? { compression: layer.compression } : {}),
  ...(layer.text ? { text: layer.text } : {}),
});

const inlineTilesetSource = (ref: TiledJsonMap["tilesets"][number]): TiledJsonTileset =>
  ref as TiledJsonTileset;

const resolveTilesets = async (
  map: TiledJsonMap,
  options: TiledImportOptions,
): Promise<{
  readonly compiled: ReturnType<typeof compileTiledTileset>[];
  readonly diagnostics: ParseDiagnostic[];
}> => {
  const compiled: ReturnType<typeof compileTiledTileset>[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  for (const ref of map.tilesets) {
    const tilesetSeed = ref.source ? tilesetIdFromSource(ref.source) : ref.name ?? `firstgid-${ref.firstgid}`;
    if (ref.source) {
      if (!options.reader) {
        diagnostics.push({
          _tag: "TiledParseError",
          path: ref.source,
          message: "External tileset reference requires an injected reader",
          severity: "error",
          format: "tmj",
        });
        continue;
      }
      if (!isSupportedTilesetSource(ref.source)) {
        diagnostics.push({
          _tag: "TiledParseError",
          path: ref.source,
          message: "External tileset source must be .json, .tsj, or .tsx",
          severity: "error",
          format: "tmj",
        });
        continue;
      }

      const resolved = await resolveExternalPath({
        projectRoot: options.projectRoot,
        basePath: options.sourcePath,
        source: ref.source,
        ...(options.reader.realpath ? { realpath: options.reader.realpath } : {}),
      });
      if (!resolved.ok) {
        diagnostics.push(resolved.diagnostic);
        continue;
      }

      const raw = await readExternalText(options.reader.readFile, resolved.absolutePath);
      const lower = ref.source.toLowerCase();
      const result = lower.endsWith(".tsx")
        ? parseTsx(raw, {
            packIdSeed: options.packIdSeed,
            tilesetSeed,
            projectRoot: options.projectRoot,
            basePath: resolved.absolutePath,
            profile: options.profile,
            validateImagePaths: options.validateImagePaths === true,
          })
        : parseTsj(raw, {
            packIdSeed: options.packIdSeed,
            tilesetSeed,
            projectRoot: options.projectRoot,
            basePath: resolved.absolutePath,
            profile: options.profile,
            validateImagePaths: options.validateImagePaths === true,
          });
      diagnostics.push(...result.diagnostics);
      if (result.value) compiled.push(result as ReturnType<typeof compileTiledTileset>);
      continue;
    }

    const normalized =
      options.validateImagePaths === true
        ? normalizeTiledTilesetImageAssetPaths(inlineTilesetSource(ref), {
            projectRoot: options.projectRoot,
            basePath: options.sourcePath,
          })
        : { tileset: inlineTilesetSource(ref), diagnostics: [] };
    diagnostics.push(...normalized.diagnostics);
    if (normalized.tileset === undefined) {
      continue;
    }

    const inline = compileTiledTileset({
      packSeed: options.packIdSeed,
      tilesetSeed,
      source: normalized.tileset,
      profile: options.profile,
    });
    diagnostics.push(...inline.diagnostics);
    if (inline.value) compiled.push(inline);
  }

  return { compiled, diagnostics };
};

const hydrateTileLayers = async (
  map: TiledJsonMap,
  syncOnly: boolean,
): Promise<{ readonly map: TiledJsonMap; readonly diagnostics: ParseDiagnostic[] }> => {
  const diagnostics: ParseDiagnostic[] = [];

  const hydrateLayer = async (layer: TiledJsonAnyLayer): Promise<TiledJsonAnyLayer> => {
    if (layer.type === "group") {
      return { ...layer, layers: await Promise.all(layer.layers.map(hydrateLayer)) };
    }
    if (layer.type !== "tilelayer") return layer;

    const tileLayer = layer as TiledJsonTileLayer & { readonly text?: string };
    if (tileLayer.data.length > 0) return tileLayer;

    const decoded = syncOnly
      ? decodeTileLayerDataSync(layerDecodeInput(tileLayer))
      : await decodeTileLayerDataAsync(layerDecodeInput(tileLayer));
    diagnostics.push(...decoded.diagnostics);
    return { ...tileLayer, data: decoded.data };
  };

  return {
    map: { ...map, layers: await Promise.all(map.layers.map(hydrateLayer)) },
    diagnostics,
  };
};

export const parseTmj = async (
  raw: string,
  options: TiledImportOptions,
): Promise<ParseResult<TiledImportSuccess> & { readonly diagnostics: readonly ParseDiagnostic[] }> => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      diagnostics: [
        {
          _tag: "TiledParseError",
          path: "/",
          message: `Failed to parse TMJ JSON: ${(error as Error).message}`,
          severity: "error",
          format: "tmj",
        },
      ],
    };
  }

  const validated = validateTiledJsonMap(json);
  if (!validated.ok) return { diagnostics: [validated.diagnostic] };

  let map = normalizeJsonTileLayers(validated.map);
  const hydrated = await hydrateTileLayers(map, false);
  map = hydrated.map;

  const tilesets = await resolveTilesets(map, options);
  const diagnostics = [...hydrated.diagnostics, ...tilesets.diagnostics];

  const tilesetValues = tilesets.compiled.flatMap((entry) => (entry.value ? [entry.value] : []));
  if (tilesetValues.length === 0) {
    return { diagnostics };
  }

  const pack = new TilesetPack({
    schemaVersion: 1,
    id: deterministicPackId(options.packIdSeed),
    name: options.packName ?? map.class ?? "Tiled Import",
    version: options.packVersion ?? map.version ?? "1.0.0",
    license: new TilesetPackLicense({
      spdxId: "UNKNOWN",
      attribution: Option.some("Imported from Tiled"),
      sourceUrl: Option.none(),
      notes: Option.some(options.sourcePath),
      redistributable: false,
    }),
    tilesets: tilesetValues.map((entry) => entry.tileset),
    assets: tilesetValues.flatMap((entry) => entry.assets),
    placeables: tilesetValues.flatMap((entry) => entry.placeables),
  });

  const windows = buildTilesetWindows(
    map.tilesets.map((ref, index) => ({
      firstgid: ref.firstgid,
      tilecount: ref.tilecount ?? tilesetValues[index]?.sourceTileCount ?? 0,
      tileborneTileCount: tilesetValues[index]?.tileset.tiles.length ?? 0,
      name: ref.name ?? tilesetValues[index]?.tileset.name ?? `tileset-${ref.firstgid}`,
    })),
  );
  const compiledMap = compileTiledMap({ map, windows, placeables: pack.placeables, profile: options.profile });
  if (hasBlockingDiagnostics(compiledMap.diagnostics)) {
    return { diagnostics: [...diagnostics, ...compiledMap.diagnostics] };
  }
  const coreMap = compileTileborneMap({
    map: compiledMap.map,
    sourcePath: options.sourcePath,
    packId: pack.id,
  });

  return {
    value: { pack, map: coreMap, tiledMap: compiledMap.map },
    diagnostics: [...diagnostics, ...compiledMap.diagnostics],
  };
};

export const parseTmjSync = (
  raw: string,
  options: TiledImportOptions,
): ParseResult<TiledImportSuccess> & { readonly diagnostics: readonly ParseDiagnostic[] } => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      diagnostics: [
        {
          _tag: "TiledParseError",
          path: "/",
          message: `Failed to parse TMJ JSON: ${(error as Error).message}`,
          severity: "error",
          format: "tmj",
        },
      ],
    };
  }

  const validated = validateTiledJsonMap(json);
  if (!validated.ok) return { diagnostics: [validated.diagnostic] };

  const diagnostics: ParseDiagnostic[] = [];
  let map = normalizeJsonTileLayers(validated.map);

  const syncLayers = map.layers.map((layer) => {
    if (layer.type !== "tilelayer" || layer.data.length > 0) return layer;
    const decoded = decodeTileLayerDataSync(
      layerDecodeInput(layer as TiledJsonTileLayer & { readonly text?: string }),
    );
    diagnostics.push(...decoded.diagnostics);
    return { ...layer, data: decoded.data };
  });
  map = { ...map, layers: syncLayers };

  const compiledTilesets = map.tilesets
    .filter((ref) => !ref.source)
    .flatMap((ref) => {
      const normalized =
        options.validateImagePaths === true
          ? normalizeTiledTilesetImageAssetPaths(inlineTilesetSource(ref), {
              projectRoot: options.projectRoot,
              basePath: options.sourcePath,
            })
          : { tileset: inlineTilesetSource(ref), diagnostics: [] };
      diagnostics.push(...normalized.diagnostics);
      if (normalized.tileset === undefined) {
        return [];
      }
      return [
        compileTiledTileset({
          packSeed: options.packIdSeed,
          tilesetSeed: ref.name ?? `firstgid-${ref.firstgid}`,
          source: normalized.tileset,
          profile: options.profile,
        }),
      ];
    });

  diagnostics.push(...compiledTilesets.flatMap((entry) => [...entry.diagnostics]));
  const tilesetValues = compiledTilesets.flatMap((entry) => (entry.value ? [entry.value] : []));
  if (tilesetValues.length === 0) {
    return { diagnostics };
  }

  const pack = new TilesetPack({
    schemaVersion: 1,
    id: deterministicPackId(options.packIdSeed),
    name: options.packName ?? "Tiled Import",
    version: options.packVersion ?? map.version ?? "1.0.0",
    license: new TilesetPackLicense({
      spdxId: "UNKNOWN",
      attribution: Option.some("Imported from Tiled"),
      sourceUrl: Option.none(),
      notes: Option.some(options.sourcePath),
      redistributable: false,
    }),
    tilesets: tilesetValues.map((entry) => entry.tileset),
    assets: tilesetValues.flatMap((entry) => entry.assets),
    placeables: tilesetValues.flatMap((entry) => entry.placeables),
  });

  const windows = buildTilesetWindows(
    map.tilesets.map((ref, index) => ({
      firstgid: ref.firstgid,
      tilecount: ref.tilecount ?? tilesetValues[index]?.sourceTileCount ?? 0,
      tileborneTileCount: tilesetValues[index]?.tileset.tiles.length ?? 0,
      name: ref.name ?? tilesetValues[index]?.tileset.name ?? `tileset-${ref.firstgid}`,
    })),
  );

  const compiledMap = compileTiledMap({ map, windows, placeables: pack.placeables, profile: options.profile });
  if (hasBlockingDiagnostics(compiledMap.diagnostics)) {
    return { diagnostics: [...diagnostics, ...compiledMap.diagnostics] };
  }
  const coreMap = compileTileborneMap({
    map: compiledMap.map,
    sourcePath: options.sourcePath,
    packId: pack.id,
  });
  return {
    value: { pack, map: coreMap, tiledMap: compiledMap.map },
    diagnostics: [...diagnostics, ...compiledMap.diagnostics],
  };
};

import { Option } from 'effect';

import type { ParseDiagnostic, ParseResult } from '../diagnostics.js';
import type { TilesetPackAsset as TilesetPackAssetType } from '../schemas/tileset-pack.js';
import {
  TilesetPack,
  TilesetPackAsset as TilesetPackAssetClass,
  TilesetPackLicense,
} from '../schemas/tileset-pack.js';

import { buildTilesetWindows, compileTiledMap, tiledImageLayerAssetId } from './compile-map.js';
import { compileTiledTileset } from './compile-tileset.js';
import { compileTileborneMap } from './core-map.js';
import { deterministicPackId } from './deterministic-ids.js';
import {
  isSupportedTilesetSource,
  readExternalText,
  resolveExternalPath,
  tilesetIdFromSource,
} from './external-resolve.js';
import { decodeTileLayerDataAsync, decodeTileLayerDataSync } from './tile-data.js';
import { validateTiledJsonMap } from './validate.js';
import { parseTsj } from './tsj-parse.js';
import { parseTsx } from './tsx-parse.js';
import {
  unsupportedClassPropertyFeaturesForMap,
  unsupportedFeatureDiagnostic,
} from './support-policy.js';
import { normalizeTiledTilesetImageAssetPaths } from './image-paths.js';
import {
  childNode,
  convertTiledXmlObjectGroup,
  convertTiledXmlMap,
  convertTiledXmlTileLayer,
  parseTiledXmlDocument,
  readTiledXmlLayerDataNode,
  toArray,
  xmlMapRoot,
} from './xml-common.js';
import type {
  TiledImportOptions,
  TiledImportSuccess,
  TiledJsonAnyLayer,
  TiledJsonMap,
  TiledJsonTileset,
} from './types.js';

const hasBlockingDiagnostics = (diagnostics: readonly ParseDiagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === 'error');

const imageLayerPackAssets = (
  layers: readonly TiledJsonAnyLayer[],
): readonly TilesetPackAssetType[] =>
  layers.flatMap((layer) => {
    if (layer.type === 'group') return imageLayerPackAssets(layer.layers);
    if (layer.type !== 'imagelayer') return [];
    return [
      new TilesetPackAssetClass({
        id: tiledImageLayerAssetId(layer.image),
        path: layer.image,
        mime: 'image/png',
      }),
    ];
  });

type TiledXmlNode = Record<string, unknown>;

const inlineTilesetSource = (ref: TiledJsonMap['tilesets'][number]): TiledJsonTileset =>
  ref as TiledJsonTileset;

const xmlLayerDecodeInput = (input: {
  readonly layerName: string;
  readonly width: number;
  readonly height: number;
  readonly encoding?: string;
  readonly compression?: string;
  readonly text?: string;
}): import('./tile-data.js').DecodeTileLayerDataInput => ({
  layerName: input.layerName,
  width: input.width,
  height: input.height,
  ...(input.encoding ? { encoding: input.encoding } : {}),
  ...(input.compression ? { compression: input.compression } : {}),
  ...(input.text ? { text: input.text } : {}),
});

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
    const tilesetSeed = ref.source
      ? tilesetIdFromSource(ref.source)
      : (ref.name ?? `firstgid-${ref.firstgid}`);
    if (ref.source) {
      if (!options.reader) {
        diagnostics.push({
          _tag: 'TiledParseError',
          path: ref.source,
          message: 'External tileset reference requires an injected reader',
          severity: 'error',
          format: 'tmx',
        });
        continue;
      }
      if (!isSupportedTilesetSource(ref.source)) {
        diagnostics.push({
          _tag: 'TiledParseError',
          path: ref.source,
          message: 'External tileset source must be .json, .tsj, or .tsx',
          severity: 'error',
          format: 'tmx',
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
      const result = lower.endsWith('.tsx')
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

const hydrateXmlLayers = async (
  root: TiledXmlNode,
  syncOnly: boolean,
): Promise<{
  readonly layers: readonly TiledJsonAnyLayer[];
  readonly diagnostics: ParseDiagnostic[];
}> => {
  const diagnostics: ParseDiagnostic[] = [];

  const hydrateNode = async (node: TiledXmlNode, kind: string): Promise<TiledJsonAnyLayer> => {
    if (kind === 'group') {
      const nested = await Promise.all(
        collectXmlLayerEntries(node).map((entry) =>
          hydrateNode(requiredNode(entry.value, entry.kind), entry.kind),
        ),
      );
      return {
        ...(optionalInteger(node.id) === undefined ? {} : { id: optionalInteger(node.id) }),
        name: requiredString(node.name, 'layer.name'),
        ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
        ...(optionalNumber(node.opacity) === undefined
          ? {}
          : { opacity: optionalNumber(node.opacity) }),
        ...(optionalBoolean(node.visible) === undefined
          ? {}
          : { visible: optionalBoolean(node.visible) }),
        type: 'group',
        layers: nested,
      } as TiledJsonAnyLayer;
    }

    if (kind === 'objectgroup') {
      return convertTiledXmlObjectGroup(node) as TiledJsonAnyLayer;
    }

    if (kind === 'imagelayer') {
      const image = childNode(node.image, 'image');
      return {
        type: 'imagelayer',
        ...(optionalInteger(node.id) === undefined ? {} : { id: optionalInteger(node.id) }),
        name: requiredString(node.name, 'layer.name'),
        ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
        ...(optionalNumber(node.opacity) === undefined
          ? {}
          : { opacity: optionalNumber(node.opacity) }),
        ...(optionalBoolean(node.visible) === undefined
          ? {}
          : { visible: optionalBoolean(node.visible) }),
        image: image ? requiredString(image.source, 'imagelayer.image.source') : '',
      } as TiledJsonAnyLayer;
    }

    const dataNode = readTiledXmlLayerDataNode(node);
    const decodeInput = xmlLayerDecodeInput({
      layerName: requiredString(node.name, 'layer.name'),
      width: requiredInteger(node.width, 'layer.width'),
      height: requiredInteger(node.height, 'layer.height'),
      ...(dataNode.encoding === undefined ? {} : { encoding: dataNode.encoding }),
      ...(dataNode.compression === undefined ? {} : { compression: dataNode.compression }),
      ...(dataNode.text === undefined ? {} : { text: dataNode.text }),
    });
    const decoded = syncOnly
      ? decodeTileLayerDataSync(decodeInput)
      : await decodeTileLayerDataAsync(decodeInput);
    diagnostics.push(...decoded.diagnostics);
    return convertTiledXmlTileLayer(node, decoded.data, dataNode.encoding, dataNode.compression);
  };

  const layers = await Promise.all(
    collectXmlLayerEntries(root).map((entry) =>
      hydrateNode(requiredNode(entry.value, entry.kind), entry.kind),
    ),
  );
  return { layers, diagnostics };
};

type XmlLayerEntry = { readonly kind: string; readonly value: unknown };

const collectXmlLayerEntries = (node: TiledXmlNode): readonly XmlLayerEntry[] => [
  ...toArray(node.layer).map((value) => ({ kind: 'layer', value })),
  ...toArray(node.objectgroup).map((value) => ({ kind: 'objectgroup', value })),
  ...toArray(node.imagelayer).map((value) => ({ kind: 'imagelayer', value })),
  ...toArray(node.group).map((value) => ({ kind: 'group', value })),
];

const requiredNode = (value: unknown, label: string): TiledXmlNode => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Tiled XML ${label} must be an object`);
  }
  return value as TiledXmlNode;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`Tiled XML ${label} must be a string`);
};

const optionalString = (value: unknown): string | undefined =>
  value === undefined ? undefined : requiredString(value, 'value');

const requiredInteger = (value: unknown, label: string): number => {
  const number = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isSafeInteger(number)) throw new Error(`Tiled XML ${label} must be an integer`);
  return number;
};

const optionalInteger = (value: unknown): number | undefined =>
  value === undefined ? undefined : requiredInteger(value, 'value');

const optionalNumber = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  const number = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(number)) throw new Error('Tiled XML value must be finite');
  return number;
};

const optionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
};

export const parseTmx = async (
  raw: string,
  options: TiledImportOptions,
): Promise<
  ParseResult<TiledImportSuccess> & { readonly diagnostics: readonly ParseDiagnostic[] }
> => {
  const parsed = parseTiledXmlDocument(raw);
  if (!parsed.ok) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: '/',
          message: parsed.error,
          severity: 'error',
          format: 'tmx',
        },
      ],
    };
  }

  const root = xmlMapRoot(parsed.value);
  if (!root) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: '/',
          message: 'Tiled XML map is missing <map> root',
          severity: 'error',
          format: 'tmx',
        },
      ],
    };
  }

  try {
    const baseMap = convertTiledXmlMap(root);
    const hydrated = await hydrateXmlLayers(root, false);
    const map: TiledJsonMap = { ...baseMap, layers: hydrated.layers };
    const validated = validateTiledJsonMap(map);
    if (!validated.ok) return { diagnostics: [validated.diagnostic] };

    const tilesets = await resolveTilesets(map, options);
    const diagnostics = [...hydrated.diagnostics, ...tilesets.diagnostics];
    diagnostics.push(
      ...unsupportedClassPropertyFeaturesForMap(map, map.tilesets).map(
        unsupportedFeatureDiagnostic,
      ),
    );
    if (hasBlockingDiagnostics(diagnostics)) {
      return { diagnostics };
    }
    const tilesetValues = tilesets.compiled.flatMap((entry) => (entry.value ? [entry.value] : []));
    if (tilesetValues.length === 0) {
      return { diagnostics };
    }

    const pack = new TilesetPack({
      schemaVersion: 1,
      id: deterministicPackId(options.packIdSeed),
      name: options.packName ?? map.class ?? 'Tiled Import',
      version: options.packVersion ?? map.version ?? '1.0.0',
      license: new TilesetPackLicense({
        spdxId: 'UNKNOWN',
        attribution: Option.some('Imported from Tiled'),
        sourceUrl: Option.none(),
        notes: Option.some(options.sourcePath),
        redistributable: false,
      }),
      tilesets: tilesetValues.map((entry) => entry.tileset),
      assets: [
        ...tilesetValues.flatMap((entry) => entry.assets),
        ...imageLayerPackAssets(map.layers),
      ],
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
    const compiledMap = compileTiledMap({
      map,
      windows,
      placeables: pack.placeables,
      profile: options.profile,
    });
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
  } catch (error) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: '/',
          message: (error as Error).message,
          severity: 'error',
          format: 'tmx',
        },
      ],
    };
  }
};

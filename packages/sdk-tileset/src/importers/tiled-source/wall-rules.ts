import { Schema } from 'effect';

import type { ParseDiagnostic } from '../../diagnostics.js';
import type { AutotileRule } from '../../schemas/autotile-rule.js';
import type { TileId } from '../../schemas/ids.js';
import { TerrainClass } from '../../schemas/terrain-class.js';
import { compileAutotileRule, type WangTileEntry } from '../../autotile/index.js';
import { deterministicAutotileRuleId } from '../../tiled/deterministic-ids.js';
import { decodeTileLayerDataSync } from '../../tiled/tile-data.js';
import {
  childNode,
  parseTiledXmlDocument,
  readTiledXmlLayerDataNode,
  toArray,
  xmlMapRoot,
} from '../../tiled/xml-common.js';

type TiledXmlNode = Record<string, unknown>;

export type TiledSourceWallRuleCompileInput = {
  readonly rulePath: string;
  readonly raw: string;
  readonly tileIdForSource: (sourcePath: string, localTileId: number) => TileId | undefined;
};

export type TiledSourceCompiledWallRule = {
  readonly tilesetSourcePath: string;
  readonly rule: AutotileRule;
};

const isRecord = (value: unknown): value is TiledXmlNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const readInteger = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const dirname = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '.' : normalized.slice(0, index);
};

const resolveRelative = (basePath: string, source: string): string => {
  if (source.startsWith(':')) {
    return source;
  }
  const segments: string[] = [];
  for (const segment of `${dirname(basePath)}/${source}`.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

const baseName = (path: string): string =>
  path
    .replaceAll('\\', '/')
    .split('/')
    .pop()
    ?.replace(/\.tmx$/i, '') ?? path;

const wallTerrainClass = (sourcePath: string): typeof TerrainClass.Type =>
  Schema.decodeUnknownSync(TerrainClass)(
    `tiled-source:${baseName(sourcePath).replace(/[^A-Za-z0-9:_-]+/g, '-')}`,
  );

const unmapped = (rulePath: string, reason: string, message = reason): ParseDiagnostic => ({
  _tag: 'TiledSourceWallRuleUnmapped',
  path: rulePath,
  message,
  severity: 'warning',
  rulePath,
  reason,
});

type RuleTilesetRef = {
  readonly sourcePath?: string;
  readonly firstgid: number;
};

const readTilesetRefs = (rulePath: string, root: TiledXmlNode): readonly RuleTilesetRef[] => {
  const refs: RuleTilesetRef[] = [];
  for (const value of toArray(root.tileset)) {
    if (!isRecord(value)) {
      continue;
    }
    const rawSource = readString(value.source);
    const firstgid = readInteger(value.firstgid);
    if (firstgid === undefined) {
      continue;
    }
    refs.push({
      ...(rawSource === undefined || rawSource.startsWith(':')
        ? {}
        : { sourcePath: resolveRelative(rulePath, rawSource) }),
      firstgid,
    });
  }
  return refs.sort((left, right) => left.firstgid - right.firstgid);
};

const locateTilesetRef = (
  refs: readonly RuleTilesetRef[],
  gid: number,
): RuleTilesetRef | undefined => {
  let located: RuleTilesetRef | undefined;
  for (const ref of refs) {
    if (gid < ref.firstgid) {
      break;
    }
    located = ref;
  }
  return located;
};

const readLayer = (
  layer: TiledXmlNode,
):
  | {
      readonly name: string;
      readonly width: number;
      readonly height: number;
      readonly data: readonly number[];
      readonly diagnostics: readonly ParseDiagnostic[];
    }
  | undefined => {
  const name = readString(layer.name);
  const width = readInteger(layer.width);
  const height = readInteger(layer.height);
  if (
    name === undefined ||
    width === undefined ||
    height === undefined ||
    layer.data === undefined
  ) {
    return undefined;
  }

  const dataNode = readTiledXmlLayerDataNode(layer);
  const decoded = decodeTileLayerDataSync({
    layerName: name,
    width,
    height,
    ...(dataNode.encoding === undefined ? {} : { encoding: dataNode.encoding }),
    ...(dataNode.compression === undefined ? {} : { compression: dataNode.compression }),
    ...(dataNode.text === undefined ? {} : { text: dataNode.text }),
  });

  return { name, width, height, data: decoded.data, diagnostics: decoded.diagnostics };
};

const wangIdFromAround8Mask = (mask: number): readonly number[] =>
  Array.from({ length: 8 }, (_unused, index) => ((mask & (1 << index)) === 0 ? 0 : 1));

const around8MaskAt = (
  data: readonly number[],
  width: number,
  height: number,
  x: number,
  y: number,
): number => {
  const offsets = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ] as const;
  let mask = 0;
  for (const [bit, [dx, dy]] of offsets.entries()) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      continue;
    }
    if ((data[ny * width + nx] ?? 0) !== 0) {
      mask |= 1 << bit;
    }
  }
  return mask;
};

export const compileTiledSourceWallRulePhase = (
  input: TiledSourceWallRuleCompileInput,
): {
  readonly value?: TiledSourceCompiledWallRule;
  readonly diagnostics: readonly ParseDiagnostic[];
} => {
  const parsed = parseTiledXmlDocument(input.raw);
  if (!parsed.ok) {
    return { diagnostics: [unmapped(input.rulePath, 'parse-error', parsed.error)] };
  }
  const root = xmlMapRoot(parsed.value);
  if (!root) {
    return {
      diagnostics: [
        unmapped(input.rulePath, 'missing-map-root', 'Wall rule TMX is missing a map root'),
      ],
    };
  }

  try {
    const tilesetRefs = readTilesetRefs(input.rulePath, root);
    const primaryTilesetRef = tilesetRefs.find((ref) => ref.sourcePath !== undefined);
    const primarySourcePath = primaryTilesetRef?.sourcePath;
    if (primarySourcePath === undefined) {
      return { diagnostics: [unmapped(input.rulePath, 'missing-tileset-ref')] };
    }

    const layers = toArray(root.layer).flatMap((value) => {
      const node = childNode(value, 'layer');
      return node === undefined
        ? []
        : [readLayer(node)].flatMap((layer) => (layer === undefined ? [] : [layer]));
    });
    const inputLayer = layers.find((layer) => /input/i.test(layer.name));
    const outputLayer = layers.find((layer) => /output/i.test(layer.name));
    const diagnostics = layers.flatMap((layer) => layer.diagnostics);
    if (inputLayer === undefined || outputLayer === undefined) {
      return {
        diagnostics: [...diagnostics, unmapped(input.rulePath, 'missing-input-or-output-layer')],
      };
    }
    if (inputLayer.width !== outputLayer.width || inputLayer.height !== outputLayer.height) {
      return { diagnostics: [...diagnostics, unmapped(input.rulePath, 'layer-size-mismatch')] };
    }

    const entries: WangTileEntry[] = [];
    for (let index = 0; index < outputLayer.data.length; index += 1) {
      const gid = outputLayer.data[index] ?? 0;
      if (gid === 0) {
        continue;
      }
      const tilesetRef = locateTilesetRef(tilesetRefs, gid);
      if (tilesetRef?.sourcePath === undefined) {
        continue;
      }
      const localTileId = gid - tilesetRef.firstgid;
      const tileId = input.tileIdForSource(tilesetRef.sourcePath, localTileId);
      if (tileId === undefined) {
        diagnostics.push(
          unmapped(input.rulePath, 'missing-output-tile', `No tile found for wall rule gid ${gid}`),
        );
        continue;
      }
      const x = index % outputLayer.width;
      const y = Math.floor(index / outputLayer.width);
      entries.push({
        tileId,
        sourceTileIndex: localTileId,
        wangid: wangIdFromAround8Mask(
          around8MaskAt(inputLayer.data, inputLayer.width, inputLayer.height, x, y),
        ),
      });
    }

    if (entries.length === 0) {
      return { diagnostics: [...diagnostics, unmapped(input.rulePath, 'no-output-tiles')] };
    }

    const compiled = compileAutotileRule({
      id: deterministicAutotileRuleId(`tiled-source/${input.rulePath}`),
      name: baseName(input.rulePath),
      terrainClasses: [wallTerrainClass(primarySourcePath)],
      source: {
        kind: 'tiledWang',
        pattern: 'wang4corner',
        entries,
        wangSetName: baseName(input.rulePath),
      },
      path: input.rulePath,
      debug: {
        provider: 'tiled-source',
        rulePath: input.rulePath,
        tilesetSourcePath: primarySourcePath,
      },
    });

    if (compiled.rule === undefined) {
      return { diagnostics: [...diagnostics, ...compiled.diagnostics] };
    }

    return {
      value: { tilesetSourcePath: primarySourcePath, rule: compiled.rule },
      diagnostics: [...diagnostics, ...compiled.diagnostics],
    };
  } catch (error) {
    return {
      diagnostics: [
        unmapped(
          input.rulePath,
          'compile-error',
          `Failed to compile wall rule: ${(error as Error).message}`,
        ),
      ],
    };
  }
};

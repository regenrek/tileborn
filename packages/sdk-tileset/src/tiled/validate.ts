import { Result, Schema, SchemaIssue } from 'effect';

import type { ParseDiagnostic } from '../diagnostics.js';
import type { TiledJsonMap, TiledJsonTileset } from './types.js';

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const TiledJsonPropertyType = Schema.Literals([
  'string',
  'int',
  'float',
  'bool',
  'color',
  'file',
  'object',
  'class',
] as const);

const TiledJsonPropertySchema = Schema.Struct({
  name: Schema.String,
  type: TiledJsonPropertyType,
  value: Schema.Unknown,
  propertytype: Schema.optionalKey(Schema.String),
});

const TiledJsonPointSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const TiledJsonObjectSchema = Schema.Struct({
  id: Schema.Int,
  x: Schema.Number,
  y: Schema.Number,
  gid: Schema.optionalKey(Schema.Int),
  width: Schema.optionalKey(Schema.Number),
  height: Schema.optionalKey(Schema.Number),
  type: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
  ellipse: Schema.optionalKey(Schema.Boolean),
  point: Schema.optionalKey(Schema.Boolean),
  polygon: Schema.optionalKey(Schema.Array(TiledJsonPointSchema)),
  polyline: Schema.optionalKey(Schema.Array(TiledJsonPointSchema)),
  properties: Schema.optionalKey(Schema.Array(TiledJsonPropertySchema)),
  rotation: Schema.optionalKey(Schema.Number),
  template: Schema.optionalKey(Schema.String),
});

const TiledJsonObjectGroupSchema = Schema.Struct({
  type: Schema.Literal('objectgroup'),
  id: Schema.optionalKey(Schema.Int),
  name: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
  draworder: Schema.optionalKey(Schema.Literals(['topdown', 'index'] as const)),
  objects: Schema.Array(TiledJsonObjectSchema),
});

const TiledJsonFrameSchema = Schema.Struct({
  tileid: Schema.Int,
  duration: Schema.Int,
});

const TiledJsonTileSchema = Schema.Struct({
  id: Schema.Int,
  type: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
  image: Schema.optionalKey(Schema.String),
  imagewidth: Schema.optionalKey(Schema.Int),
  imageheight: Schema.optionalKey(Schema.Int),
  probability: Schema.optionalKey(Schema.Number),
  animation: Schema.optionalKey(Schema.Array(TiledJsonFrameSchema)),
  objectgroup: Schema.optionalKey(TiledJsonObjectGroupSchema),
  properties: Schema.optionalKey(Schema.Array(TiledJsonPropertySchema)),
});

const TiledJsonWangColorSchema = Schema.Struct({
  name: Schema.String,
  color: Schema.String,
  tile: Schema.Int,
  probability: Schema.optionalKey(Schema.Number),
  class: Schema.optionalKey(Schema.String),
});

const TiledJsonWangTileSchema = Schema.Struct({
  tileid: Schema.Int,
  wangid: Schema.Array(Schema.Int),
});

const TiledJsonWangSetSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.optionalKey(Schema.Literals(['corner', 'edge', 'mixed'] as const)),
  class: Schema.optionalKey(Schema.String),
  tile: Schema.optionalKey(Schema.Int),
  colors: Schema.Array(TiledJsonWangColorSchema),
  wangtiles: Schema.Array(TiledJsonWangTileSchema),
});

const TiledJsonTilesetSchema = Schema.Struct({
  type: Schema.optionalKey(Schema.Literal('tileset')),
  name: Schema.String,
  tilewidth: Schema.Int,
  tileheight: Schema.Int,
  tilecount: Schema.Int,
  columns: Schema.Int,
  margin: Schema.optionalKey(Schema.Int),
  spacing: Schema.optionalKey(Schema.Int),
  image: Schema.optionalKey(Schema.String),
  imagewidth: Schema.optionalKey(Schema.Int),
  imageheight: Schema.optionalKey(Schema.Int),
  tiles: Schema.optionalKey(Schema.Array(TiledJsonTileSchema)),
  wangsets: Schema.optionalKey(Schema.Array(TiledJsonWangSetSchema)),
  properties: Schema.optionalKey(Schema.Array(TiledJsonPropertySchema)),
  version: Schema.optionalKey(Schema.String),
  tiledversion: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
});

const TiledJsonTilesetRefSchema = Schema.Struct({
  firstgid: Schema.Int,
  source: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.Literal('tileset')),
  name: Schema.optionalKey(Schema.String),
  tilewidth: Schema.optionalKey(Schema.Int),
  tileheight: Schema.optionalKey(Schema.Int),
  tilecount: Schema.optionalKey(Schema.Int),
  columns: Schema.optionalKey(Schema.Int),
  margin: Schema.optionalKey(Schema.Int),
  spacing: Schema.optionalKey(Schema.Int),
  image: Schema.optionalKey(Schema.String),
  imagewidth: Schema.optionalKey(Schema.Int),
  imageheight: Schema.optionalKey(Schema.Int),
  tiles: Schema.optionalKey(Schema.Array(TiledJsonTileSchema)),
  wangsets: Schema.optionalKey(Schema.Array(TiledJsonWangSetSchema)),
  properties: Schema.optionalKey(Schema.Array(TiledJsonPropertySchema)),
  version: Schema.optionalKey(Schema.String),
  tiledversion: Schema.optionalKey(Schema.String),
  class: Schema.optionalKey(Schema.String),
});

const TiledJsonLayerBaseFields = {
  id: Schema.optionalKey(Schema.Int),
  name: Schema.String,
  class: Schema.optionalKey(Schema.String),
  opacity: Schema.optionalKey(Schema.Number),
  visible: Schema.optionalKey(Schema.Boolean),
  properties: Schema.optionalKey(Schema.Array(TiledJsonPropertySchema)),
  offsetx: Schema.optionalKey(Schema.Number),
  offsety: Schema.optionalKey(Schema.Number),
  parallaxx: Schema.optionalKey(Schema.Number),
  parallaxy: Schema.optionalKey(Schema.Number),
} as const;

const TiledJsonChunkSchema = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  data: Schema.Array(Schema.Int),
});

const TiledJsonTileLayerSchema = Schema.Struct({
  ...TiledJsonLayerBaseFields,
  type: Schema.Literal('tilelayer'),
  width: Schema.Int,
  height: Schema.Int,
  data: Schema.Array(Schema.Int),
  encoding: Schema.optionalKey(Schema.Literals(['csv', 'base64'] as const)),
  compression: Schema.optionalKey(Schema.String),
  chunks: Schema.optionalKey(Schema.Array(TiledJsonChunkSchema)),
});

const TiledJsonObjectGroupLayerSchema = Schema.Struct({
  ...TiledJsonLayerBaseFields,
  type: Schema.Literal('objectgroup'),
  draworder: Schema.optionalKey(Schema.Literals(['topdown', 'index'] as const)),
  objects: Schema.Array(TiledJsonObjectSchema),
});

const TiledJsonImageLayerSchema = Schema.Struct({
  ...TiledJsonLayerBaseFields,
  type: Schema.Literal('imagelayer'),
  image: Schema.String,
  x: Schema.optionalKey(Schema.Number),
  y: Schema.optionalKey(Schema.Number),
});

const TiledJsonGroupLayerSchema = Schema.Struct({
  ...TiledJsonLayerBaseFields,
  type: Schema.Literal('group'),
  layers: Schema.Array(Schema.Unknown),
});

const TiledJsonLayerTypeSchema = Schema.Struct({
  type: Schema.Literals(['tilelayer', 'objectgroup', 'imagelayer', 'group'] as const),
});

const TiledJsonMapSchema = Schema.Struct({
  type: Schema.Literal('map'),
  version: Schema.String,
  tiledversion: Schema.optionalKey(Schema.String),
  orientation: Schema.Literals(['orthogonal', 'isometric', 'staggered', 'hexagonal'] as const),
  width: Schema.Int,
  height: Schema.Int,
  tilewidth: Schema.Int,
  tileheight: Schema.Int,
  infinite: Schema.optionalKey(Schema.Boolean),
  tilesets: Schema.Array(TiledJsonTilesetRefSchema),
  layers: Schema.Array(Schema.Unknown),
  properties: Schema.optionalKey(Schema.Array(TiledJsonPropertySchema)),
  class: Schema.optionalKey(Schema.String),
});

type ParseFormat = 'tmj' | 'tmx' | 'tsj' | 'tsx';
type PathSegment = string | number;

const formatIssuePath = (segments: readonly PathSegment[]): string =>
  segments.length === 0 ? '/' : `/${segments.map(String).join('/')}`;

const issueMessage = (issue: SchemaIssue.Issue): string => {
  switch (issue._tag) {
    case 'MissingKey':
      return 'Missing required field';
    case 'UnexpectedKey':
      return 'Unexpected field';
    case 'InvalidType':
      return 'Invalid type';
    case 'InvalidValue':
      return 'Invalid value';
    default:
      return SchemaIssue.makeFormatterDefault()(issue).trim();
  }
};

const flattenSchemaIssues = (
  issue: SchemaIssue.Issue,
  path: readonly PathSegment[] = [],
): ReadonlyArray<{ readonly path: string; readonly message: string }> => {
  switch (issue._tag) {
    case 'Composite':
      return issue.issues.flatMap((child) => flattenSchemaIssues(child, path));
    case 'Pointer':
      return flattenSchemaIssues(issue.issue, [
        ...path,
        ...issue.path.filter((segment): segment is PathSegment => typeof segment !== 'symbol'),
      ]);
    case 'MissingKey':
    case 'UnexpectedKey':
      return [{ path: formatIssuePath(path), message: issueMessage(issue) }];
    default:
      return [{ path: formatIssuePath(path), message: issueMessage(issue) }];
  }
};

const schemaError = (
  format: ParseFormat,
  issue: SchemaIssue.Issue,
  pathPrefix: readonly PathSegment[] = [],
): { readonly ok: false; readonly diagnostic: ParseDiagnostic } => {
  const issueSummary = flattenSchemaIssues(issue, pathPrefix)[0] ?? {
    path: formatIssuePath(pathPrefix),
    message: 'Invalid Tiled JSON shape',
  };
  return parseError(
    format,
    `Tiled ${format.toUpperCase()} schema error: ${issueSummary.message}`,
    issueSummary.path,
  );
};

const decodeSchema = <A, I>(
  schema: Schema.Codec<A, I, never, never>,
  value: unknown,
  format: ParseFormat,
  pathPrefix: readonly PathSegment[] = [],
):
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic } => {
  const decoded = Schema.decodeUnknownResult(schema)(value);
  if (Result.isFailure(decoded)) {
    return schemaError(format, decoded.failure, pathPrefix);
  }
  return { ok: true, value: decoded.success };
};

const decodeLayer = (
  value: unknown,
  format: 'tmj' | 'tmx',
  pathPrefix: readonly PathSegment[],
):
  | { readonly ok: true; readonly layer: TiledJsonMap['layers'][number] }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic } => {
  const layerType = decodeSchema(TiledJsonLayerTypeSchema, value, format, pathPrefix);
  if (!layerType.ok) return layerType;

  switch (layerType.value.type) {
    case 'tilelayer': {
      const decoded = decodeSchema(TiledJsonTileLayerSchema, value, format, pathPrefix);
      return decoded.ok
        ? { ok: true, layer: decoded.value as unknown as TiledJsonMap['layers'][number] }
        : decoded;
    }
    case 'objectgroup': {
      const decoded = decodeSchema(TiledJsonObjectGroupLayerSchema, value, format, pathPrefix);
      return decoded.ok
        ? { ok: true, layer: decoded.value as unknown as TiledJsonMap['layers'][number] }
        : decoded;
    }
    case 'imagelayer': {
      const decoded = decodeSchema(TiledJsonImageLayerSchema, value, format, pathPrefix);
      return decoded.ok
        ? { ok: true, layer: decoded.value as unknown as TiledJsonMap['layers'][number] }
        : decoded;
    }
    case 'group': {
      const decoded = decodeSchema(TiledJsonGroupLayerSchema, value, format, pathPrefix);
      if (!decoded.ok) return decoded;

      const layers: TiledJsonMap['layers'][number][] = [];
      for (const [index, child] of decoded.value.layers.entries()) {
        const childLayer = decodeLayer(child, format, [...pathPrefix, 'layers', index]);
        if (!childLayer.ok) return childLayer;
        layers.push(childLayer.layer);
      }
      return {
        ok: true,
        layer: { ...decoded.value, layers } as unknown as TiledJsonMap['layers'][number],
      };
    }
  }
};

const decodeLayers = (
  layers: readonly unknown[],
  format: 'tmj' | 'tmx',
):
  | { readonly ok: true; readonly layers: TiledJsonMap['layers'] }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic } => {
  const decoded: TiledJsonMap['layers'][number][] = [];
  for (const [index, layer] of layers.entries()) {
    const result = decodeLayer(layer, format, ['layers', index]);
    if (!result.ok) return result;
    decoded.push(result.layer);
  }
  return { ok: true, layers: decoded };
};

export const validateTiledJsonTileset = (
  value: unknown,
):
  | { readonly ok: true; readonly tileset: TiledJsonTileset }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic } => {
  const decoded = decodeSchema(TiledJsonTilesetSchema, value, 'tsj');
  if (!decoded.ok) return decoded;

  if (!isNonNegativeInteger(decoded.value.tilecount))
    return parseError('tsj', 'Tiled tileset is missing tilecount');
  if (!isNonNegativeInteger(decoded.value.columns))
    return parseError('tsj', 'Tiled tileset is missing columns');
  const isImageCollection = decoded.value.columns === 0;
  const dimensionGuard = isImageCollection ? isNonNegativeInteger : isPositiveInteger;
  if (!dimensionGuard(decoded.value.tilewidth))
    return parseError('tsj', 'Tiled tileset is missing tilewidth');
  if (!dimensionGuard(decoded.value.tileheight))
    return parseError('tsj', 'Tiled tileset is missing tileheight');
  return { ok: true, tileset: decoded.value as unknown as TiledJsonTileset };
};

export const validateTiledJsonMap = (
  value: unknown,
):
  | { readonly ok: true; readonly map: TiledJsonMap }
  | { readonly ok: false; readonly diagnostic: ParseDiagnostic } => {
  const decoded = decodeSchema(TiledJsonMapSchema, value, 'tmj');
  if (!decoded.ok) return decoded;

  if (!isPositiveInteger(decoded.value.width) || !isPositiveInteger(decoded.value.height)) {
    return parseError('tmj', 'Tiled map is missing width/height');
  }
  if (!isPositiveInteger(decoded.value.tilewidth) || !isPositiveInteger(decoded.value.tileheight)) {
    return parseError('tmj', 'Tiled map is missing tile dimensions');
  }
  for (const [index, tileset] of decoded.value.tilesets.entries()) {
    if (!isPositiveInteger(tileset.firstgid)) {
      return parseError(
        'tmj',
        'Tiled map tileset is missing firstgid',
        `/tilesets/${index}/firstgid`,
      );
    }
  }

  const layers = decodeLayers(decoded.value.layers, 'tmj');
  if (!layers.ok) return layers;

  return { ok: true, map: { ...decoded.value, layers: layers.layers } as unknown as TiledJsonMap };
};

export const normalizeJsonTileLayers = (map: TiledJsonMap): TiledJsonMap => map;

const parseError = (
  format: ParseFormat,
  message: string,
  path = '/',
): { readonly ok: false; readonly diagnostic: ParseDiagnostic } => ({
  ok: false,
  diagnostic: {
    _tag: 'TiledParseError',
    path,
    message,
    severity: 'error',
    format,
  },
});

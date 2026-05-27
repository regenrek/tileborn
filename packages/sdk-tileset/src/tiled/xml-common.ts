import { XMLParser } from "fast-xml-parser";

import type {
  TiledJsonFrame,
  TiledJsonMap,
  TiledJsonObject,
  TiledJsonObjectGroup,
  TiledJsonProperty,
  TiledJsonTile,
  TiledJsonTileLayer,
  TiledJsonTileset,
  TiledJsonTilesetRef,
  TiledJsonWangColor,
  TiledJsonWangSet,
  TiledJsonWangTile,
} from "./types.js";

type TiledXmlNode = Record<string, unknown>;

const TEXT_NODE = "#text";
const XML_ORDER_ATTRIBUTE = "__tileborneOrder";
const ORDERED_LAYER_TAGS = new Set(["group", "imagelayer", "layer", "objectgroup"]);
const XML_ENTITY_DECLARATION_PATTERN = /<!\s*(DOCTYPE|ENTITY)\b/i;

export type TiledXmlParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const createXmlParser = (): XMLParser => {
  let order = 0;
  return new XMLParser({
    allowBooleanAttributes: true,
    attributeNamePrefix: "",
    ignoreAttributes: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    numberParseOptions: { hex: true, leadingZeros: false, eNotation: false },
    parseAttributeValue: true,
    parseTagValue: false,
    processEntities: false,
    removeNSPrefix: true,
    textNodeName: TEXT_NODE,
    trimValues: true,
    updateTag: (tagName, _path, attrs) => {
      if (ORDERED_LAYER_TAGS.has(tagName)) {
        attrs[XML_ORDER_ATTRIBUTE] = String(order);
        order += 1;
      }
      return tagName;
    },
  });
};

export const parseTiledXmlDocument = (xml: string): TiledXmlParseResult<unknown> => {
  if (XML_ENTITY_DECLARATION_PATTERN.test(xml)) {
    return { ok: false, error: "Tiled XML with DOCTYPE or ENTITY declarations is not supported" };
  }
  try {
    return { ok: true, value: createXmlParser().parse(xml) };
  } catch (error) {
    return { ok: false, error: `Failed to parse Tiled XML: ${(error as Error).message}` };
  }
};

export const convertTiledXmlTileset = (root: TiledXmlNode): TiledJsonTileset => {
  const image = childNode(root.image, "image");
  return {
    type: "tileset",
    ...(optionalString(root.version) === undefined ? {} : { version: optionalString(root.version) }),
    ...(optionalString(root.tiledversion) === undefined ? {} : { tiledversion: optionalString(root.tiledversion) }),
    name: requiredString(root.name, "tileset.name"),
    tilewidth: requiredInteger(root.tilewidth, "tileset.tilewidth"),
    tileheight: requiredInteger(root.tileheight, "tileset.tileheight"),
    tilecount: requiredInteger(root.tilecount, "tileset.tilecount"),
    columns: requiredInteger(root.columns, "tileset.columns"),
    ...(optionalInteger(root.margin) === undefined ? {} : { margin: optionalInteger(root.margin) }),
    ...(optionalInteger(root.spacing) === undefined ? {} : { spacing: optionalInteger(root.spacing) }),
    ...(image ? { image: requiredString(image.source, "tileset.image.source") } : {}),
    ...(image && optionalInteger(image.width) !== undefined ? { imagewidth: optionalInteger(image.width) } : {}),
    ...(image && optionalInteger(image.height) !== undefined ? { imageheight: optionalInteger(image.height) } : {}),
    tiles: toArray(root.tile).map(convertTile),
    wangsets: toArray(childNode(root.wangsets, "wangsets")?.wangset).map(convertWangSet),
    ...(convertProperties(childNode(root.properties, "properties") ?? root.properties) === undefined
      ? {}
      : { properties: convertProperties(childNode(root.properties, "properties") ?? root.properties) }),
    ...(optionalString(root.class) === undefined ? {} : { class: optionalString(root.class) }),
  } as TiledJsonTileset;
};

export const convertTiledXmlMap = (root: TiledXmlNode): TiledJsonMap => ({
  type: "map",
  version: requiredString(root.version, "map.version"),
  ...(optionalString(root.tiledversion) === undefined ? {} : { tiledversion: optionalString(root.tiledversion) }),
  orientation: requiredString(root.orientation, "map.orientation") as TiledJsonMap["orientation"],
  width: requiredInteger(root.width, "map.width"),
  height: requiredInteger(root.height, "map.height"),
  tilewidth: requiredInteger(root.tilewidth, "map.tilewidth"),
  tileheight: requiredInteger(root.tileheight, "map.tileheight"),
  ...(optionalTiledBoolean(root.infinite) === undefined ? {} : { infinite: optionalTiledBoolean(root.infinite) }),
  tilesets: toArray(root.tileset).map(convertTilesetRef),
  layers: [],
  ...(convertProperties(childNode(root.properties, "properties") ?? root.properties) === undefined
    ? {}
    : { properties: convertProperties(childNode(root.properties, "properties") ?? root.properties) }),
  ...(optionalString(root.class) === undefined ? {} : { class: optionalString(root.class) }),
} as TiledJsonMap);

export const convertTiledXmlTileLayer = (
  node: TiledXmlNode,
  data: readonly number[],
  encoding?: string,
  compression?: string,
): TiledJsonTileLayer =>
  ({
    ...layerBase(node),
    type: "tilelayer",
    width: requiredInteger(node.width, "layer.width"),
    height: requiredInteger(node.height, "layer.height"),
    data,
    ...(encoding === "csv" ? { encoding: "csv" as const } : encoding === "base64" ? { encoding: "base64" as const } : {}),
    ...(compression === undefined ? {} : { compression }),
  }) as TiledJsonTileLayer;

const layerBase = (node: TiledXmlNode) => ({
  name: requiredString(node.name, "layer.name"),
  ...(optionalInteger(node.id) === undefined ? {} : { id: optionalInteger(node.id) }),
  ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
  ...(optionalNumber(node.opacity) === undefined ? {} : { opacity: optionalNumber(node.opacity) }),
  ...(optionalTiledBoolean(node.visible) === undefined ? {} : { visible: optionalTiledBoolean(node.visible) }),
  ...(convertProperties(childNode(node.properties, "properties") ?? node.properties) === undefined
    ? {}
    : { properties: convertProperties(childNode(node.properties, "properties") ?? node.properties) }),
});

const convertTilesetRef = (value: unknown): TiledJsonTilesetRef => {
  const node = requiredNode(value, "map.tileset");
  const firstgid = requiredInteger(node.firstgid, "tileset.firstgid");
  if (node.source !== undefined) {
    return { firstgid, source: requiredString(node.source, "tileset.source") };
  }
  return { firstgid, ...convertTiledXmlTileset(node) };
};

const convertTile = (value: unknown): TiledJsonTile => {
  const node = requiredNode(value, "tileset.tile");
  const image = childNode(node.image, "image");
  const tileType = optionalString(node.type) ?? optionalString(node.class);
  return {
    id: requiredInteger(node.id, "tile.id"),
    ...(tileType === undefined ? {} : { type: tileType }),
    ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
    ...(image ? { image: requiredString(image.source, "tile.image.source") } : {}),
    ...(image && optionalInteger(image.width) !== undefined ? { imagewidth: optionalInteger(image.width) } : {}),
    ...(image && optionalInteger(image.height) !== undefined ? { imageheight: optionalInteger(image.height) } : {}),
    ...(optionalNumber(node.probability) === undefined ? {} : { probability: optionalNumber(node.probability) }),
    ...(toArray(childNode(node.animation, "animation")?.frame).length > 0
      ? { animation: toArray(childNode(node.animation, "animation")?.frame).map(convertFrame) }
      : {}),
    ...(node.objectgroup === undefined ? {} : { objectgroup: convertTiledXmlObjectGroup(node.objectgroup) }),
    ...(convertProperties(childNode(node.properties, "properties") ?? node.properties) === undefined
      ? {}
      : { properties: convertProperties(childNode(node.properties, "properties") ?? node.properties) }),
  } as TiledJsonTile;
};

const convertFrame = (value: unknown): TiledJsonFrame => {
  const node = requiredNode(value, "tile.animation.frame");
  return {
    tileid: requiredInteger(node.tileid, "frame.tileid"),
    duration: requiredInteger(node.duration, "frame.duration"),
  };
};

export const convertTiledXmlObjectGroup = (value: unknown): TiledJsonObjectGroup => {
  const node = requiredNode(value, "objectgroup");
  const draworder = optionalString(node.draworder) as TiledJsonObjectGroup["draworder"];
  return {
    type: "objectgroup",
    objects: toArray(node.object).map(convertObject),
    ...(optionalInteger(node.id) === undefined ? {} : { id: optionalInteger(node.id) }),
    ...(optionalString(node.name) === undefined ? {} : { name: optionalString(node.name) }),
    ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
    ...(draworder === undefined ? {} : { draworder }),
  } as TiledJsonObjectGroup;
};

const convertObject = (value: unknown): TiledJsonObject => {
  const node = requiredNode(value, "object");
  const polygon = childNode(node.polygon, "polygon");
  const polyline = childNode(node.polyline, "polyline");
  const objectType = optionalString(node.type) ?? optionalString(node.class);
  return {
    id: requiredInteger(node.id, "object.id"),
    x: optionalNumber(node.x) ?? 0,
    y: optionalNumber(node.y) ?? 0,
    ...(optionalString(node.name) === undefined ? {} : { name: optionalString(node.name) }),
    ...(objectType === undefined ? {} : { type: objectType }),
    ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
    ...(optionalInteger(node.gid) === undefined ? {} : { gid: optionalInteger(node.gid) }),
    ...(optionalNumber(node.width) === undefined ? {} : { width: optionalNumber(node.width) }),
    ...(optionalNumber(node.height) === undefined ? {} : { height: optionalNumber(node.height) }),
    ...(node.ellipse === undefined ? {} : { ellipse: true as const }),
    ...(node.point === undefined ? {} : { point: true as const }),
    ...(polygon ? { polygon: parsePoints(requiredString(polygon.points, "polygon.points")) } : {}),
    ...(polyline ? { polyline: parsePoints(requiredString(polyline.points, "polyline.points")) } : {}),
    ...(convertProperties(childNode(node.properties, "properties") ?? node.properties) === undefined
      ? {}
      : { properties: convertProperties(childNode(node.properties, "properties") ?? node.properties) }),
  } as TiledJsonObject;
};

const convertWangSet = (value: unknown): TiledJsonWangSet => {
  const node = requiredNode(value, "wangset");
  const wangType = optionalString(node.type) as TiledJsonWangSet["type"];
  return {
    name: requiredString(node.name, "wangset.name"),
    colors: toArray(node.wangcolor).map(convertWangColor),
    wangtiles: toArray(node.wangtile).map(convertWangTile),
    ...(wangType === undefined ? {} : { type: wangType }),
    ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
    ...(optionalInteger(node.tile) === undefined ? {} : { tile: optionalInteger(node.tile) }),
  } as TiledJsonWangSet;
};

const convertWangColor = (value: unknown): TiledJsonWangColor => {
  const node = requiredNode(value, "wangcolor");
  return {
    name: requiredString(node.name, "wangcolor.name"),
    color: requiredString(node.color, "wangcolor.color"),
    tile: requiredInteger(node.tile, "wangcolor.tile"),
    ...(optionalNumber(node.probability) === undefined ? {} : { probability: optionalNumber(node.probability) }),
    ...(optionalString(node.class) === undefined ? {} : { class: optionalString(node.class) }),
  } as TiledJsonWangColor;
};

const convertWangTile = (value: unknown): TiledJsonWangTile => {
  const node = requiredNode(value, "wangtile");
  return {
    tileid: requiredInteger(node.tileid, "wangtile.tileid"),
    wangid: requiredString(node.wangid, "wangtile.wangid")
      .split(",")
      .map((entry) => requiredInteger(entry.trim(), "wangtile.wangid")),
  };
};

export const readTiledXmlLayerDataNode = (
  node: TiledXmlNode,
): { readonly encoding?: string; readonly compression?: string; readonly text?: string } => {
  const data = childNode(node.data, "data") ?? requiredNode(node.data, "layer.data");
  return {
    ...(optionalString(data.encoding) === undefined ? {} : { encoding: optionalString(data.encoding) }),
    ...(optionalString(data.compression) === undefined ? {} : { compression: optionalString(data.compression) }),
    ...(textContent(data) === undefined ? {} : { text: textContent(data) }),
  } as { readonly encoding?: string; readonly compression?: string; readonly text?: string };
};

const convertProperties = (value: unknown): readonly TiledJsonProperty[] | undefined => {
  const properties = toArray(childNode(value, "properties")?.property ?? requiredNodeOrUndefined(value)?.property).map(
    convertProperty,
  );
  return properties.length === 0 ? undefined : properties;
};

const convertProperty = (value: unknown): TiledJsonProperty => {
  const node = requiredNode(value, "property");
  const type = optionalString(node.type) ?? "string";
  const propertytype = optionalString(node.propertytype);
  return {
    name: requiredString(node.name, "property.name"),
    type: type as TiledJsonProperty["type"],
    value: propertyValue(node.value ?? textContent(node), type),
    ...(propertytype === undefined ? {} : { propertytype }),
  } as TiledJsonProperty;
};

const propertyValue = (value: unknown, type: string): string | number | boolean => {
  if (type === "bool") return requiredBoolean(value, "property.value");
  if (type === "int") return requiredInteger(value, "property.value");
  if (type === "float") return requiredNumber(value, "property.value");
  if (value === undefined) return "";
  return requiredString(value, "property.value");
};

const parsePoints = (value: string): readonly { readonly x: number; readonly y: number }[] =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(",");
      return { x: requiredNumber(x, "point.x"), y: requiredNumber(y, "point.y") };
    });

export const childNode = (value: unknown, name: string): TiledXmlNode | undefined => {
  const node = requiredNodeOrUndefined(value);
  if (!node) return undefined;
  const nested = node[name];
  return requiredNodeOrUndefined(nested) ?? node;
};

export const textContent = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  const node = requiredNodeOrUndefined(value);
  if (!node) return undefined;
  return optionalString(node[TEXT_NODE]);
};

export const toArray = (value: unknown): readonly unknown[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const requiredNode = (value: unknown, label: string): TiledXmlNode => {
  const node = requiredNodeOrUndefined(value);
  if (!node) throw new Error(`Tiled XML ${label} must be an object`);
  return node;
};

const requiredNodeOrUndefined = (value: unknown): TiledXmlNode | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as TiledXmlNode) : undefined;

const requiredString = (value: unknown, label: string): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`Tiled XML ${label} must be a string`);
};

const optionalString = (value: unknown): string | undefined =>
  value === undefined ? undefined : requiredString(value, "value");

const requiredNumber = (value: unknown, label: string): number => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(number)) throw new Error(`Tiled XML ${label} must be a finite number`);
  return number;
};

const optionalNumber = (value: unknown): number | undefined =>
  value === undefined ? undefined : requiredNumber(value, "value");

const requiredInteger = (value: unknown, label: string): number => {
  const number = requiredNumber(value, label);
  if (!Number.isSafeInteger(number)) throw new Error(`Tiled XML ${label} must be an integer`);
  return number;
};

const optionalInteger = (value: unknown): number | undefined =>
  value === undefined ? undefined : requiredInteger(value, "value");

const requiredBoolean = (value: unknown, label: string): boolean => {
  const bool = optionalTiledBoolean(value);
  if (bool === undefined) throw new Error(`Tiled XML ${label} must be a boolean`);
  return bool;
};

const optionalTiledBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  throw new Error("Tiled XML value must be a boolean");
};

export const xmlMapRoot = (value: unknown): TiledXmlNode | undefined => childNode(value, "map");

export const xmlTilesetRoot = (value: unknown): TiledXmlNode | undefined => childNode(value, "tileset");

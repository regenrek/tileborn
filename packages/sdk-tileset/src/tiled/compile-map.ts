import type { ParseDiagnostic } from "../diagnostics.js";
import type { Placeable } from "../schemas/placeable.js";

import { decodeTiledGid, locateTiledGid, tileborneTileIndexForTiledGid, type TiledTilesetWindow } from "./gid.js";
import { propertiesToMetadata } from "./compile-tileset.js";
import type {
  TiledJsonAnyLayer,
  TiledJsonMap,
  TiledJsonObject,
  TiledJsonProperty,
  TiledJsonTileLayer,
  TiledMapGroupLayer,
  TiledMapImageLayer,
  TiledMapImport,
  TiledImportProfile,
  TiledMapLayer,
  TiledMapObject,
  TiledMapObjectRole,
  TiledMapTileLayer,
  TiledObjectAnchor,
} from "./types.js";

const CANONICAL_OBJECT_ANCHOR = "top-left" as const;

const placeableKey = (tilesetName: string, localTileId: number): string => `${tilesetName}:${localTileId}`;

const propertyValue = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): string | number | boolean | undefined => properties?.find((property) => property.name === name)?.value;

const stringProperty = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): string | undefined => {
  const value = propertyValue(properties, name);
  return typeof value === "string" ? value : undefined;
};

const hasUnsupportedTiledGidFlags = (decoded: ReturnType<typeof decodeTiledGid>): boolean =>
  decoded.flippedHorizontal || decoded.flippedVertical || decoded.flippedDiagonal || decoded.rotatedHexagonal120;

const pushFlipFlagDiagnostic = (diagnostics: ParseDiagnostic[], path: string): void => {
  diagnostics.push({
    _tag: "TiledUnsupportedFeature",
    path,
    // TODO(tiled-flip-support): add a canonical transform model before accepting flipped Tiled GIDs.
    message: "Tiled flip flags are not supported by the canonical importer.",
    severity: "error",
    feature: "flip-flags",
  });
};

const tileObjectAnchor = (args: {
  readonly object: TiledJsonObject;
  readonly profile: TiledImportProfile | undefined;
  readonly layerName: string | undefined;
  readonly diagnostics: ParseDiagnostic[];
}): TiledObjectAnchor => {
  if (args.object.gid === undefined) return CANONICAL_OBJECT_ANCHOR;
  if (args.profile !== "standard-plus-hints") return "bottom-left";

  const value = stringProperty(args.object.properties, "tileborne.anchor");
  if (value === undefined) return "bottom-left";
  if (value === "top-left" || value === "bottom-left" || value === "center") return value;

  args.diagnostics.push({
    _tag: "TiledUnsupportedFeature",
    path: `/layers/${args.layerName ?? "objects"}/objects/${args.object.id}/properties/tileborne.anchor`,
    message: 'tileborne.anchor must be "top-left", "bottom-left", or "center".',
    severity: "error",
    feature: "tileborne.anchor",
  });
  return "bottom-left";
};

const anchoredTopLeft = (input: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchor: TiledObjectAnchor;
}): { readonly x: number; readonly y: number } => {
  switch (input.anchor) {
    case "top-left":
      return { x: input.x, y: input.y };
    case "bottom-left":
      return { x: input.x, y: input.y - input.height };
    case "center":
      return { x: input.x - input.width / 2, y: input.y - input.height / 2 };
  }
};

const classifyObjectRole = (object: TiledJsonObject, layerClass?: string): TiledMapObjectRole => {
  const cls = object.class ?? object.type ?? layerClass ?? "";
  if (/spawn/i.test(cls)) return "spawn";
  if (/prop/i.test(cls)) return "prop";
  return "object";
};

const layerIdFor = (layer: TiledJsonAnyLayer, indexPath: readonly number[]): string =>
  layer.id !== undefined ? `layer:${layer.id}` : `layer:${indexPath.join(".")}`;

export const compileTiledMap = (input: {
  readonly map: TiledJsonMap;
  readonly windows: readonly TiledTilesetWindow[];
  readonly placeables?: readonly Placeable[] | undefined;
  readonly profile?: TiledImportProfile | undefined;
}): { readonly map: TiledMapImport; readonly diagnostics: readonly ParseDiagnostic[] } => {
  const layers: TiledMapLayer[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const placeableLookup = new Map(
    (input.placeables ?? []).map((placeable) => [
      placeableKey(placeable.source.tilesetName, placeable.source.localTileId),
      placeable,
    ] as const),
  );

  for (const [index, layer] of input.map.layers.entries()) {
    compileLayer({
      map: input.map,
      layer,
      indexPath: [index],
      windows: input.windows,
      placeableLookup,
      profile: input.profile,
      layers,
      diagnostics,
    });
  }

  return {
    map: {
      width: input.map.width,
      height: input.map.height,
      tileWidth: input.map.tilewidth,
      tileHeight: input.map.tileheight,
      orientation: input.map.orientation,
      layers,
      properties: propertiesToMetadata(input.map.properties),
    },
    diagnostics,
  };
};

const compileLayer = (args: {
  readonly map: TiledJsonMap;
  readonly layer: TiledJsonAnyLayer;
  readonly indexPath: readonly number[];
  readonly windows: readonly TiledTilesetWindow[];
  readonly placeableLookup: ReadonlyMap<string, Placeable>;
  readonly profile?: TiledImportProfile | undefined;
  readonly layers: TiledMapLayer[];
  readonly diagnostics: ParseDiagnostic[];
}): void => {
  const layer = args.layer;
  const layerId = layerIdFor(layer, args.indexPath);

  if (layer.type === "tilelayer") {
    args.layers.push(compileTileLayer(layer, layerId, args.windows, args.diagnostics));
    return;
  }

  if (layer.type === "objectgroup") {
    for (const object of layer.objects) {
      args.layers.push(
        compileObjectLayer({
          object,
          layer,
          layerId,
          map: args.map,
          windows: args.windows,
          placeableLookup: args.placeableLookup,
          profile: args.profile,
          diagnostics: args.diagnostics,
        }),
      );
    }
    return;
  }

  if (layer.type === "imagelayer") {
    const imageLayer: TiledMapImageLayer = {
      kind: "image",
      id: layerId,
      name: layer.name,
      image: layer.image,
      ...(layer.x === undefined ? {} : { x: layer.x }),
      ...(layer.y === undefined ? {} : { y: layer.y }),
      visible: layer.visible ?? true,
      opacity: layer.opacity ?? 1,
      properties: propertiesToMetadata(layer.properties),
    };
    args.layers.push(imageLayer);
    return;
  }

  if (layer.type === "group") {
    const nested: TiledMapLayer[] = [];
    for (const [index, child] of layer.layers.entries()) {
      compileLayer({
        ...args,
        layer: child,
        indexPath: [...args.indexPath, index],
        layers: nested,
      });
    }
    const groupLayer: TiledMapGroupLayer = {
      kind: "group",
      id: layerId,
      name: layer.name,
      visible: layer.visible ?? true,
      opacity: layer.opacity ?? 1,
      layers: nested,
      properties: propertiesToMetadata(layer.properties),
    };
    args.layers.push(groupLayer);
  }
};

const compileTileLayer = (
  layer: TiledJsonTileLayer,
  layerId: string,
  windows: readonly TiledTilesetWindow[],
  diagnostics: ParseDiagnostic[],
): TiledMapTileLayer => {
  const cells = layer.data.map((rawGid, cellIndex) => {
    const decoded = decodeTiledGid(rawGid);
    if (hasUnsupportedTiledGidFlags(decoded)) {
      pushFlipFlagDiagnostic(diagnostics, `/layers/${layer.name}/data/${cellIndex}`);
    }
    const located = locateTiledGid(rawGid, windows);
    return {
      rawGid,
      gid: decoded.gid,
      tileIndex: tileborneTileIndexForTiledGid(rawGid, windows),
      localTileIndex: located?.localId ?? -1,
      tilesetName: located?.window.name ?? "",
      flippedHorizontal: decoded.flippedHorizontal,
      flippedVertical: decoded.flippedVertical,
      flippedDiagonal: decoded.flippedDiagonal,
      rotatedHexagonal120: decoded.rotatedHexagonal120,
    };
  });
  return {
    kind: "tile",
    id: layerId,
    name: layer.name,
    ...(layer.class === undefined ? {} : { class: layer.class }),
    width: layer.width,
    height: layer.height,
    visible: layer.visible ?? true,
    opacity: layer.opacity ?? 1,
    properties: propertiesToMetadata(layer.properties),
    cells,
  };
};

const compileObjectLayer = (args: {
  readonly object: TiledJsonObject;
  readonly layer: Extract<TiledJsonAnyLayer, { readonly type: "objectgroup" }>;
  readonly layerId: string;
  readonly map: TiledJsonMap;
  readonly windows: readonly TiledTilesetWindow[];
  readonly placeableLookup: ReadonlyMap<string, Placeable>;
  readonly profile?: TiledImportProfile | undefined;
  readonly diagnostics: ParseDiagnostic[];
}): TiledMapObject => {
  const { object, layer, layerId, windows } = args;
  const decoded = object.gid === undefined ? undefined : decodeTiledGid(object.gid);
  if (decoded !== undefined && hasUnsupportedTiledGidFlags(decoded)) {
    pushFlipFlagDiagnostic(args.diagnostics, `/layers/${layer.name ?? "objects"}/objects/${object.id}/gid`);
  }
  const located = object.gid === undefined ? null : locateTiledGid(object.gid, windows);
  const tileRef =
    object.gid === undefined || decoded === undefined
      ? undefined
      : {
          rawGid: object.gid,
          gid: decoded.gid,
          localTileIndex: located?.localId ?? -1,
          tilesetName: located?.window.name ?? "",
          flippedHorizontal: decoded.flippedHorizontal,
          flippedVertical: decoded.flippedVertical,
          flippedDiagonal: decoded.flippedDiagonal,
          rotatedHexagonal120: decoded.rotatedHexagonal120,
        };
  const placeable =
    tileRef === undefined
      ? undefined
      : args.placeableLookup.get(placeableKey(tileRef.tilesetName, tileRef.localTileIndex));
  const frame = placeable?.frames[0];
  const resolvedWidth =
    object.gid === undefined ? object.width : object.width ?? placeable?.size.width ?? args.map.tilewidth;
  const resolvedHeight =
    object.gid === undefined ? object.height : object.height ?? placeable?.size.height ?? args.map.tileheight;
  const sourceAnchor = tileObjectAnchor({
    object,
    profile: args.profile,
    layerName: layer.name,
    diagnostics: args.diagnostics,
  });
  const canonicalPosition =
    object.gid === undefined || resolvedWidth === undefined || resolvedHeight === undefined
      ? { x: object.x, y: object.y }
      : anchoredTopLeft({
          x: object.x,
          y: object.y,
          width: resolvedWidth,
          height: resolvedHeight,
          anchor: sourceAnchor,
        });
  const placement =
    placeable === undefined || frame === undefined || decoded === undefined
      ? undefined
      : {
          placeableId: placeable.id,
          source: "tiled-object" as const,
          assetId: frame.assetId,
          tileId: frame.tileId,
          gid: decoded.gid,
          anchor: CANONICAL_OBJECT_ANCHOR,
        };

  return {
    kind: "object",
    id: `${layerId}/object:${object.id}`,
    layerId,
    layerName: layer.name ?? "objects",
    layerVisible: layer.visible ?? true,
    layerOpacity: layer.opacity ?? 1,
    name: object.name ?? `object-${object.id}`,
    role: classifyObjectRole(object, layer.class),
    ...((object.class ?? object.type) === undefined ? {} : { class: object.class ?? object.type }),
    x: canonicalPosition.x,
    y: canonicalPosition.y,
    ...(resolvedWidth === undefined ? {} : { width: resolvedWidth }),
    ...(resolvedHeight === undefined ? {} : { height: resolvedHeight }),
    ...(object.gid === undefined ? {} : { anchor: CANONICAL_OBJECT_ANCHOR }),
    ...(object.gid === undefined ? {} : { gid: object.gid }),
    ...(tileRef === undefined ? {} : { tileRef }),
    ...(placement === undefined ? {} : { placement }),
    properties: {
      ...propertiesToMetadata(object.properties),
      ...(object.gid === undefined ? {} : { "tileborne.anchor": CANONICAL_OBJECT_ANCHOR }),
      ...(object.point ? { point: true } : {}),
      ...(object.ellipse ? { ellipse: true } : {}),
    },
  };
};

export const buildTilesetWindows = (
  refs: readonly {
    readonly firstgid: number;
    readonly tilecount?: number;
    readonly tileborneTileCount?: number;
    readonly name?: string;
  }[],
): readonly TiledTilesetWindow[] => {
  let tileborneTileIndexOffset = 0;
  return refs
    .map((ref) => ({
      firstgid: ref.firstgid,
      tileCount: ref.tilecount ?? 0,
      tileborneTileCount: ref.tileborneTileCount ?? ref.tilecount ?? 0,
      name: ref.name ?? `tileset-${ref.firstgid}`,
    }))
    .sort((left, right) => left.firstgid - right.firstgid)
    .map((ref) => {
      const window = { ...ref, tileborneTileIndexOffset };
      tileborneTileIndexOffset += ref.tileborneTileCount;
      return window;
    });
};

import type { ParseDiagnostic } from "../diagnostics.js";

import type {
  TiledJsonAnyLayer,
  TiledJsonMap,
  TiledJsonObject,
  TiledJsonProperty,
  TiledJsonTileset,
  TiledScanUnsupportedFeature,
  TiledUnsupportedFeatureId,
} from "./types.js";

type PrimitivePropertyValue = string | number | boolean;

type TiledTilesetPropertySource = {
  readonly name?: string;
  readonly properties?: readonly TiledJsonProperty[];
  readonly tiles?: TiledJsonTileset["tiles"];
};

const isPrimitivePropertyValue = (value: unknown): value is PrimitivePropertyValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const childPath = (basePath: string, child: string): string =>
  basePath === "" || basePath === "/" ? `/${child}` : `${basePath}/${child}`;

export const primitivePropertyValue = (property: TiledJsonProperty | undefined): PrimitivePropertyValue | undefined =>
  property && isPrimitivePropertyValue(property.value) ? property.value : undefined;

export const propertiesToPrimitiveRecord = (
  properties: readonly TiledJsonProperty[] | undefined,
): Readonly<Record<string, PrimitivePropertyValue>> => {
  if (!properties || properties.length === 0) return {};
  const record: Record<string, PrimitivePropertyValue> = {};
  for (const property of properties) {
    const value = primitivePropertyValue(property);
    if (value !== undefined) record[property.name] = value;
  }
  return record;
};

const unsupportedFeatureText: Record<TiledUnsupportedFeatureId, { readonly message: string; readonly action: string }> = {
  templates: {
    message: "Tiled object templates are diagnosed but not imported.",
    action: "Detach object templates in Tiled or use a plugin profile that explicitly resolves template inheritance.",
  },
  "infinite-chunks": {
    message: "Infinite chunk maps require a future import mode.",
    action: "Export the map as finite orthogonal layers before importing.",
  },
  rotation: {
    message: "Object rotation is diagnosed but not applied to map placement.",
    action: "Bake object rotation into artwork or wait for canonical rotated placement support.",
  },
  parallax: {
    message: "Layer parallax is diagnosed but not applied to map layers.",
    action: "Remove parallax factors or use an importer that implements Tileborne visual parallax semantics.",
  },
  orientation: {
    message: "Only orthogonal Tiled maps are supported.",
    action: "Convert the map to orthogonal orientation before importing.",
  },
  "class-properties": {
    message: "Tiled class-typed custom properties require Tiled project class definitions and are not imported.",
    action: "Flatten class properties to primitive string, number, or boolean properties before importing.",
  },
  "project-files": {
    message: "Tiled project files and custom type definitions are not imported.",
    action: "Import TMJ/TMX/TSJ/TSX sources directly and flatten project custom types to primitive properties.",
  },
};

export const unsupportedFeature = (
  feature: TiledUnsupportedFeatureId,
  path: string,
): TiledScanUnsupportedFeature => ({
  feature,
  path,
  ...unsupportedFeatureText[feature],
});

export const unsupportedFeatureDiagnostic = (
  feature: TiledScanUnsupportedFeature,
): ParseDiagnostic & { readonly action: string } => ({
  _tag: "TiledUnsupportedFeature",
  path: feature.path,
  message: feature.message,
  severity: "error",
  feature: feature.feature,
  action: feature.action,
});

const classPropertyFeatures = (
  properties: readonly TiledJsonProperty[] | undefined,
  basePath: string,
): readonly TiledScanUnsupportedFeature[] =>
  (properties ?? [])
    .map((property, index) => ({ property, index }))
    .filter(({ property }) => property.type === "class" || property.propertytype !== undefined)
    .map(({ index }) => unsupportedFeature("class-properties", childPath(basePath, `properties/${index}`)));

const objectPropertyFeatures = (
  objects: readonly TiledJsonObject[],
  basePath: string,
): readonly TiledScanUnsupportedFeature[] =>
  objects.flatMap((object, objectIndex) =>
    classPropertyFeatures(object.properties, `${basePath}/objects/${object.id ?? objectIndex}`),
  );

const layerPropertyFeatures = (
  layers: readonly TiledJsonAnyLayer[],
  basePath: string,
): readonly TiledScanUnsupportedFeature[] =>
  layers.flatMap((layer, layerIndex): readonly TiledScanUnsupportedFeature[] => {
    const layerPath = `${basePath}/layers/${layer.id ?? layer.name ?? layerIndex}`;
    const local = classPropertyFeatures(layer.properties, layerPath);
    if (layer.type === "group") return [...local, ...layerPropertyFeatures(layer.layers, layerPath)];
    if (layer.type === "objectgroup") return [...local, ...objectPropertyFeatures(layer.objects, layerPath)];
    return local;
  });

export const unsupportedClassPropertyFeaturesForTileset = (
  tileset: TiledJsonTileset,
  basePath = "/tilesets",
): readonly TiledScanUnsupportedFeature[] => unsupportedClassPropertyFeaturesForTilesetSource(tileset, basePath);

const unsupportedClassPropertyFeaturesForTilesetSource = (
  tileset: TiledTilesetPropertySource,
  basePath: string,
): readonly TiledScanUnsupportedFeature[] => [
  ...classPropertyFeatures(tileset.properties, basePath),
  ...(tileset.tiles ?? []).flatMap((tile) => [
    ...classPropertyFeatures(tile.properties, `${basePath}/tiles/${tile.id}`),
    ...(tile.objectgroup === undefined
      ? []
      : objectPropertyFeatures(tile.objectgroup.objects, `${basePath}/tiles/${tile.id}/objectgroup`)),
  ]),
];

export const unsupportedClassPropertyFeaturesForMap = (
  map: TiledJsonMap,
  tilesets: readonly TiledTilesetPropertySource[],
): readonly TiledScanUnsupportedFeature[] => [
  ...classPropertyFeatures(map.properties, "/"),
  ...layerPropertyFeatures(map.layers, ""),
  ...tilesets.flatMap((tileset, index) =>
    unsupportedClassPropertyFeaturesForTilesetSource(tileset, `/tilesets/${tileset.name || index}`),
  ),
];

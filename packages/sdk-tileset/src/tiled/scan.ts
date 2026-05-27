import type { ParseDiagnostic } from "../diagnostics.js";

import {
  isSupportedTilesetSource,
  readExternalText,
  resolveExternalPath,
  resolvePath,
  tilesetIdFromSource,
} from "./external-resolve.js";
import { decodeTiledGid, locateTiledGid } from "./gid.js";
import { normalizeTiledTilesetImageAssetPaths } from "./image-paths.js";
import {
  childNode,
  convertTiledXmlMap,
  convertTiledXmlObjectGroup,
  convertTiledXmlTileset,
  parseTiledXmlDocument,
  toArray,
  xmlMapRoot,
  xmlTilesetRoot,
} from "./xml-common.js";
import { normalizeJsonTileLayers, validateTiledJsonMap, validateTiledJsonTileset } from "./validate.js";
import { buildTilesetWindows } from "./compile-map.js";
import type {
  TiledExternalReader,
  TiledImportScan,
  TiledJsonAnyLayer,
  TiledJsonMap,
  TiledJsonObject,
  TiledJsonProperty,
  TiledJsonTileset,
  TiledImportRecommendation,
  TiledImportRecommendedProfile,
  TiledScanAmbiguousAtlasObject,
  TiledScanCategory,
  TiledScanFeatureFlags,
  TiledScanImageAssetRef,
  TiledScanObjectLayer,
  TiledScanPlaceableCandidate,
  TiledScanTileset,
  TiledScanUnsupportedFeature,
} from "./types.js";

export type TiledScanSourceInput = {
  readonly sourcePath: string;
  readonly projectRoot: string;
  readonly raw?: string;
  readonly reader?: TiledExternalReader;
};

type LoadedTileset = {
  readonly ref: TiledJsonMap["tilesets"][number];
  readonly tileset: TiledJsonTileset;
  readonly source?: string;
};

type DirectoryEntry = {
  readonly path: string;
  readonly kind: "file" | "directory";
};

const propertyValue = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): string | number | boolean | undefined => properties?.find((property) => property.name === name)?.value;

const boolProperty = (properties: readonly TiledJsonProperty[] | undefined, name: string): boolean =>
  propertyValue(properties, name) === true;

const numberProperty = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): number | undefined => {
  const value = propertyValue(properties, name);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const stringProperty = (
  properties: readonly TiledJsonProperty[] | undefined,
  name: string,
): string | undefined => {
  const value = propertyValue(properties, name);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const categoryId = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-");

const collectCategoryValues = (input: {
  readonly class?: string | undefined;
  readonly type?: string | undefined;
  readonly properties?: readonly TiledJsonProperty[] | undefined;
}): readonly { readonly label: string; readonly source: TiledScanCategory["source"]; readonly confidence: number }[] => [
  ...(input.class ? [{ label: input.class, source: "class" as const, confidence: 0.9 }] : []),
  ...(input.type ? [{ label: input.type, source: "type" as const, confidence: 0.85 }] : []),
  ...(stringProperty(input.properties, "category")
    ? [{ label: stringProperty(input.properties, "category")!, source: "property" as const, confidence: 0.75 }]
    : []),
  ...(stringProperty(input.properties, "tileborne.category")
    ? [
        {
          label: stringProperty(input.properties, "tileborne.category")!,
          source: "tileborne-hint" as const,
          confidence: 1,
        },
      ]
    : []),
];

const parseJsonMap = (raw: string): { readonly map?: TiledJsonMap; readonly diagnostics: readonly ParseDiagnostic[] } => {
  try {
    const validated = validateTiledJsonMap(JSON.parse(raw) as unknown);
    return validated.ok
      ? { map: normalizeJsonTileLayers(validated.map), diagnostics: [] }
      : { diagnostics: [validated.diagnostic] };
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
};

const collectXmlLayerEntries = (node: Record<string, unknown>): readonly { readonly kind: string; readonly value: unknown }[] => [
  ...toArray(node.layer).map((value) => ({ kind: "layer", value })),
  ...toArray(node.objectgroup).map((value) => ({ kind: "objectgroup", value })),
  ...toArray(node.imagelayer).map((value) => ({ kind: "imagelayer", value })),
  ...toArray(node.group).map((value) => ({ kind: "group", value })),
];

const parseXmlMap = (raw: string): { readonly map?: TiledJsonMap; readonly diagnostics: readonly ParseDiagnostic[] } => {
  const parsed = parseTiledXmlDocument(raw);
  if (!parsed.ok) {
    return {
      diagnostics: [
        { _tag: "TiledParseError", path: "/", message: parsed.error, severity: "error", format: "tmx" },
      ],
    };
  }
  const root = xmlMapRoot(parsed.value);
  if (!root) {
    return {
      diagnostics: [
        {
          _tag: "TiledParseError",
          path: "/",
          message: "Tiled XML map is missing <map> root",
          severity: "error",
          format: "tmx",
        },
      ],
    };
  }
  try {
    const base = convertTiledXmlMap(root);
    const layers = collectXmlLayerEntries(root).map((entry): TiledJsonAnyLayer => {
      const node = entry.value as Record<string, unknown>;
      if (entry.kind === "objectgroup") {
        return convertTiledXmlObjectGroup(node) as TiledJsonAnyLayer;
      }
      if (entry.kind === "group") {
        return {
          type: "group",
          name: String(node.name ?? "group"),
          layers: collectXmlLayerEntries(node).map((child) =>
            child.kind === "objectgroup"
              ? (convertTiledXmlObjectGroup(child.value as Record<string, unknown>) as TiledJsonAnyLayer)
              : ({ type: "tilelayer", name: String((child.value as { name?: unknown }).name ?? "layer"), width: 0, height: 0, data: [] } as TiledJsonAnyLayer),
          ),
        };
      }
      if (entry.kind === "imagelayer") {
        const image = childNode(node.image, "image");
        return {
          type: "imagelayer",
          name: String(node.name ?? "image"),
          image: String(image?.source ?? ""),
        } as TiledJsonAnyLayer;
      }
      return {
        type: "tilelayer",
        name: String(node.name ?? "layer"),
        width: Number(node.width ?? 0),
        height: Number(node.height ?? 0),
        data: [],
        ...(node.chunks === undefined ? {} : { chunks: toArray(node.chunks) }),
      } as TiledJsonAnyLayer;
    });
    return { map: { ...base, layers }, diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        {
          _tag: "TiledParseError",
          path: "/",
          message: (error as Error).message,
          severity: "error",
          format: "tmx",
        },
      ],
    };
  }
};

const parseTilesetRaw = (
  raw: string,
  source: string,
): { readonly tileset?: TiledJsonTileset; readonly diagnostics: readonly ParseDiagnostic[] } => {
  try {
    if (source.toLowerCase().endsWith(".tsx")) {
      const parsed = parseTiledXmlDocument(raw);
      const root = parsed.ok ? xmlTilesetRoot(parsed.value) : undefined;
      if (!parsed.ok || !root) {
        return {
          diagnostics: [
            {
              _tag: "TiledParseError",
              path: source,
              message: parsed.ok ? "Tiled XML tileset is missing <tileset> root" : parsed.error,
              severity: "error",
              format: "tsx",
            },
          ],
        };
      }
      const validated = validateTiledJsonTileset(convertTiledXmlTileset(root));
      return validated.ok ? { tileset: validated.tileset, diagnostics: [] } : { diagnostics: [validated.diagnostic] };
    }
    const validated = validateTiledJsonTileset(JSON.parse(raw) as unknown);
    return validated.ok ? { tileset: validated.tileset, diagnostics: [] } : { diagnostics: [validated.diagnostic] };
  } catch (error) {
    return {
      diagnostics: [
        {
          _tag: "TiledParseError",
          path: source,
          message: `Failed to parse external tileset: ${(error as Error).message}`,
          severity: "error",
          format: source.toLowerCase().endsWith(".tsx") ? "tsx" : "tsj",
        },
      ],
    };
  }
};

const normalizeDirectoryEntries = (basePath: string, entries: readonly unknown[]): readonly DirectoryEntry[] =>
  entries.flatMap((entry): readonly DirectoryEntry[] => {
    if (typeof entry === "string") {
      return [{ path: resolvePath(basePath, entry), kind: entry.endsWith("/") ? "directory" : "file" }];
    }
    if (!entry || typeof entry !== "object") return [];
    const value = entry as { readonly name?: unknown; readonly path?: unknown; readonly kind?: unknown };
    if (value.kind !== "file" && value.kind !== "directory") return [];
    const name = typeof value.path === "string" ? value.path : typeof value.name === "string" ? value.name : undefined;
    return name === undefined ? [] : [{ path: resolvePath(basePath, name), kind: value.kind }];
  });

const walkDirectory = async (
  rootPath: string,
  reader: TiledExternalReader,
): Promise<readonly DirectoryEntry[]> => {
  if (!reader.readDirectory) return [];
  const visited = new Set<string>();
  const walk = async (dir: string): Promise<readonly DirectoryEntry[]> => {
    if (visited.has(dir)) return [];
    visited.add(dir);
    const entries = normalizeDirectoryEntries(dir, await reader.readDirectory!(dir));
    const nested = await Promise.all(
      entries.filter((entry) => entry.kind === "directory").map((entry) => walk(entry.path)),
    );
    return [...entries, ...nested.flat()];
  };
  return walk(rootPath);
};

const loadStandaloneTileset = async (
  input: TiledScanSourceInput,
  raw: string,
): Promise<{ readonly tileset?: LoadedTileset; readonly diagnostics: readonly ParseDiagnostic[] }> => {
  const parsed = parseTilesetRaw(raw, input.sourcePath);
  if (!parsed.tileset) return { diagnostics: parsed.diagnostics };
  const normalized = normalizeTiledTilesetImageAssetPaths(parsed.tileset, {
    projectRoot: input.projectRoot,
    basePath: input.sourcePath,
    allowParentTraversalWithinRoot: true,
  });
  return normalized.tileset
    ? {
        tileset: {
          ref: { firstgid: 1, source: input.sourcePath, ...normalized.tileset },
          tileset: normalized.tileset,
          source: input.sourcePath,
        },
        diagnostics: [...parsed.diagnostics, ...normalized.diagnostics],
      }
    : { diagnostics: [...parsed.diagnostics, ...normalized.diagnostics] };
};

const loadTilesets = async (
  map: TiledJsonMap,
  input: TiledScanSourceInput,
): Promise<{ readonly tilesets: readonly LoadedTileset[]; readonly diagnostics: readonly ParseDiagnostic[] }> => {
  const tilesets: LoadedTileset[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  for (const ref of map.tilesets) {
    if (ref.source === undefined) {
      const normalized = normalizeTiledTilesetImageAssetPaths(ref as TiledJsonTileset, {
        projectRoot: input.projectRoot,
        basePath: input.sourcePath,
      });
      diagnostics.push(...normalized.diagnostics);
      if (normalized.tileset) {
        tilesets.push({ ref, tileset: normalized.tileset });
      }
      continue;
    }
    if (!input.reader || !isSupportedTilesetSource(ref.source)) {
      diagnostics.push({
        _tag: "TiledParseError",
        path: ref.source,
        message: "External tileset source must be .json, .tsj, or .tsx and requires a reader",
        severity: "error",
        format: "tmj",
      });
      continue;
    }
    const resolved = await resolveExternalPath({
      projectRoot: input.projectRoot,
      basePath: input.sourcePath,
      source: ref.source,
      ...(input.reader.realpath ? { realpath: input.reader.realpath } : {}),
    });
    if (!resolved.ok) {
      diagnostics.push(resolved.diagnostic);
      continue;
    }
    const raw = await readExternalText(input.reader.readFile, resolved.absolutePath);
    const parsed = parseTilesetRaw(raw, ref.source);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.tileset) {
      const normalized = normalizeTiledTilesetImageAssetPaths(parsed.tileset, {
        projectRoot: input.projectRoot,
        basePath: resolved.absolutePath,
        allowParentTraversalWithinRoot: true,
      });
      diagnostics.push(...normalized.diagnostics);
      if (normalized.tileset) {
        tilesets.push({ ref, tileset: normalized.tileset, source: ref.source });
      }
    }
  }
  return { tilesets, diagnostics };
};

const flattenLayers = (layers: readonly TiledJsonAnyLayer[]): readonly TiledJsonAnyLayer[] =>
  layers.flatMap((layer): readonly TiledJsonAnyLayer[] =>
    layer.type === "group" ? [layer, ...flattenLayers(layer.layers)] : [layer],
  );

const hasUnsupportedTiledGidFlags = (rawGid: number): boolean => {
  const decoded = decodeTiledGid(rawGid);
  return decoded.flippedHorizontal || decoded.flippedVertical || decoded.flippedDiagonal || decoded.rotatedHexagonal120;
};

const featureFlagsFor = (map: TiledJsonMap, tilesets: readonly LoadedTileset[]): TiledScanFeatureFlags => {
  const layers = flattenLayers(map.layers);
  const objects = layers.flatMap((layer) => (layer.type === "objectgroup" ? [...layer.objects] : []));
  return {
    gridAtlas: tilesets.some(({ tileset }) => tileset.columns > 0),
    imageCollection: tilesets.some(({ tileset }) => tileset.columns === 0),
    wangSets: tilesets.some(({ tileset }) => (tileset.wangsets?.length ?? 0) > 0),
    animations: tilesets.some(({ tileset }) => (tileset.tiles ?? []).some((tile) => (tile.animation?.length ?? 0) > 0)),
    collisionObjectgroups: tilesets.some(({ tileset }) => (tileset.tiles ?? []).some((tile) => tile.objectgroup !== undefined)),
    templates: objects.some((object) => object.template !== undefined),
    rotation: objects.some((object) => object.rotation !== undefined && object.rotation !== 0),
    parallax: layers.some((layer) => layer.parallaxx !== undefined || layer.parallaxy !== undefined),
    infiniteChunks: map.infinite === true || layers.some((layer) => layer.type === "tilelayer" && (layer.chunks?.length ?? 0) > 0),
    unsupportedOrientation: map.orientation !== "orthogonal",
    flipFlags:
      layers.some((layer) => layer.type === "tilelayer" && layer.data.some(hasUnsupportedTiledGidFlags)) ||
      objects.some((object) => object.gid !== undefined && hasUnsupportedTiledGidFlags(object.gid)),
  };
};

const terrainClassCount = (tileset: TiledJsonTileset): number =>
  new Set(
    (tileset.tiles ?? []).flatMap((tile) => {
      const terrain = propertyValue(tile.properties, "terrain") ?? propertyValue(tile.properties, "terrainClass");
      return terrain === undefined ? [] : [String(terrain)];
    }),
  ).size;

const tileCategories = (tileset: TiledJsonTileset): readonly string[] =>
  [
    ...collectCategoryValues({
      class: tileset.class,
      properties: tileset.properties,
    }),
    ...(tileset.tiles ?? []).flatMap((tile) =>
      collectCategoryValues({
        class: tile.class,
        type: tile.type,
        properties: tile.properties,
      }),
    ),
  ]
    .map((category) => categoryId(category.label))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();

const scanTileset = (loaded: LoadedTileset): TiledScanTileset => {
  const categories = tileCategories(loaded.tileset);
  const wangSetCount = loaded.tileset.wangsets?.length ?? 0;
  const animationCount = (loaded.tileset.tiles ?? []).filter((tile) => (tile.animation?.length ?? 0) > 0).length;
  const collisionObjectCount = (loaded.tileset.tiles ?? []).filter((tile) => tile.objectgroup !== undefined).length;
  return {
    name: loaded.tileset.name,
    firstgid: loaded.ref.firstgid,
    kind: loaded.tileset.columns === 0 ? "image-collection" : "grid",
    tileCount: loaded.tileset.tilecount,
    columns: loaded.tileset.columns,
    wangSetCount,
    terrainClassCount: terrainClassCount(loaded.tileset),
    animationCount,
    collisionObjectCount,
    categories,
    confidence: loaded.tileset.columns === 0 || loaded.tileset.image !== undefined ? 1 : 0.85,
    ...(loaded.source === undefined ? {} : { source: loaded.source }),
  };
};

const scanImageAssets = (tilesets: readonly LoadedTileset[]): readonly TiledScanImageAssetRef[] =>
  tilesets.flatMap(({ tileset }) => [
    ...(tileset.image ? [{ path: tileset.image, tilesetName: tileset.name }] : []),
    ...(tileset.tiles ?? []).flatMap((tile) =>
      tile.image ? [{ path: tile.image, tilesetName: tileset.name, localTileId: tile.id }] : [],
    ),
  ]);

const scanPlaceables = (tilesets: readonly LoadedTileset[]): readonly TiledScanPlaceableCandidate[] =>
  tilesets.flatMap(({ tileset }) =>
    (tileset.tiles ?? []).flatMap((tile): readonly TiledScanPlaceableCandidate[] => {
      if (tileset.columns === 0 && tile.image) {
        return [
          {
            tilesetName: tileset.name,
            localTileId: tile.id,
            source: "image-collection" as const,
            image: tile.image,
            width: tile.imagewidth ?? tileset.tilewidth,
            height: tile.imageheight ?? tileset.tileheight,
            ...(stringProperty(tile.properties, "tileborne.category") === undefined
              ? {}
              : { category: categoryId(stringProperty(tile.properties, "tileborne.category")!) }),
            confidence: 1,
          },
        ];
      }
      if (boolProperty(tile.properties, "tileborne.placeable")) {
        return [
          {
            tilesetName: tileset.name,
            localTileId: tile.id,
            source: "tileborne-hint" as const,
            width: numberProperty(tile.properties, "tileborne.objectWidth") ?? tileset.tilewidth,
            height: numberProperty(tile.properties, "tileborne.objectHeight") ?? tileset.tileheight,
            ...(stringProperty(tile.properties, "tileborne.category") === undefined
              ? {}
              : { category: categoryId(stringProperty(tile.properties, "tileborne.category")!) }),
            confidence: 1,
          },
        ];
      }
      return [];
    }),
  );

const scanCategories = (
  map: TiledJsonMap,
  tilesets: readonly LoadedTileset[],
): readonly TiledScanCategory[] => {
  const counts = new Map<string, { label: string; source: TiledScanCategory["source"]; count: number; confidence: number }>();
  const add = (entry: { readonly label: string; readonly source: TiledScanCategory["source"]; readonly confidence: number }) => {
    const id = categoryId(entry.label);
    const existing = counts.get(id);
    counts.set(id, {
      label: entry.label,
      source: existing?.source === "tileborne-hint" ? existing.source : entry.source,
      count: (existing?.count ?? 0) + 1,
      confidence: Math.max(existing?.confidence ?? 0, entry.confidence),
    });
  };

  for (const category of collectCategoryValues({ class: map.class, properties: map.properties })) add(category);
  for (const layer of flattenLayers(map.layers)) {
    add({ label: layer.name, source: "type", confidence: 0.6 });
    for (const category of collectCategoryValues({ class: layer.class, properties: layer.properties })) add(category);
    if (layer.type === "objectgroup") {
      for (const object of layer.objects) {
        for (const category of collectCategoryValues({
          class: object.class,
          type: object.type,
          properties: object.properties,
        })) add(category);
      }
    }
  }
  for (const { tileset } of tilesets) {
    for (const category of collectCategoryValues({ class: tileset.class, properties: tileset.properties })) add(category);
    for (const tile of tileset.tiles ?? []) {
      for (const category of collectCategoryValues({
        class: tile.class,
        type: tile.type,
        properties: tile.properties,
      })) add(category);
    }
  }

  return [...counts.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const unsupportedFeatures = (features: TiledScanFeatureFlags): readonly TiledScanUnsupportedFeature[] => {
  const unsupported: TiledScanUnsupportedFeature[] = [];
  if (features.templates) {
    unsupported.push({ feature: "templates", path: "/layers", message: "Tiled object templates are diagnosed but not imported." });
  }
  if (features.infiniteChunks) {
    unsupported.push({ feature: "infinite-chunks", path: "/layers", message: "Infinite chunk maps require a future import mode." });
  }
  if (features.rotation) {
    unsupported.push({ feature: "rotation", path: "/layers", message: "Object rotation is diagnosed but not applied to map placement." });
  }
  if (features.parallax) {
    unsupported.push({ feature: "parallax", path: "/layers", message: "Layer parallax is diagnosed but not applied to map layers." });
  }
  if (features.unsupportedOrientation) {
    unsupported.push({ feature: "orientation", path: "/orientation", message: "Only orthogonal Tiled maps are supported." });
  }
  if (features.flipFlags) {
    unsupported.push({
      feature: "flip-flags",
      path: "/layers",
      // TODO(tiled-flip-support): add a canonical transform model before accepting flipped Tiled GIDs.
      message: "Tiled flip flags are not supported by the canonical importer.",
    });
  }
  return unsupported;
};

const recommendedProfileFor = (input: {
  readonly unsupportedFeatures: readonly TiledScanUnsupportedFeature[];
  readonly placeableCandidates: readonly TiledScanPlaceableCandidate[];
  readonly ambiguousAtlasObjects: readonly TiledScanAmbiguousAtlasObject[];
}): TiledImportRecommendedProfile =>
  input.unsupportedFeatures.length > 0
    ? "plugin-required"
    : input.placeableCandidates.some((candidate) => candidate.source === "tileborne-hint") ||
        input.ambiguousAtlasObjects.length > 0
      ? "standard-plus-hints"
      : "standard";

const importRecommendationFor = (input: {
  readonly maps: TiledImportScan["maps"];
  readonly tilesets: readonly TiledScanTileset[];
  readonly objectLayers: readonly TiledScanObjectLayer[];
  readonly placeableCandidates: readonly TiledScanPlaceableCandidate[];
  readonly unsupportedFeatures: readonly TiledScanUnsupportedFeature[];
  readonly ambiguousAtlasObjects: readonly TiledScanAmbiguousAtlasObject[];
}): TiledImportRecommendation => {
  const sourceRoles: TiledImportRecommendation["sourceRoles"] = [
    ...input.tilesets
      .filter((tileset) => tileset.kind === "grid")
      .map((tileset) => ({
        kind: "paintable-tileset" as const,
        evidence: "grid-tileset" as const,
        confidence: tileset.confidence,
        count: tileset.tileCount,
        tilesetName: tileset.name,
        browseTarget: "tilesets" as const,
        reviewRequired: false,
        rationale: "Grid tilesets are paintable Tileborne tilesets by default.",
      })),
    ...input.placeableCandidates.map((candidate) => ({
      kind: "placeable-object" as const,
      evidence: candidate.source === "image-collection" ? "image-collection" as const : "tileborne-placeable-hint" as const,
      confidence: candidate.confidence,
      count: 1,
      tilesetName: candidate.tilesetName,
      browseTarget: "objects" as const,
      reviewRequired: false,
      rationale:
        candidate.source === "image-collection"
          ? "Image-collection tiles are placeable Objects."
          : "Explicit tileborne.placeable hints promote atlas tiles to Objects.",
    })),
    ...input.objectLayers.map((layer) => ({
      kind: "map-context" as const,
      evidence: "object-layer" as const,
      confidence: layer.confidence,
      count: layer.objectCount,
      layerName: layer.name,
      browseTarget: "maps" as const,
      reviewRequired: false,
      rationale: "Object layers provide placement evidence but do not promote grid atlas tiles by themselves.",
    })),
    ...input.ambiguousAtlasObjects.map((entry) => ({
      kind: "review-required" as const,
      evidence: "ambiguous-atlas-object" as const,
      confidence: 0.55,
      count: 1,
      tilesetName: entry.tilesetName,
      browseTarget: "review" as const,
      reviewRequired: true,
      rationale: entry.message,
    })),
    ...input.unsupportedFeatures.map((feature) => ({
      kind: "review-required" as const,
      evidence: "unsupported-feature" as const,
      confidence: 0.2,
      count: 1,
      browseTarget: "review" as const,
      reviewRequired: true,
      rationale: feature.message,
    })),
  ];
  const recommendedProfile = recommendedProfileFor({
    unsupportedFeatures: input.unsupportedFeatures,
    placeableCandidates: input.placeableCandidates,
    ambiguousAtlasObjects: input.ambiguousAtlasObjects,
  });
  const reviewRequired = sourceRoles.some((role) => role.reviewRequired);
  const hasPaintable = sourceRoles.some((role) => role.kind === "paintable-tileset");
  const hasPlaceable = sourceRoles.some((role) => role.kind === "placeable-object");
  const primaryAction =
    recommendedProfile === "plugin-required"
      ? "choose-plugin-profile"
      : reviewRequired
        ? "review-before-import"
        : hasPaintable && hasPlaceable
          ? "import-mixed-assets"
          : hasPlaceable
            ? "import-placeable-objects"
            : "import-paintable-tilesets";
  const browseTarget =
    primaryAction === "choose-plugin-profile" || primaryAction === "review-before-import"
      ? "review"
      : primaryAction === "import-placeable-objects"
        ? "objects"
        : "tilesets";
  const rationale =
    primaryAction === "choose-plugin-profile"
      ? "Unsupported Tiled features require a plugin profile before import."
      : primaryAction === "review-before-import"
        ? "Ambiguous atlas object evidence requires review before Tileborne creates placeables."
        : primaryAction === "import-mixed-assets"
          ? "The source contains paintable grid tilesets and placeable object tiles."
          : primaryAction === "import-placeable-objects"
            ? "The source is an image collection, so imported content should open as Objects."
            : "The source is a grid tileset, so imported content should open as paintable Tilesets.";

  return {
    sourceRoles,
    recommendedProfile,
    primaryAction,
    browseTarget,
    rationale,
    reviewRequired,
  };
};

const emptyMapForScan = (): TiledJsonMap => ({
  type: "map",
  version: "1.10",
  orientation: "orthogonal",
  width: 0,
  height: 0,
  tilewidth: 0,
  tileheight: 0,
  tilesets: [],
  layers: [],
});

const buildScanFromTilesets = (input: {
  readonly sourcePath: string;
  readonly sourceKind: "tileset" | "source-folder";
  readonly maps: TiledImportScan["maps"];
  readonly tilesets: readonly LoadedTileset[];
  readonly rulesCount?: number;
}): TiledImportScan => {
  const scannedTilesets = input.tilesets.map(scanTileset);
  const flags: TiledScanFeatureFlags = {
    gridAtlas: input.tilesets.some(({ tileset }) => tileset.columns > 0),
    imageCollection: input.tilesets.some(({ tileset }) => tileset.columns === 0),
    wangSets: input.tilesets.some(({ tileset }) => (tileset.wangsets?.length ?? 0) > 0),
    animations: input.tilesets.some(({ tileset }) => (tileset.tiles ?? []).some((tile) => (tile.animation?.length ?? 0) > 0)),
    collisionObjectgroups: input.tilesets.some(({ tileset }) => (tileset.tiles ?? []).some((tile) => tile.objectgroup !== undefined)),
    templates: false,
    rotation: false,
    parallax: false,
    infiniteChunks: false,
    unsupportedOrientation: false,
    flipFlags: false,
  };
  const placeableCandidates = scanPlaceables(input.tilesets);
  const categories = scanCategories(emptyMapForScan(), input.tilesets);
  const importRecommendation = importRecommendationFor({
    maps: input.maps,
    tilesets: scannedTilesets,
    objectLayers: [],
    placeableCandidates,
    unsupportedFeatures: [],
    ambiguousAtlasObjects: [],
  });
  return {
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    maps: input.maps,
    tilesets: scannedTilesets,
    imageAssets: scanImageAssets(input.tilesets),
    objectLayers: [],
    placeableCandidates,
    categories,
    inventory: {
      mapCount: input.maps.length,
      tilesetCount: scannedTilesets.length,
      gridAtlasCount: scannedTilesets.filter((tileset) => tileset.kind === "grid").length,
      imageCollectionCount: scannedTilesets.filter((tileset) => tileset.kind === "image-collection").length,
      wangSetCount: scannedTilesets.reduce((count, tileset) => count + tileset.wangSetCount, 0),
      terrainClassCount: scannedTilesets.reduce((count, tileset) => count + tileset.terrainClassCount, 0),
      animationCount: scannedTilesets.reduce((count, tileset) => count + tileset.animationCount, 0),
      collisionObjectCount: scannedTilesets.reduce((count, tileset) => count + tileset.collisionObjectCount, 0),
      objectLayerCount: 0,
      placeableCandidateCount: placeableCandidates.length,
      unsupportedFeatureCount: 0,
    },
    confidence: 0.95,
    featureFlags: flags,
    unsupportedFeatures: [],
    ambiguousAtlasObjects: [],
    recommendedProfile: importRecommendation.recommendedProfile,
    sourceRoles: importRecommendation.sourceRoles,
    importRecommendation,
  };
};

const ambiguousAtlasObjects = (
  map: TiledJsonMap,
  tilesets: readonly LoadedTileset[],
): readonly TiledScanAmbiguousAtlasObject[] => {
  const windows = buildTilesetWindows(
    tilesets.map(({ ref, tileset }) => ({
      firstgid: ref.firstgid,
      tilecount: tileset.tilecount,
      name: tileset.name,
    })),
  );
  const byName = new Map(tilesets.map(({ tileset }) => [tileset.name, tileset] as const));
  const objects = flattenLayers(map.layers).flatMap((layer) =>
    layer.type === "objectgroup" ? layer.objects.map((object) => ({ layer, object })) : [],
  );
  return objects.flatMap(({ layer, object }): readonly TiledScanAmbiguousAtlasObject[] => {
    if (object.gid === undefined) return [];
    const located = locateTiledGid(object.gid, windows);
    if (!located) return [];
    const tileset = byName.get(located.window.name);
    if (!tileset || tileset.columns === 0) return [];
    const explicit = tileset.tiles?.find((tile) => tile.id === located.localId);
    if (boolProperty(explicit?.properties, "tileborne.placeable")) return [];
    const sizeLooksObject =
      (object.width ?? tileset.tilewidth) > tileset.tilewidth ||
      (object.height ?? tileset.tileheight) > tileset.tileheight;
    if (!sizeLooksObject) return [];
    return [
      {
        tilesetName: tileset.name,
        localTileId: located.localId,
        objectId: object.id,
        path: `/layers/${layer.name}/objects/${object.id}`,
        message: "Atlas tile object is ambiguous; add tileborne.placeable=true or use a plugin profile.",
      },
    ];
  });
};

export const scanTiledSource = async (input: TiledScanSourceInput): Promise<{
  readonly scan?: TiledImportScan;
  readonly diagnostics: readonly ParseDiagnostic[];
}> => {
  if (input.raw === undefined && input.reader?.readDirectory && !input.sourcePath.toLowerCase().match(/\.(tmx|tmj|tsx|tsj|json)$/)) {
    const entries = await walkDirectory(input.sourcePath, input.reader);
    const tileSources = entries
      .filter((entry) => entry.kind === "file" && isSupportedTilesetSource(entry.path))
      .sort((left, right) => left.path.localeCompare(right.path));
    const mapSources = entries
      .filter((entry) => {
        const lower = entry.path.toLowerCase();
        return entry.kind === "file" && (lower.endsWith(".tmx") || lower.endsWith(".tmj"));
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    const diagnostics: ParseDiagnostic[] = [];
    const tilesets: LoadedTileset[] = [];
    for (const sourcePath of tileSources.map((entry) => entry.path)) {
      const loaded = await loadStandaloneTileset(
        { ...input, sourcePath },
        await readExternalText(input.reader.readFile, sourcePath),
      );
      diagnostics.push(...loaded.diagnostics);
      if (loaded.tileset) tilesets.push(loaded.tileset);
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { diagnostics };
    }
    return {
      scan: buildScanFromTilesets({
        sourceKind: "source-folder",
        sourcePath: input.sourcePath,
        maps: mapSources.map((entry) => ({ path: entry.path, width: 0, height: 0, tileWidth: 0, tileHeight: 0 })),
        tilesets,
      }),
      diagnostics,
    };
  }
  const raw =
    input.raw ??
    (input.reader ? await readExternalText(input.reader.readFile, input.sourcePath) : undefined);
  if (raw === undefined) {
    return {
      diagnostics: [
        {
          _tag: "TiledParseError",
          path: input.sourcePath,
          message: "scanTiledSource requires raw input or a reader",
          severity: "error",
          format: input.sourcePath.toLowerCase().endsWith(".tmx") ? "tmx" : "tmj",
        },
      ],
    };
  }
  const lowerSourcePath = input.sourcePath.toLowerCase();
  const parsedJsonMap = lowerSourcePath.endsWith(".json") ? parseJsonMap(raw) : undefined;
  if (parsedJsonMap?.map === undefined && isSupportedTilesetSource(input.sourcePath)) {
    const loaded = await loadStandaloneTileset(input, raw);
    if (!loaded.tileset) return { diagnostics: loaded.diagnostics };
    return {
      scan: buildScanFromTilesets({
        sourceKind: "tileset",
        sourcePath: input.sourcePath,
        maps: [],
        tilesets: [loaded.tileset],
      }),
      diagnostics: loaded.diagnostics,
    };
  }
  const parsed = lowerSourcePath.endsWith(".tmx") || raw.trimStart().startsWith("<")
    ? parseXmlMap(raw)
    : (parsedJsonMap ?? parseJsonMap(raw));
  if (!parsed.map) {
    return { diagnostics: parsed.diagnostics };
  }
  const loaded = await loadTilesets(parsed.map, input);
  if (loaded.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics: [...parsed.diagnostics, ...loaded.diagnostics] };
  }
  const tilesets = loaded.tilesets;
  const flags = featureFlagsFor(parsed.map, tilesets);
  const unsupported = unsupportedFeatures(flags);
  const ambiguous = ambiguousAtlasObjects(parsed.map, tilesets);
  const layers = flattenLayers(parsed.map.layers);
  const placeableCandidates = scanPlaceables(tilesets);
  const scannedTilesets = tilesets.map(scanTileset);
  const categories = scanCategories(parsed.map, tilesets);
  const objectLayers = layers.flatMap((layer): readonly TiledScanObjectLayer[] =>
    layer.type === "objectgroup"
      ? [
          {
            name: layer.name ?? "objects",
            objectCount: layer.objects.length,
            gidObjectCount: layer.objects.filter((object: TiledJsonObject) => object.gid !== undefined).length,
            categories: layer.objects
              .flatMap((object) =>
                collectCategoryValues({
                  class: object.class,
                  type: object.type,
                  properties: object.properties,
                }).map((category) => categoryId(category.label)),
              )
              .filter((value, index, values) => values.indexOf(value) === index)
              .sort(),
            confidence: layer.objects.length === 0 ? 0.8 : 0.95,
          },
        ]
      : [],
  );
  const inventory = {
    mapCount: 1,
    tilesetCount: scannedTilesets.length,
    gridAtlasCount: scannedTilesets.filter((tileset) => tileset.kind === "grid").length,
    imageCollectionCount: scannedTilesets.filter((tileset) => tileset.kind === "image-collection").length,
    wangSetCount: scannedTilesets.reduce((count, tileset) => count + tileset.wangSetCount, 0),
    terrainClassCount: scannedTilesets.reduce((count, tileset) => count + tileset.terrainClassCount, 0),
    animationCount: scannedTilesets.reduce((count, tileset) => count + tileset.animationCount, 0),
    collisionObjectCount: scannedTilesets.reduce((count, tileset) => count + tileset.collisionObjectCount, 0),
    objectLayerCount: objectLayers.length,
    placeableCandidateCount: placeableCandidates.length,
    unsupportedFeatureCount: unsupported.length,
  };
  const confidence = unsupported.length > 0 ? 0.2 : ambiguous.length > 0 ? 0.65 : 0.95;
  const diagnostics: ParseDiagnostic[] = [
    ...parsed.diagnostics,
    ...loaded.diagnostics,
    ...unsupported.map((feature) => ({
      _tag: "TiledUnsupportedFeature" as const,
      path: feature.path,
      message: feature.message,
      severity: "error" as const,
      feature: feature.feature,
    })),
    ...ambiguous.map((entry) => ({
      _tag: "TiledAmbiguousAtlasObject" as const,
      path: entry.path,
      message: entry.message,
      severity: "warning" as const,
      tilesetName: entry.tilesetName,
      localTileId: entry.localTileId,
      ...(entry.objectId === undefined ? {} : { objectId: entry.objectId }),
    })),
  ];
  const importRecommendation = importRecommendationFor({
    maps: [
      {
        path: input.sourcePath,
        width: parsed.map.width,
        height: parsed.map.height,
        tileWidth: parsed.map.tilewidth,
        tileHeight: parsed.map.tileheight,
      },
    ],
    tilesets: scannedTilesets,
    objectLayers,
    placeableCandidates,
    unsupportedFeatures: unsupported,
    ambiguousAtlasObjects: ambiguous,
  });
  return {
    scan: {
      sourceKind: "map",
      sourcePath: input.sourcePath,
      maps: [
        {
          path: input.sourcePath,
          width: parsed.map.width,
          height: parsed.map.height,
          tileWidth: parsed.map.tilewidth,
          tileHeight: parsed.map.tileheight,
        },
      ],
      tilesets: scannedTilesets,
      imageAssets: scanImageAssets(tilesets),
      objectLayers,
      placeableCandidates,
      categories,
      inventory,
      confidence,
      featureFlags: flags,
      unsupportedFeatures: unsupported,
      ambiguousAtlasObjects: ambiguous,
      recommendedProfile: importRecommendation.recommendedProfile,
      sourceRoles: importRecommendation.sourceRoles,
      importRecommendation,
    },
    diagnostics,
  };
};

export const tilesetSeedForScan = (source: string | undefined, fallback: string): string =>
  source === undefined ? fallback : tilesetIdFromSource(source);

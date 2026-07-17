import type { AssetId, TileborneMap } from '@tileborne/core';

/** Raw Tiled JSON shapes consumed by the Tileborne SDK importer. */

export type TiledJsonProperty = {
  readonly name: string;
  readonly type: 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object' | 'class';
  readonly value: string | number | boolean;
  readonly propertytype?: string;
};

export type TiledJsonFrame = {
  readonly tileid: number;
  readonly duration: number;
};

export type TiledJsonObject = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly gid?: number;
  readonly width?: number;
  readonly height?: number;
  readonly type?: string;
  readonly name?: string;
  readonly class?: string;
  readonly ellipse?: boolean;
  readonly point?: boolean;
  readonly polygon?: readonly { readonly x: number; readonly y: number }[];
  readonly polyline?: readonly { readonly x: number; readonly y: number }[];
  readonly properties?: readonly TiledJsonProperty[];
  readonly rotation?: number;
  readonly template?: string;
};

export type TiledJsonObjectGroup = {
  readonly type: 'objectgroup';
  readonly id?: number;
  readonly name?: string;
  readonly class?: string;
  readonly draworder?: 'topdown' | 'index';
  readonly objects: readonly TiledJsonObject[];
};

export type TiledJsonTile = {
  readonly id: number;
  readonly type?: string;
  readonly class?: string;
  readonly image?: string;
  readonly imagewidth?: number;
  readonly imageheight?: number;
  readonly probability?: number;
  readonly animation?: readonly TiledJsonFrame[];
  readonly objectgroup?: TiledJsonObjectGroup;
  readonly properties?: readonly TiledJsonProperty[];
};

export type TiledJsonWangColor = {
  readonly name: string;
  readonly color: string;
  readonly tile: number;
  readonly probability?: number;
  readonly class?: string;
};

export type TiledJsonWangTile = {
  readonly tileid: number;
  readonly wangid: readonly number[];
};

export type TiledJsonWangSet = {
  readonly name: string;
  readonly type?: 'corner' | 'edge' | 'mixed';
  readonly class?: string;
  readonly tile?: number;
  readonly colors: readonly TiledJsonWangColor[];
  readonly wangtiles: readonly TiledJsonWangTile[];
};

export type TiledJsonTileset = {
  readonly type?: 'tileset';
  readonly name: string;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly tilecount: number;
  readonly columns: number;
  readonly margin?: number;
  readonly spacing?: number;
  readonly image?: string;
  readonly imagewidth?: number;
  readonly imageheight?: number;
  readonly tiles?: readonly TiledJsonTile[];
  readonly wangsets?: readonly TiledJsonWangSet[];
  readonly properties?: readonly TiledJsonProperty[];
  readonly version?: string;
  readonly tiledversion?: string;
  readonly class?: string;
};

export type TiledJsonTilesetRef = {
  readonly firstgid: number;
  readonly source?: string;
} & Partial<TiledJsonTileset>;

export type TiledJsonLayerBase = {
  readonly id?: number;
  readonly name: string;
  readonly class?: string;
  readonly opacity?: number;
  readonly visible?: boolean;
  readonly properties?: readonly TiledJsonProperty[];
  readonly offsetx?: number;
  readonly offsety?: number;
  readonly parallaxx?: number;
  readonly parallaxy?: number;
};

export type TiledJsonTileLayer = TiledJsonLayerBase & {
  readonly type: 'tilelayer';
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[];
  readonly encoding?: 'csv' | 'base64';
  readonly compression?: string;
  readonly chunks?: readonly unknown[];
};

export type TiledJsonImageLayer = TiledJsonLayerBase & {
  readonly type: 'imagelayer';
  readonly image: string;
  readonly x?: number;
  readonly y?: number;
};

export type TiledJsonGroupLayer = TiledJsonLayerBase & {
  readonly type: 'group';
  readonly layers: readonly TiledJsonAnyLayer[];
};

export type TiledJsonAnyLayer =
  | TiledJsonTileLayer
  | (TiledJsonObjectGroup & TiledJsonLayerBase)
  | TiledJsonImageLayer
  | TiledJsonGroupLayer;

export type TiledJsonMap = {
  readonly type: 'map';
  readonly version: string;
  readonly tiledversion?: string;
  readonly orientation: 'orthogonal' | 'isometric' | 'staggered' | 'hexagonal';
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly infinite?: boolean;
  readonly tilesets: readonly TiledJsonTilesetRef[];
  readonly layers: readonly TiledJsonAnyLayer[];
  readonly properties?: readonly TiledJsonProperty[];
  readonly class?: string;
};

export const TILED_FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
export const TILED_FLIPPED_VERTICALLY_FLAG = 0x40000000;
export const TILED_FLIPPED_DIAGONALLY_FLAG = 0x20000000;
export const TILED_ROTATED_HEXAGONAL_120_FLAG = 0x10000000;
export const TILED_GID_MASK = 0x0fffffff;

export type TiledExternalReader = {
  readonly readFile: (path: string) => Promise<string | Uint8Array> | string | Uint8Array;
  readonly readDirectory?: (
    path: string,
  ) => Promise<readonly TiledExternalDirectoryEntry[]> | readonly TiledExternalDirectoryEntry[];
  readonly realpath?: (path: string) => Promise<string> | string;
};

export type TiledExternalDirectoryEntry =
  | string
  | {
      readonly name: string;
      readonly path?: string;
      readonly kind: 'file' | 'directory';
    };

export type TiledImportOptions = {
  readonly packIdSeed: string;
  readonly packName?: string;
  readonly packVersion?: string;
  readonly projectRoot: string;
  readonly sourcePath: string;
  readonly reader?: TiledExternalReader;
  readonly profile?: TiledImportProfile | undefined;
  readonly validateImagePaths?: boolean;
};

export type TiledImportProfile =
  | 'standard'
  | 'standard-plus-hints'
  | 'assistive-infer'
  | { readonly kind: 'plugin'; readonly id: string };
export type TiledObjectAnchor = 'top-left' | 'bottom-left' | 'center';
export type TiledCanonicalObjectAnchor = 'top-left';

export type TiledMapCell = {
  readonly rawGid: number;
  readonly gid: number;
  readonly tileIndex: number;
  readonly localTileIndex: number;
  readonly tilesetName: string;
  readonly transform: TiledGidTransform;
};

export type TiledGidTransform = {
  readonly flippedHorizontal: boolean;
  readonly flippedVertical: boolean;
  readonly flippedDiagonal: boolean;
  readonly rotatedHexagonal120: boolean;
};

export type TiledMapTileLayer = {
  readonly kind: 'tile';
  readonly id: string;
  readonly name: string;
  readonly class?: string;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly opacity: number;
  readonly cells: readonly TiledMapCell[];
  readonly properties: Readonly<Record<string, string | number | boolean>>;
};

export type TiledMapObjectRole = 'spawn' | 'prop' | 'object';

export type TiledObjectTileRef = {
  readonly rawGid: number;
  readonly gid: number;
  readonly localTileIndex: number;
  readonly tilesetName: string;
  readonly transform: TiledGidTransform;
};

export type TiledObjectPlacementRef = {
  readonly placeableId: string;
  readonly source: 'tiled-object';
  readonly assetId: string;
  readonly tileId: string;
  readonly gid: number;
  readonly anchor: TiledCanonicalObjectAnchor;
  readonly transform: TiledGidTransform;
};

export type TiledMapObject = {
  readonly kind: 'object';
  readonly id: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly layerVisible: boolean;
  readonly layerOpacity: number;
  readonly name: string;
  readonly role: TiledMapObjectRole;
  readonly class?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly anchor?: TiledCanonicalObjectAnchor;
  readonly gid?: number;
  readonly tileRef?: TiledObjectTileRef;
  readonly placement?: TiledObjectPlacementRef;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
};

export type TiledMapImageLayer = {
  readonly kind: 'image';
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly assetId: AssetId;
  readonly x?: number;
  readonly y?: number;
  readonly visible: boolean;
  readonly opacity: number;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
};

export type TiledMapGroupLayer = {
  readonly kind: 'group';
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly layers: readonly TiledMapLayer[];
  readonly properties: Readonly<Record<string, string | number | boolean>>;
};

export type TiledMapLayer =
  | TiledMapTileLayer
  | TiledMapObject
  | TiledMapImageLayer
  | TiledMapGroupLayer;

export type TiledMapImport = {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly orientation: TiledJsonMap['orientation'];
  readonly layers: readonly TiledMapLayer[];
  readonly properties: Readonly<Record<string, string | number | boolean>>;
};

export type TiledImportSuccess = {
  readonly pack: import('../schemas/tileset-pack.js').TilesetPack;
  readonly map: TileborneMap;
  readonly tiledMap: TiledMapImport;
};

export type TiledImportRecommendedProfile = TiledImportProfile | 'plugin-required';

export type TiledImportSourceRoleKind =
  | 'paintable-tileset'
  | 'placeable-object'
  | 'map-context'
  | 'review-required';

export type TiledImportSourceRoleEvidence =
  | 'grid-tileset'
  | 'image-collection'
  | 'tileborne-placeable-hint'
  | 'object-layer'
  | 'ambiguous-atlas-object'
  | 'unsupported-feature';

export type TiledImportBrowseTarget = 'tilesets' | 'objects' | 'maps' | 'review';

export type TiledImportSourceRole = {
  readonly kind: TiledImportSourceRoleKind;
  readonly evidence: TiledImportSourceRoleEvidence;
  readonly confidence: number;
  readonly count: number;
  readonly tilesetName?: string;
  readonly layerName?: string;
  readonly browseTarget: TiledImportBrowseTarget;
  readonly reviewRequired: boolean;
  readonly rationale: string;
};

export type TiledImportPrimaryAction =
  | 'import-paintable-tilesets'
  | 'import-placeable-objects'
  | 'import-mixed-assets'
  | 'review-before-import'
  | 'choose-plugin-profile';

export type TiledImportRecommendation = {
  readonly sourceRoles: readonly TiledImportSourceRole[];
  readonly recommendedProfile: TiledImportRecommendedProfile;
  readonly primaryAction: TiledImportPrimaryAction;
  readonly browseTarget: TiledImportBrowseTarget;
  readonly rationale: string;
  readonly reviewRequired: boolean;
};

export type TiledScanTileset = {
  readonly name: string;
  readonly firstgid: number;
  readonly kind: 'grid' | 'image-collection';
  readonly tileCount: number;
  readonly columns: number;
  readonly wangSetCount: number;
  readonly terrainClassCount: number;
  readonly animationCount: number;
  readonly collisionObjectCount: number;
  readonly categories: readonly string[];
  readonly confidence: number;
  readonly source?: string;
};

export type TiledScanImageAssetRef = {
  readonly path: string;
  readonly tilesetName: string;
  readonly localTileId?: number;
};

export type TilesetFrameIndex = {
  readonly tilesetName: string;
  readonly tilesetPath?: string;
  readonly localTileId: number;
  readonly image?: string;
  readonly probability?: number;
  readonly animationFrameCount: number;
  readonly collisionObjectCount: number;
  readonly wangSetNames: readonly string[];
};

export type TiledSourceInventoryTileset = {
  readonly name: string;
  readonly path?: string;
  readonly kind: 'grid' | 'image-collection';
  readonly tileCount: number;
  readonly frameCount: number;
  readonly imageCollectionTileCount: number;
  readonly wangSetCount: number;
  readonly animationCount: number;
  readonly animationFrameCount: number;
  readonly tileProbabilityCount: number;
  readonly wangColorProbabilityCount: number;
  readonly collisionObjectCount: number;
};

export type TiledSourceInventoryRule = {
  readonly path: string;
  readonly kind: 'rules-index' | 'rule-map';
};

export type TiledSourceInventory = {
  readonly summary: {
    readonly tilesetCount: number;
    readonly tileCount: number;
    readonly frameCount: number;
    readonly imageCollectionTileCount: number;
    readonly wangSetCount: number;
    readonly animationCount: number;
    readonly animationFrameCount: number;
    readonly tileProbabilityCount: number;
    readonly wangColorProbabilityCount: number;
    readonly collisionObjectCount: number;
    readonly ruleMapCount: number;
    readonly rulesIndexCount: number;
    readonly exampleMapCount: number;
  };
  readonly tilesets: readonly TiledSourceInventoryTileset[];
  readonly frames: readonly TilesetFrameIndex[];
  readonly rules: readonly TiledSourceInventoryRule[];
  readonly exampleMaps: readonly {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
  }[];
};

export type TiledScanObjectLayer = {
  readonly name: string;
  readonly objectCount: number;
  readonly gidObjectCount: number;
  readonly categories: readonly string[];
  readonly confidence: number;
};

export type TiledScanPlaceableCandidate = {
  readonly tilesetName: string;
  readonly localTileId: number;
  readonly source: 'image-collection' | 'tileborne-hint';
  readonly image?: string;
  readonly width: number;
  readonly height: number;
  readonly category?: string;
  readonly confidence: number;
};

export type TiledScanCategory = {
  readonly id: string;
  readonly label: string;
  readonly source: 'class' | 'type' | 'property' | 'tileborne-hint';
  readonly count: number;
  readonly confidence: number;
};

export type TiledScanFeatureFlags = {
  readonly gridAtlas: boolean;
  readonly imageCollection: boolean;
  readonly wangSets: boolean;
  readonly animations: boolean;
  readonly collisionObjectgroups: boolean;
  readonly templates: boolean;
  readonly rotation: boolean;
  readonly parallax: boolean;
  readonly infiniteChunks: boolean;
  readonly unsupportedOrientation: boolean;
  readonly classProperties: boolean;
  readonly projectFiles: boolean;
  readonly flipFlags: boolean;
};

export type TiledUnsupportedFeatureId =
  | 'templates'
  | 'infinite-chunks'
  | 'rotation'
  | 'parallax'
  | 'orientation'
  | 'class-properties'
  | 'project-files';

export type TiledScanUnsupportedFeature = {
  readonly feature: TiledUnsupportedFeatureId;
  readonly path: string;
  readonly message: string;
  readonly action: string;
};

export type TiledScanAmbiguousAtlasObject = {
  readonly tilesetName: string;
  readonly localTileId: number;
  readonly objectId?: number;
  readonly path: string;
  readonly message: string;
};

export type TiledImportScan = {
  readonly sourceKind: 'map' | 'tileset' | 'source-folder';
  readonly sourcePath: string;
  readonly maps: readonly {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
  }[];
  readonly tilesets: readonly TiledScanTileset[];
  readonly imageAssets: readonly TiledScanImageAssetRef[];
  readonly objectLayers: readonly TiledScanObjectLayer[];
  readonly placeableCandidates: readonly TiledScanPlaceableCandidate[];
  readonly categories: readonly TiledScanCategory[];
  readonly inventory: {
    readonly mapCount: number;
    readonly tilesetCount: number;
    readonly gridAtlasCount: number;
    readonly imageCollectionCount: number;
    readonly wangSetCount: number;
    readonly terrainClassCount: number;
    readonly animationCount: number;
    readonly collisionObjectCount: number;
    readonly objectLayerCount: number;
    readonly placeableCandidateCount: number;
    readonly unsupportedFeatureCount: number;
  };
  readonly confidence: number;
  readonly featureFlags: TiledScanFeatureFlags;
  readonly unsupportedFeatures: readonly TiledScanUnsupportedFeature[];
  readonly ambiguousAtlasObjects: readonly TiledScanAmbiguousAtlasObject[];
  readonly recommendedProfile: TiledImportRecommendedProfile;
  readonly sourceRoles: readonly TiledImportSourceRole[];
  readonly importRecommendation: TiledImportRecommendation;
  readonly sourceInventory?: TiledSourceInventory;
};

export type TiledImportPlanMapping = {
  readonly tilesets: readonly {
    readonly name: string;
    readonly kind: TiledScanTileset['kind'];
    readonly categoryIds: readonly string[];
    readonly paintable: boolean;
    readonly placeable: boolean;
    readonly confidence: number;
  }[];
  readonly categories: readonly TiledScanCategory[];
  readonly placeables: readonly TiledScanPlaceableCandidate[];
  readonly maps: TiledImportScan['maps'];
};

export type TiledImportPlanSuggestion = {
  readonly id: string;
  readonly block: 'tileset' | 'placeable' | 'category' | 'object-layer';
  readonly target: string;
  readonly action: string;
  readonly reason: string;
  readonly confidence: number;
  readonly source: 'assistive-infer';
};

export type TiledImportPlanHints = {
  readonly acceptedSuggestionIds?: readonly string[] | undefined;
};

export type TiledImportPlan = {
  readonly schemaVersion: 1;
  readonly sourcePath: string;
  readonly profile: TiledImportProfile;
  readonly scan: TiledImportScan;
  readonly importRecommendation: TiledImportRecommendation;
  readonly mappings: TiledImportPlanMapping;
  readonly suggestions: readonly TiledImportPlanSuggestion[];
  readonly acceptedSuggestionIds: readonly string[];
  readonly diagnostics: readonly import('../diagnostics.js').ParseDiagnostic[];
};

export type TiledAppliedImportPlan = {
  readonly schemaVersion: 1;
  readonly sourcePath: string;
  readonly profile: TiledImportProfile;
  readonly selectedMapPath: string;
  readonly scan: TiledImportScan;
  readonly importRecommendation: TiledImportRecommendation;
  readonly mappings: TiledImportPlanMapping;
  readonly acceptedSuggestions: readonly TiledImportPlanSuggestion[];
  readonly diagnostics: readonly import('../diagnostics.js').ParseDiagnostic[];
};

export type TiledCanonicalImport = {
  readonly kind: 'map';
  readonly scan: TiledImportScan;
  readonly pack: import('../schemas/tileset-pack.js').TilesetPack;
  readonly map: TileborneMap;
  readonly tiledMap: TiledMapImport;
  readonly diagnostics: readonly import('../diagnostics.js').ParseDiagnostic[];
};

export type TiledSourcePackRuleRef = {
  readonly path: string;
  readonly kind: 'rules-index' | 'rule-map';
  readonly raw: string;
};

export type TiledTilesetPackImport = {
  readonly kind: 'tileset-pack';
  readonly scan: TiledImportScan;
  readonly pack: import('../schemas/tileset-pack.js').TilesetPack;
  readonly diagnostics: readonly import('../diagnostics.js').ParseDiagnostic[];
};

export type TiledSourcePackImport = {
  readonly kind: 'source-pack';
  readonly scan: TiledImportScan;
  readonly pack: import('../schemas/tileset-pack.js').TilesetPack;
  readonly sourceRoot: string;
  readonly rules: readonly TiledSourcePackRuleRef[];
  readonly diagnostics: readonly import('../diagnostics.js').ParseDiagnostic[];
};

export type TiledAnyCanonicalImport =
  | TiledCanonicalImport
  | TiledTilesetPackImport
  | TiledSourcePackImport;

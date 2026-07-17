export type DiagnosticSeverity = 'error' | 'warning' | 'info';

type DiagnosticBase<TTag extends string> = {
  readonly _tag: TTag;
  readonly path: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
};

export type MissingAtlas = DiagnosticBase<'MissingAtlas'> & {
  readonly atlasAssetId: string;
};

export type InvalidCellSize = DiagnosticBase<'InvalidCellSize'> & {
  readonly width: number;
  readonly height: number;
};

export type UnknownAutotilePattern = DiagnosticBase<'UnknownAutotilePattern'> & {
  readonly pattern: string;
};

export type VariantWeightOutOfRange = DiagnosticBase<'VariantWeightOutOfRange'> & {
  readonly filterId: string;
  readonly weightIndex: number;
  readonly weight: number;
};

export type AnimationFrameOutOfBounds = DiagnosticBase<'AnimationFrameOutOfBounds'> & {
  readonly animationId: string;
  readonly frameIndex: number;
};

export type DuplicateTileId = DiagnosticBase<'DuplicateTileId'> & {
  readonly tileId: string;
};

export type CollisionMaskSizeMismatch = DiagnosticBase<'CollisionMaskSizeMismatch'> & {
  readonly tileId: string;
  readonly expected: number;
  readonly actual: number;
};

export type InvalidCollisionVertex = DiagnosticBase<'InvalidCollisionVertex'> & {
  readonly tileId: string;
  readonly axis: 'x1' | 'y1' | 'x2' | 'y2';
  readonly value: number;
  readonly max: number;
};

export type InvalidUvRect = DiagnosticBase<'InvalidUvRect'> & {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type InvalidMarginSpacing = DiagnosticBase<'InvalidMarginSpacing'> & {
  readonly margin: number;
  readonly spacing: number;
};

export type DuplicateAutotileRuleId = DiagnosticBase<'DuplicateAutotileRuleId'> & {
  readonly ruleId: string;
};

export type VariantWeightCountMismatch = DiagnosticBase<'VariantWeightCountMismatch'> & {
  readonly filterId: string;
  readonly tileCount: number;
  readonly weightCount: number;
};

export type InvalidAtlasGrid = DiagnosticBase<'InvalidAtlasGrid'> & {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly margin: number;
  readonly spacing: number;
  readonly columns: number;
  readonly rows: number;
};

export type InvalidPngImage = DiagnosticBase<'InvalidPngImage'> & {
  readonly width?: number;
  readonly height?: number;
};

export type EmptyVariantSelection = DiagnosticBase<'EmptyVariantSelection'> & {
  readonly filterId: string;
};

export type TiledExternalRefBlocked = DiagnosticBase<'TiledExternalRefBlocked'> & {
  readonly source: string;
  readonly resolvedPath: string;
};

export type TiledUnsupportedCompression = DiagnosticBase<'TiledUnsupportedCompression'> & {
  readonly layerName: string;
  readonly compression: string;
};

export type TiledParseError = DiagnosticBase<'TiledParseError'> & {
  readonly format: 'tmj' | 'tmx' | 'tsj' | 'tsx';
};

export type TiledUnsupportedFeature = DiagnosticBase<'TiledUnsupportedFeature'> & {
  readonly feature: string;
};

export type TiledAmbiguousAtlasObject = DiagnosticBase<'TiledAmbiguousAtlasObject'> & {
  readonly tilesetName: string;
  readonly localTileId: number;
  readonly objectId?: number;
};

export type MissingTerrainClassRef = DiagnosticBase<'MissingTerrainClassRef'> & {
  readonly terrainClass: string;
};

export type MissingTransitionRule = DiagnosticBase<'MissingTransitionRule'> & {
  readonly fromClass: string;
  readonly toClass: string;
};

export type InvalidManifestField = DiagnosticBase<'InvalidManifestField'>;

export type LdtkUnmappedAutoRule = DiagnosticBase<'LdtkUnmappedAutoRule'> & {
  readonly ruleUid: number;
  readonly layerUid: number;
  readonly reason: string;
};

export type LdtkExternalLevelMissing = DiagnosticBase<'LdtkExternalLevelMissing'> & {
  readonly externalRelPath: string;
};

export type LdtkExternalRefBlocked = DiagnosticBase<'LdtkExternalRefBlocked'> & {
  readonly externalRelPath: string;
  readonly resolvedPath: string;
};

export type LdtkInvalidProject = DiagnosticBase<'LdtkInvalidProject'>;

export type UnknownRpgmSetKind = DiagnosticBase<'UnknownRpgmSetKind'> & {
  readonly set: string;
};

export type MalformedAutotileLayout = DiagnosticBase<'MalformedAutotileLayout'> & {
  readonly pattern: string;
  readonly expectedCells: number;
  readonly actualCells: number;
};

export type TiledSourceWallRuleUnmapped = DiagnosticBase<'TiledSourceWallRuleUnmapped'> & {
  readonly rulePath: string;
  readonly reason: string;
};

export type TiledSourceMissingImageRef = DiagnosticBase<'TiledSourceMissingImageRef'> & {
  readonly imagePath: string;
  readonly sourcePath: string;
};

export type TiledSourceTsxParseError = DiagnosticBase<'TiledSourceTsxParseError'> & {
  readonly sourcePath: string;
};

export type TiledSourceMetadataCompileError = DiagnosticBase<'TiledSourceMetadataCompileError'> & {
  readonly sourcePath: string;
  readonly localTileId: number;
};

export type ParseDiagnostic =
  | MissingAtlas
  | InvalidCellSize
  | UnknownAutotilePattern
  | VariantWeightOutOfRange
  | AnimationFrameOutOfBounds
  | DuplicateTileId
  | CollisionMaskSizeMismatch
  | InvalidCollisionVertex
  | InvalidUvRect
  | InvalidMarginSpacing
  | DuplicateAutotileRuleId
  | VariantWeightCountMismatch
  | InvalidAtlasGrid
  | InvalidPngImage
  | EmptyVariantSelection
  | TiledExternalRefBlocked
  | TiledUnsupportedCompression
  | TiledParseError
  | TiledUnsupportedFeature
  | TiledAmbiguousAtlasObject
  | MissingTerrainClassRef
  | MissingTransitionRule
  | InvalidManifestField
  | LdtkUnmappedAutoRule
  | LdtkExternalLevelMissing
  | LdtkExternalRefBlocked
  | LdtkInvalidProject
  | UnknownRpgmSetKind
  | MalformedAutotileLayout
  | TiledSourceWallRuleUnmapped
  | TiledSourceMissingImageRef
  | TiledSourceTsxParseError
  | TiledSourceMetadataCompileError;

export type ParseResult<A> = {
  readonly value?: A;
  readonly diagnostics: ReadonlyArray<ParseDiagnostic>;
};

export const formatDiagnostic = (diagnostic: ParseDiagnostic): string =>
  `[${diagnostic.severity}] ${diagnostic.path}: ${diagnostic.message}`;

export const diagnosticTag = (diagnostic: ParseDiagnostic): ParseDiagnostic['_tag'] =>
  diagnostic._tag;

export const assertParseDiagnosticExhaustive = (diagnostic: ParseDiagnostic): void => {
  switch (diagnostic._tag) {
    case 'MissingAtlas':
    case 'InvalidCellSize':
    case 'UnknownAutotilePattern':
    case 'VariantWeightOutOfRange':
    case 'AnimationFrameOutOfBounds':
    case 'DuplicateTileId':
    case 'CollisionMaskSizeMismatch':
    case 'InvalidCollisionVertex':
    case 'InvalidUvRect':
    case 'InvalidMarginSpacing':
    case 'DuplicateAutotileRuleId':
    case 'VariantWeightCountMismatch':
    case 'InvalidAtlasGrid':
    case 'InvalidPngImage':
    case 'EmptyVariantSelection':
    case 'TiledExternalRefBlocked':
    case 'TiledUnsupportedCompression':
    case 'TiledParseError':
    case 'TiledUnsupportedFeature':
    case 'TiledAmbiguousAtlasObject':
    case 'MissingTerrainClassRef':
    case 'MissingTransitionRule':
    case 'InvalidManifestField':
    case 'LdtkUnmappedAutoRule':
    case 'LdtkExternalLevelMissing':
    case 'LdtkExternalRefBlocked':
    case 'LdtkInvalidProject':
    case 'UnknownRpgmSetKind':
    case 'MalformedAutotileLayout':
    case 'TiledSourceWallRuleUnmapped':
    case 'TiledSourceMissingImageRef':
    case 'TiledSourceTsxParseError':
    case 'TiledSourceMetadataCompileError':
      return;
    default: {
      const unreachable: never = diagnostic;
      throw new Error(`Unhandled ParseDiagnostic tag: ${String(unreachable)}`);
    }
  }
};

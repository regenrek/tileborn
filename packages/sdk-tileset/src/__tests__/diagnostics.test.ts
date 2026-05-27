import { describe, expect, it } from "vitest";

import {
  assertParseDiagnosticExhaustive,
  diagnosticTag,
  formatDiagnostic,
  type ParseDiagnostic,
} from "../diagnostics.js";

const diagnostics: readonly ParseDiagnostic[] = [
  {
    _tag: "MissingAtlas",
    path: "/tilesets/0/atlasAssetId",
    message: "Atlas asset is not declared in pack assets",
    severity: "error",
    atlasAssetId: "asset:62656465-0000-4000-8000-000000000001",
  },
  {
    _tag: "InvalidCellSize",
    path: "/tilesets/0/cellSize",
    message: "Cell size must be positive",
    severity: "error",
    width: 0,
    height: 32,
  },
  {
    _tag: "UnknownAutotilePattern",
    path: "/tilesets/0/autotileRules/0",
    message: "Unsupported autotile pattern",
    severity: "error",
    pattern: "wang3corner",
  },
  {
    _tag: "VariantWeightOutOfRange",
    path: "/tilesets/0/variantFilters/0/weights/1",
    message: "Variant weight must be non-negative",
    severity: "warning",
    filterId: "variant-filter:62656465-0000-4000-8000-000000000005",
    weightIndex: 1,
    weight: -1,
  },
  {
    _tag: "AnimationFrameOutOfBounds",
    path: "/tilesets/0/tiles/0/animation/frames/2",
    message: "Animation frame references an unknown tile",
    severity: "error",
    animationId: "animation:62656465-0000-4000-8000-000000000006",
    frameIndex: 2,
  },
  {
    _tag: "DuplicateTileId",
    path: "/tilesets/0/tiles/3/id",
    message: "Duplicate tile id in tileset",
    severity: "error",
    tileId: "tile:62656465-0000-4000-8000-000000000001",
  },
  {
    _tag: "CollisionMaskSizeMismatch",
    path: "/tilesets/0/tiles/0/collisionMask",
    message: "Collision mask edge count does not match tile size",
    severity: "error",
    tileId: "tile:62656465-0000-4000-8000-000000000001",
    expected: 4,
    actual: 2,
  },
  {
    _tag: "InvalidCollisionVertex",
    path: "/tilesets/0/tiles/1/collisionMask",
    message: "Collision polygon vertex x2=40 is outside tile bounds 32x32",
    severity: "error",
    tileId: "tile:62656465-0000-4000-8000-000000000002",
    axis: "x2",
    value: 40,
    max: 32,
  },
  {
    _tag: "InvalidUvRect",
    path: "/tilesets/0/tiles/0/uv",
    message: "UV rect must have positive width and height",
    severity: "error",
    x: 0,
    y: 0,
    w: 0,
    h: 32,
  },
  {
    _tag: "InvalidMarginSpacing",
    path: "/tilesets/0",
    message: "Margin and spacing must be non-negative",
    severity: "warning",
    margin: -1,
    spacing: 0,
  },
  {
    _tag: "DuplicateAutotileRuleId",
    path: "/tilesets/0/autotileRules/2/id",
    message: "Duplicate autotile rule id in tileset",
    severity: "error",
    ruleId: "autotile-rule:62656465-0000-4000-8000-000000000004",
  },
  {
    _tag: "VariantWeightCountMismatch",
    path: "/tilesets/0/variantFilters/0",
    message: "Variant filter weights must match tile id count",
    severity: "error",
    filterId: "variant-filter:62656465-0000-4000-8000-000000000005",
    tileCount: 2,
    weightCount: 1,
  },
  {
    _tag: "InvalidAtlasGrid",
    path: "/atlas",
    message: "Atlas image is too small for the declared tile count",
    severity: "error",
    imageWidth: 32,
    imageHeight: 32,
    cellWidth: 16,
    cellHeight: 16,
    margin: 0,
    spacing: 0,
    columns: 4,
    rows: 2,
  },
  {
    _tag: "InvalidPngImage",
    path: "/atlas/png",
    message: "PNG signature is invalid",
    severity: "error",
  },
  {
    _tag: "EmptyVariantSelection",
    path: "/variantFilters/variant-filter:62656465-0000-4000-8000-000000000005",
    message: "No positive variant weights; using first tile as fallback",
    severity: "warning",
    filterId: "variant-filter:62656465-0000-4000-8000-000000000005",
  },
  {
    _tag: "TiledExternalRefBlocked",
    path: "../../outside.tsx",
    message: "External reference must not contain path traversal segments",
    severity: "error",
    source: "../../outside.tsx",
    resolvedPath: "outside.tsx",
  },
  {
    _tag: "TiledUnsupportedCompression",
    path: "/layers/ground/data",
    message: 'Layer uses unsupported compression "zstd"',
    severity: "warning",
    layerName: "ground",
    compression: "zstd",
  },
  {
    _tag: "TiledParseError",
    path: "/",
    message: "Tiled map must have type \"map\"",
    severity: "error",
    format: "tmj",
  },
  {
    _tag: "MissingTerrainClassRef",
    path: "/tiles/0/terrainClass",
    message: "Terrain class is not declared in terrainClasses: sand",
    severity: "error",
    terrainClass: "sand",
  },
  {
    _tag: "InvalidManifestField",
    path: "/id",
    message: "Missing required field",
    severity: "error",
  },
  {
    _tag: "MalformedAutotileLayout",
    path: "/autotile/blob47",
    message: "Expected 47 atlas cells for blob47, received 40",
    severity: "error",
    pattern: "blob47",
    expectedCells: 47,
    actualCells: 40,
  },
  {
    _tag: "UnknownRpgmSetKind",
    path: "/autotile/rpgm",
    message: 'Unknown RPG Maker autotile set kind "A9"',
    severity: "error",
    set: "A9",
  },
];

describe("ParseDiagnostic formatting", () => {
  for (const diagnostic of diagnostics) {
    it(`formats ${diagnostic._tag}`, () => {
      expect(formatDiagnostic(diagnostic)).toBe(
        `[${diagnostic.severity}] ${diagnostic.path}: ${diagnostic.message}`,
      );
      expect(diagnosticTag(diagnostic)).toBe(diagnostic._tag);
      expect(() => assertParseDiagnosticExhaustive(diagnostic)).not.toThrow();
    });
  }

  it("covers all diagnostic tags exhaustively", () => {
    expect(new Set(diagnostics.map((diagnostic) => diagnostic._tag)).size).toBe(diagnostics.length);
  });
});

import { createPngBuffer } from "../image-info.js";
import type { SliceAtlasParams } from "../slice.js";

export type AtlasSliceFixture = {
  readonly name: string;
  readonly params: SliceAtlasParams;
  readonly png?: Uint8Array;
  readonly expectedTiles?: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  readonly expectedColumns?: number;
  readonly expectedRows?: number;
  readonly expectedTotalTiles?: number;
  readonly expectedDiagnosticTag?: string;
};

/** 64x64 image, 16x16 cells, no margin or spacing — 4x4 perfect grid. */
export const perfectGrid16: AtlasSliceFixture = {
  name: "perfect-grid-16",
  params: {
    imageWidth: 64,
    imageHeight: 64,
    cellWidth: 16,
    cellHeight: 16,
    margin: 0,
    spacing: 0,
  },
  png: createPngBuffer(64, 64),
  expectedColumns: 4,
  expectedRows: 4,
  expectedTotalTiles: 16,
  expectedTiles: [
    { x: 0, y: 0, w: 16, h: 16 },
    { x: 16, y: 0, w: 16, h: 16 },
    { x: 32, y: 0, w: 16, h: 16 },
    { x: 48, y: 0, w: 16, h: 16 },
    { x: 0, y: 16, w: 16, h: 16 },
    { x: 16, y: 16, w: 16, h: 16 },
    { x: 32, y: 16, w: 16, h: 16 },
    { x: 48, y: 16, w: 16, h: 16 },
    { x: 0, y: 32, w: 16, h: 16 },
    { x: 16, y: 32, w: 16, h: 16 },
    { x: 32, y: 32, w: 16, h: 16 },
    { x: 48, y: 32, w: 16, h: 16 },
    { x: 0, y: 48, w: 16, h: 16 },
    { x: 16, y: 48, w: 16, h: 16 },
    { x: 32, y: 48, w: 16, h: 16 },
    { x: 48, y: 48, w: 16, h: 16 },
  ],
};

/** 68x68 image, 32x32 cells, 1px margin and 2px spacing — 2x2 grid. */
export const grid32MarginSpacing: AtlasSliceFixture = {
  name: "grid-32-margin-spacing",
  params: {
    imageWidth: 68,
    imageHeight: 68,
    cellWidth: 32,
    cellHeight: 32,
    margin: 1,
    spacing: 2,
  },
  png: createPngBuffer(68, 68),
  expectedColumns: 2,
  expectedRows: 2,
  expectedTotalTiles: 4,
  expectedTiles: [
    { x: 1, y: 1, w: 32, h: 32 },
    { x: 35, y: 1, w: 32, h: 32 },
    { x: 1, y: 35, w: 32, h: 32 },
    { x: 35, y: 35, w: 32, h: 32 },
  ],
};

/** 72x44 image, 16x16 cells, 4px margin and 2px spacing — 3x2 grid. */
export const grid16Margin4Spacing2: AtlasSliceFixture = {
  name: "grid-16-margin4-spacing2",
  params: {
    imageWidth: 72,
    imageHeight: 44,
    cellWidth: 16,
    cellHeight: 16,
    margin: 4,
    spacing: 2,
  },
  png: createPngBuffer(72, 44),
  expectedColumns: 3,
  expectedRows: 2,
  expectedTotalTiles: 6,
  expectedTiles: [
    { x: 4, y: 4, w: 16, h: 16 },
    { x: 22, y: 4, w: 16, h: 16 },
    { x: 40, y: 4, w: 16, h: 16 },
    { x: 4, y: 22, w: 16, h: 16 },
    { x: 22, y: 22, w: 16, h: 16 },
    { x: 40, y: 22, w: 16, h: 16 },
  ],
};

/** 64x32 image, 16x16 cells, 7 tiles in a 4-column layout (incomplete last row). */
export const incompleteLastRow: AtlasSliceFixture = {
  name: "incomplete-last-row",
  params: {
    imageWidth: 64,
    imageHeight: 32,
    cellWidth: 16,
    cellHeight: 16,
    margin: 0,
    spacing: 0,
    columns: 4,
    tileCount: 7,
  },
  png: createPngBuffer(64, 32),
  expectedColumns: 4,
  expectedRows: 2,
  expectedTotalTiles: 7,
  expectedTiles: [
    { x: 0, y: 0, w: 16, h: 16 },
    { x: 16, y: 0, w: 16, h: 16 },
    { x: 32, y: 0, w: 16, h: 16 },
    { x: 48, y: 0, w: 16, h: 16 },
    { x: 0, y: 16, w: 16, h: 16 },
    { x: 16, y: 16, w: 16, h: 16 },
    { x: 32, y: 16, w: 16, h: 16 },
  ],
};

/** Invalid cell width. */
export const invalidCellWidthZero: AtlasSliceFixture = {
  name: "invalid-cell-width-zero",
  params: {
    imageWidth: 64,
    imageHeight: 64,
    cellWidth: 0,
    cellHeight: 16,
    margin: 0,
    spacing: 0,
  },
  expectedDiagnosticTag: "InvalidCellSize",
};

/** Image too small for declared tile count. */
export const invalidImageTooSmall: AtlasSliceFixture = {
  name: "invalid-image-too-small",
  params: {
    imageWidth: 32,
    imageHeight: 32,
    cellWidth: 16,
    cellHeight: 16,
    margin: 0,
    spacing: 0,
    columns: 4,
    tileCount: 8,
  },
  expectedDiagnosticTag: "InvalidAtlasGrid",
};

export const atlasSliceFixtures = [
  perfectGrid16,
  grid32MarginSpacing,
  grid16Margin4Spacing2,
  incompleteLastRow,
  invalidCellWidthZero,
  invalidImageTooSmall,
] as const;

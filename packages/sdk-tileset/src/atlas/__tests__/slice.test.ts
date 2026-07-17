import { describe, expect, it } from 'vitest';

import { diagnosticTag } from '../../diagnostics.js';
import { atlasSliceFixtures } from '../__fixtures__/slice-fixtures.js';
import { createPngBuffer, readPngDimensions } from '../image-info.js';
import { sliceAtlas, type SliceAtlasParams } from '../slice.js';

describe('readPngDimensions', () => {
  it('reads width and height from a minimal PNG buffer', () => {
    const buffer = createPngBuffer(128, 96);
    const result = readPngDimensions(buffer);

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toEqual({ width: 128, height: 96 });
  });

  it('rejects buffers without a PNG signature', () => {
    const result = readPngDimensions(new Uint8Array([1, 2, 3, 4]));

    expect(result.value).toBeUndefined();
    expect(diagnosticTag(result.diagnostics[0]!)).toBe('InvalidPngImage');
  });
});

describe('sliceAtlas fixtures', () => {
  for (const fixture of atlasSliceFixtures) {
    it(`handles ${fixture.name}`, () => {
      if (fixture.png) {
        const pngInfo = readPngDimensions(fixture.png);
        expect(pngInfo.diagnostics).toEqual([]);
        expect(pngInfo.value?.width).toBe(fixture.params.imageWidth);
        expect(pngInfo.value?.height).toBe(fixture.params.imageHeight);
      }

      const result = sliceAtlas(fixture.params);

      if (fixture.expectedDiagnosticTag) {
        expect(result.value).toBeUndefined();
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(diagnosticTag(result.diagnostics[0]!)).toBe(fixture.expectedDiagnosticTag);
        return;
      }

      expect(result.diagnostics).toEqual([]);
      expect(result.value).toBeDefined();
      expect(result.value?.columns).toBe(fixture.expectedColumns);
      expect(result.value?.rows).toBe(fixture.expectedRows);
      expect(result.value?.totalTiles).toBe(fixture.expectedTotalTiles);
      expect(result.value?.tiles).toEqual(fixture.expectedTiles);
    });
  }
});

describe('sliceAtlas properties', () => {
  it('derives columns and rows from image dimensions when omitted', () => {
    const result = sliceAtlas({
      imageWidth: 72,
      imageHeight: 44,
      cellWidth: 16,
      cellHeight: 16,
      margin: 4,
      spacing: 2,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.value?.columns).toBe(3);
    expect(result.value?.rows).toBe(2);
    expect(result.value?.totalTiles).toBe(6);
  });

  it('passes through firstGid when provided', () => {
    const result = sliceAtlas({
      imageWidth: 32,
      imageHeight: 32,
      cellWidth: 16,
      cellHeight: 16,
      margin: 0,
      spacing: 0,
      firstGid: 17,
    });

    expect(result.value?.firstGid).toBe(17);
  });

  it('rejects negative margin with InvalidMarginSpacing', () => {
    const result = sliceAtlas({
      imageWidth: 64,
      imageHeight: 64,
      cellWidth: 16,
      cellHeight: 16,
      margin: -1,
      spacing: 0,
    });

    expect(diagnosticTag(result.diagnostics[0]!)).toBe('InvalidMarginSpacing');
  });
});

const isValidSliceConfig = (params: SliceAtlasParams): boolean => {
  if (params.cellWidth <= 0 || params.cellHeight <= 0) return false;
  if (params.margin < 0 || params.spacing < 0) return false;
  const columns = Math.floor(
    (params.imageWidth - params.margin * 2 + params.spacing) / (params.cellWidth + params.spacing),
  );
  const rows = Math.floor(
    (params.imageHeight - params.margin * 2 + params.spacing) /
      (params.cellHeight + params.spacing),
  );
  return columns > 0 && rows > 0;
};

describe('sliceAtlas arbitrary valid configs', () => {
  it('returns one UV rect per grid cell for valid dimensions', () => {
    const configs: SliceAtlasParams[] = [
      { imageWidth: 48, imageHeight: 48, cellWidth: 16, cellHeight: 16, margin: 0, spacing: 0 },
      { imageWidth: 70, imageHeight: 46, cellWidth: 16, cellHeight: 16, margin: 4, spacing: 2 },
      {
        imageWidth: 100,
        imageHeight: 50,
        cellWidth: 10,
        cellHeight: 10,
        margin: 0,
        spacing: 0,
        tileCount: 15,
      },
    ];

    for (const params of configs) {
      if (!isValidSliceConfig(params)) continue;
      const result = sliceAtlas(params);
      expect(result.diagnostics).toEqual([]);
      expect(result.value?.tiles.length).toBe(result.value?.totalTiles);
      for (const tile of result.value?.tiles ?? []) {
        expect(tile.w).toBe(params.cellWidth);
        expect(tile.h).toBe(params.cellHeight);
        expect(tile.x).toBeGreaterThanOrEqual(params.margin);
        expect(tile.y).toBeGreaterThanOrEqual(params.margin);
        expect(tile.x + tile.w).toBeLessThanOrEqual(params.imageWidth - params.margin);
        expect(tile.y + tile.h).toBeLessThanOrEqual(params.imageHeight - params.margin);
      }
    }
  });
});

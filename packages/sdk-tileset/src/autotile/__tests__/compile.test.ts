import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeTileId, type Uuid } from '@tileborne/core';

import { diagnosticTag } from '../../diagnostics.js';
import { AutotileRuleId, TerrainClass } from '../../schemas/index.js';
import {
  Around8Bits,
  BLOB47_MASK_TO_TILE_INDEX,
  compileAutotileRule,
  compileBlob47,
  compileRpgm,
  compileWang,
  computeMask,
  EDGE16_MASK_TO_TILE_INDEX,
  Edge4Bits,
  formatMaskKey,
  NEIGHBORHOODS,
  neighborhoodForRule,
  projectBlobMask,
  resolveAutotile,
} from '../index.js';

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const ruleId = (suffix: string) =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid(suffix)}`);
const terrain = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const baseInput = {
  id: ruleId('99'),
  name: 'compiled-rule',
  terrainClasses: [terrain('grass')],
} as const;

const cellsForCount = (count: number): readonly ReturnType<typeof tileId>[] =>
  Array.from({ length: count }, (_, index) => tileId(String(index + 1).padStart(2, '0')));

const maskFromKey = (key: string, neighborhood: typeof NEIGHBORHOODS.around8): number => {
  const sortedBits = [...neighborhood.bits].sort((left, right) => left.bit - right.bit);
  let mask = 0;
  for (let index = 0; index < sortedBits.length; index += 1) {
    if (key[index] === '1') {
      mask |= 1 << sortedBits[index]!.bit;
    }
  }
  return mask;
};

describe('compile tables', () => {
  it('maps representative blob47 masks to expected atlas indices', () => {
    const samples = [
      [0, 0],
      [1, 1],
      [85, 21],
      [255, 46],
      [projectBlobMask((1 << Around8Bits.N) | (1 << Around8Bits.E) | (1 << Around8Bits.NW)), 3],
    ] as const;

    for (const [mask, expectedIndex] of samples) {
      expect(BLOB47_MASK_TO_TILE_INDEX[projectBlobMask(mask)]).toBe(expectedIndex);
    }
  });

  it('maps representative edge16 masks to expected atlas indices', () => {
    expect(EDGE16_MASK_TO_TILE_INDEX[1 << Edge4Bits.S]).toBe(0);
    expect(EDGE16_MASK_TO_TILE_INDEX[1 << Edge4Bits.N]).toBe(8);
    expect(
      EDGE16_MASK_TO_TILE_INDEX[
        (1 << Edge4Bits.N) | (1 << Edge4Bits.E) | (1 << Edge4Bits.S) | (1 << Edge4Bits.W)
      ],
    ).toBe(6);
    expect(EDGE16_MASK_TO_TILE_INDEX[0]).toBe(12);
  });
});

describe('compileBlob47', () => {
  it('builds maskToTileIds for all 47 canonical blob masks', () => {
    const cells = cellsForCount(47);
    const result = compileBlob47({ ...baseInput, cells });

    expect(result.diagnostics).toEqual([]);
    expect(result.rule?._tag).toBe('blob47');
    expect(Object.keys(result.rule?.maskToTileIds ?? {})).toHaveLength(47);
    expect(result.debug.sourceTileIndexes).toHaveLength(47);

    for (const [maskValue, tileIndex] of Object.entries(BLOB47_MASK_TO_TILE_INDEX)) {
      const key = formatMaskKey(projectBlobMask(Number(maskValue)), NEIGHBORHOODS.around8);
      expect(result.rule?.maskToTileIds[key]).toEqual([cells[tileIndex]]);
    }
  });

  it('reports malformed layouts with wrong cell counts', () => {
    const result = compileBlob47({ ...baseInput, cells: cellsForCount(40) });

    expect(result.rule).toBeUndefined();
    expect(diagnosticTag(result.diagnostics[0]!)).toBe('MalformedAutotileLayout');
    expect(result.diagnostics[0]).toMatchObject({
      pattern: 'blob47',
      expectedCells: 47,
      actualCells: 40,
    });
  });
});

describe('compileWang', () => {
  it('compiles wang2edge entries from tiled wangids', () => {
    const entries = [
      { wangid: [1, 0, 0, 0, 1, 0, 0, 0], tileId: tileId('01'), sourceTileIndex: 4 },
      { wangid: [0, 0, 0, 0, 1, 0, 0, 0], tileId: tileId('02'), sourceTileIndex: 0 },
    ] as const;

    const result = compileWang({
      ...baseInput,
      pattern: 'wang2edge',
      entries,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.rule?._tag).toBe('wang2edge');
    expect(result.rule?.maskToTileIds['1010']).toEqual([tileId('01')]);
    expect(result.rule?.maskToTileIds['0010']).toEqual([tileId('02')]);
    expect(result.debug.sourceTileIndexes).toEqual([4, 0]);
  });

  it('compiles wang2corner and wang4corner layout atlases', () => {
    const corner = compileWang({
      ...baseInput,
      pattern: 'wang2corner',
      cells: cellsForCount(16),
    });
    const mixed = compileWang({
      ...baseInput,
      pattern: 'wang4corner',
      cells: cellsForCount(16),
    });

    expect(corner.rule?._tag).toBe('wang2corner');
    expect(mixed.rule?._tag).toBe('wang4corner');
    expect(Object.keys(corner.rule?.maskToTileIds ?? {})).toHaveLength(16);
    expect(Object.keys(mixed.rule?.maskToTileIds ?? {})).toHaveLength(16);
  });

  it('reports malformed wang layouts without entries or cells', () => {
    const result = compileWang({ ...baseInput, pattern: 'wang2edge', cells: [] });
    expect(result.rule).toBeUndefined();
    expect(diagnosticTag(result.diagnostics[0]!)).toBe('MalformedAutotileLayout');
  });
});

describe('compileRpgm', () => {
  it('compiles rpgmA2 using the blob47 manifest', () => {
    const cells = cellsForCount(47);
    const result = compileRpgm({ ...baseInput, set: 'A2', cells });

    expect(result.diagnostics).toEqual([]);
    expect(result.rule?._tag).toBe('rpgmA2');
    expect(Object.keys(result.rule?.maskToTileIds ?? {})).toHaveLength(47);
  });

  it('compiles rpgmA3 and rpgmA4 edge atlases', () => {
    const cells = cellsForCount(16);
    const a3 = compileRpgm({ ...baseInput, set: 'A3', cells });
    const a4 = compileRpgm({ ...baseInput, set: 'A4', cells });

    expect(a3.rule?._tag).toBe('rpgmA3');
    expect(a4.rule?._tag).toBe('rpgmA4');
    expect(a3.rule?.maskToTileIds['1111']).toEqual([cells[6]]);
    expect(a4.rule?.maskToTileIds['1000']).toEqual([cells[8]]);
    expect(neighborhoodForRule(a3.rule!).kind).toBe('edge4');
    expect(neighborhoodForRule(a4.rule!).kind).toBe('edge4');
  });

  it('reports malformed rpgm layouts with missing cells', () => {
    const result = compileRpgm({ ...baseInput, set: 'A3', cells: cellsForCount(12) });
    expect(result.rule).toBeUndefined();
    expect(
      result.diagnostics.some((diagnostic) => diagnostic._tag === 'MalformedAutotileLayout'),
    ).toBe(true);
  });
});

describe('compileAutotileRule end-to-end', () => {
  const representativeCases = [
    {
      label: 'wang2edge',
      source: {
        kind: 'wang' as const,
        pattern: 'wang2edge' as const,
        entries: [{ wangid: [1, 0, 0, 0, 1, 0, 0, 0], tileId: tileId('e1') }],
      },
      maskKey: '1010',
      neighborhood: NEIGHBORHOODS.edge4,
    },
    {
      label: 'wang2corner',
      source: {
        kind: 'wang' as const,
        pattern: 'wang2corner' as const,
        entries: [{ wangid: [0, 1, 0, 1, 0, 1, 0, 1], tileId: tileId('c1') }],
      },
      maskKey: '1111',
      neighborhood: NEIGHBORHOODS.corner4,
    },
    {
      label: 'wang4corner',
      source: {
        kind: 'wang' as const,
        pattern: 'wang4corner' as const,
        cells: cellsForCount(16),
      },
      maskKey: '1000',
      neighborhood: NEIGHBORHOODS.corner4,
    },
    {
      label: 'blob47',
      source: { kind: 'blob47' as const, cells: cellsForCount(47) },
      maskKey: '10101010',
      neighborhood: NEIGHBORHOODS.around8,
    },
    {
      label: 'rpgmA2',
      source: { kind: 'rpgm' as const, set: 'A2' as const, cells: cellsForCount(47) },
      maskKey: '10101010',
      neighborhood: NEIGHBORHOODS.around8,
    },
    {
      label: 'rpgmA3',
      source: { kind: 'rpgm' as const, set: 'A3' as const, cells: cellsForCount(16) },
      maskKey: '1000',
      neighborhood: NEIGHBORHOODS.edge4,
    },
    {
      label: 'rpgmA4',
      source: { kind: 'rpgm' as const, set: 'A4' as const, cells: cellsForCount(16) },
      maskKey: '1000',
      neighborhood: NEIGHBORHOODS.edge4,
    },
  ] as const;

  for (const testCase of representativeCases) {
    it(`compiles and resolves ${testCase.label} masks`, () => {
      const compiled = compileAutotileRule({
        ...baseInput,
        source: testCase.source,
        debug: { fixture: testCase.label },
      });

      expect(compiled.diagnostics).toEqual([]);
      expect(compiled.rule).toBeDefined();
      expect(compiled.debug.source).toEqual({ fixture: testCase.label });

      const mask = maskFromKey(testCase.maskKey, testCase.neighborhood);
      const expectedTileId = compiled.rule!.maskToTileIds[testCase.maskKey]?.[0];
      expect(expectedTileId).toBeDefined();

      const resolved = resolveAutotile(compiled.rule!, mask, {});
      expect(resolved.tileId).toBe(expectedTileId);
      expect(resolved.debug.fallback).toBe(false);
    });
  }

  it('resolves blob47 masks computed from neighborhood terrain', () => {
    const compiled = compileAutotileRule({
      ...baseInput,
      source: { kind: 'blob47', cells: cellsForCount(47) },
    });
    const sameTerrainAt = (dx: number, dy: number) =>
      (dx === 0 && dy === -1) || (dx === 1 && dy === 0) || (dx === -1 && dy === -1);
    const mask = computeMask(NEIGHBORHOODS.around8, sameTerrainAt);
    const key = formatMaskKey(projectBlobMask(mask), NEIGHBORHOODS.around8);
    const expected = compiled.rule!.maskToTileIds[key]?.[0];

    const resolved = resolveAutotile(compiled.rule!, mask, {});
    expect(resolved.tileId).toBe(expected);
  });

  it('returns UnknownRpgmSetKind for invalid dispatcher input', () => {
    const compiled = compileAutotileRule({
      ...baseInput,
      source: { kind: 'rpgm', set: 'A9' as 'A2', cells: cellsForCount(16) },
    });

    expect(compiled.rule).toBeUndefined();
    expect(diagnosticTag(compiled.diagnostics[0]!)).toBe('UnknownRpgmSetKind');
  });
});

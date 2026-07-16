import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeTileId, type Uuid } from '@tileborne/core';

import { Around8Bits, Edge4Bits, formatMaskKey, NEIGHBORHOODS } from '../../autotile/index.js';
import {
  AutotileRuleId,
  Blob47AutotileRule,
  TerrainClass,
  TerrainTransition,
  Wang2EdgeAutotileRule,
} from '../../schemas/index.js';
import { transitionCellsToRefresh } from '../refresh.js';
import { resolveTerrainCell } from '../transitions.js';
import type { TerrainClassRegistry } from '../types.js';

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const ruleId = (suffix: string) =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid(suffix)}`);
const terrain = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const grassToWaterRuleId = ruleId('01');
const dirtToSandRuleId = ruleId('02');
const grassToSandRuleId = ruleId('03');
const grassToStoneRuleId = ruleId('04');

const grassToWaterRule = new Blob47AutotileRule({
  id: grassToWaterRuleId,
  name: 'grass-water',
  terrainClasses: [terrain('grass'), terrain('water')],
  maskToTileIds: {
    '10000000': [tileId('30')],
    '00100000': [tileId('31')],
    '00001000': [tileId('32')],
    '00000010': [tileId('33')],
    '10100000': [tileId('34')],
    '00101000': [tileId('35')],
    '00001010': [tileId('36')],
    '10000010': [tileId('37')],
  },
  fallbackTileId: Option.none(),
});

const dirtToSandRule = new Wang2EdgeAutotileRule({
  id: dirtToSandRuleId,
  name: 'dirt-sand',
  terrainClasses: [terrain('dirt'), terrain('sand')],
  maskToTileIds: {
    '1010': [tileId('40')],
  },
  fallbackTileId: Option.none(),
});

const grassToSandRule = new Blob47AutotileRule({
  id: grassToSandRuleId,
  name: 'grass-sand',
  terrainClasses: [terrain('grass'), terrain('sand')],
  maskToTileIds: {
    '00100000': [tileId('41')],
  },
  fallbackTileId: Option.none(),
});

const grassToStoneRule = new Blob47AutotileRule({
  id: grassToStoneRuleId,
  name: 'grass-stone',
  terrainClasses: [terrain('grass'), terrain('stone')],
  maskToTileIds: {
    '00000010': [tileId('42')],
  },
  fallbackTileId: Option.none(),
});

const transitions = [
  new TerrainTransition({
    from: terrain('grass'),
    to: terrain('water'),
    ruleId: grassToWaterRuleId,
  }),
  new TerrainTransition({
    from: terrain('dirt'),
    to: terrain('sand'),
    ruleId: dirtToSandRuleId,
  }),
  new TerrainTransition({
    from: terrain('grass'),
    to: terrain('sand'),
    ruleId: grassToSandRuleId,
  }),
  new TerrainTransition({
    from: terrain('grass'),
    to: terrain('stone'),
    ruleId: grassToStoneRuleId,
  }),
];

const rulesById = new Map([
  [grassToWaterRuleId, grassToWaterRule],
  [dirtToSandRuleId, dirtToSandRule],
  [grassToSandRuleId, grassToSandRule],
  [grassToStoneRuleId, grassToStoneRule],
]);

const baseRegistry: TerrainClassRegistry = {
  baseTileForClass: (terrainClass) => {
    switch (terrainClass) {
      case terrain('grass'):
        return tileId('10');
      case terrain('water'):
        return tileId('11');
      case terrain('dirt'):
        return tileId('12');
      case terrain('sand'):
        return tileId('13');
      case terrain('stone'):
        return tileId('14');
      default:
        return undefined;
    }
  },
  ruleForId: (id) => rulesById.get(id),
};

describe('resolveTerrainCell', () => {
  it('resolves grass to water edges and outer corners via autotile-derived mode', () => {
    const northEdge = resolveTerrainCell({
      cell: { x: 4, y: 4, terrainClass: terrain('grass') },
      neighbors: [{ dx: 0, dy: -1, terrainClass: terrain('water') }],
      transitions,
      classRegistry: baseRegistry,
    });

    expect(northEdge.base).toBe(tileId('10'));
    expect(northEdge.overlays).toEqual([tileId('30')]);
    expect(northEdge.debug).toEqual({
      fromClass: terrain('grass'),
      toClass: terrain('water'),
      transitionRuleId: grassToWaterRuleId,
      mode: 'autotile-derived',
    });

    const northEastCorner = resolveTerrainCell({
      cell: { x: 4, y: 4, terrainClass: terrain('grass') },
      neighbors: [
        { dx: 0, dy: -1, terrainClass: terrain('water') },
        { dx: 1, dy: 0, terrainClass: terrain('water') },
      ],
      transitions,
      classRegistry: baseRegistry,
    });

    expect(northEastCorner.overlays).toEqual([tileId('34')]);
  });

  it('uses a distinct dirt to sand transition rule for same-class-family neighbors', () => {
    const result = resolveTerrainCell({
      cell: { x: 2, y: 2, terrainClass: terrain('dirt') },
      neighbors: [
        { dx: 0, dy: -1, terrainClass: terrain('sand') },
        { dx: 0, dy: 1, terrainClass: terrain('sand') },
      ],
      transitions,
      classRegistry: baseRegistry,
    });

    expect(result.base).toBe(tileId('12'));
    expect(result.overlays).toEqual([tileId('40')]);
    expect(result.debug).toEqual({
      fromClass: terrain('dirt'),
      toClass: terrain('sand'),
      transitionRuleId: dirtToSandRuleId,
      mode: 'autotile-derived',
    });
  });

  it('resolves a three-way junction with multiple transition overlays', () => {
    const result = resolveTerrainCell({
      cell: { x: 5, y: 5, terrainClass: terrain('grass') },
      neighbors: [
        { dx: 1, dy: 0, terrainClass: terrain('sand') },
        { dx: -1, dy: 0, terrainClass: terrain('stone') },
        { dx: 0, dy: -1, terrainClass: terrain('water') },
      ],
      transitions,
      classRegistry: baseRegistry,
    });

    expect(result.base).toBe(tileId('10'));
    expect(result.overlays).toEqual([tileId('41'), tileId('42'), tileId('30')]);
    expect(result.debug.fromClass).toBe(terrain('grass'));
    expect(result.debug.toClass).toBe(terrain('sand'));
  });

  it('returns no overlays for self-transitions', () => {
    const result = resolveTerrainCell({
      cell: { x: 1, y: 1, terrainClass: terrain('grass') },
      neighbors: [
        { dx: 0, dy: -1, terrainClass: terrain('grass') },
        { dx: 1, dy: 0, terrainClass: terrain('grass') },
      ],
      transitions,
      classRegistry: baseRegistry,
    });

    expect(result.overlays).toEqual([]);
    expect(result.debug).toEqual({
      fromClass: terrain('grass'),
      toClass: terrain('grass'),
      mode: 'autotile-derived',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('emits MissingTransitionRule diagnostics and uses fallback overlays', () => {
    const result = resolveTerrainCell({
      cell: { x: 3, y: 3, terrainClass: terrain('grass') },
      neighbors: [{ dx: 0, dy: 1, terrainClass: terrain('lava') }],
      transitions,
      classRegistry: {
        ...baseRegistry,
        fallbackOverlayForClass: (toClass) =>
          toClass === terrain('lava') ? tileId('50') : undefined,
      },
    });

    expect(result.base).toBe(tileId('10'));
    expect(result.overlays).toEqual([tileId('50')]);
    expect(result.diagnostics).toEqual([
      {
        _tag: 'MissingTransitionRule',
        path: `/terrainTransitions/${terrain('grass')}->${terrain('lava')}`,
        message: `No terrain transition rule from ${terrain('grass')} to ${terrain('lava')}`,
        severity: 'warning',
        fromClass: terrain('grass'),
        toClass: terrain('lava'),
      },
    ]);
  });

  it('supports explicit-overlay mode from registry lookup tables', () => {
    const mask = (1 << Around8Bits.N) | (1 << Around8Bits.E);

    const result = resolveTerrainCell({
      cell: { x: 6, y: 6, terrainClass: terrain('grass') },
      neighbors: [
        { dx: 0, dy: -1, terrainClass: terrain('water') },
        { dx: 1, dy: 0, terrainClass: terrain('water') },
      ],
      transitions,
      classRegistry: {
        ...baseRegistry,
        transitionMode: () => 'explicit-overlay',
        overlayTilesForMask: (transition, overlayMask) => {
          if (transition.to !== terrain('water')) {
            return undefined;
          }
          return overlayMask === mask ? [tileId('60')] : undefined;
        },
      },
    });

    expect(result.overlays).toEqual([tileId('60')]);
    expect(result.debug.mode).toBe('explicit-overlay');
  });

  it('supports mask-layer mode from registry lookup tables', () => {
    const result = resolveTerrainCell({
      cell: { x: 7, y: 7, terrainClass: terrain('grass') },
      neighbors: [{ dx: 0, dy: -1, terrainClass: terrain('water') }],
      transitions,
      classRegistry: {
        ...baseRegistry,
        transitionMode: () => 'mask-layer',
        maskLayerTilesForMask: (transition) =>
          transition.to === terrain('water') ? [tileId('61')] : undefined,
      },
    });

    expect(result.overlays).toEqual([tileId('61')]);
    expect(result.debug.mode).toBe('mask-layer');
  });
});

describe('transitionCellsToRefresh', () => {
  it('returns a 9-cell around8 refresh region for blob transitions', () => {
    const changedCell = { x: 10, y: 10 };
    const refreshed = transitionCellsToRefresh({
      changedCell,
      transitions: [transitions[0]!],
      ruleForId: (id) => rulesById.get(id),
    });

    expect(refreshed).toHaveLength(9);
    expect(refreshed).toContainEqual(changedCell);
    expect(refreshed).toContainEqual({ x: 9, y: 9 });
    expect(refreshed).toContainEqual({ x: 11, y: 11 });
  });

  it('returns edge4 refresh cells for wang edge transitions', () => {
    const changedCell = { x: 4, y: 4 };
    const refreshed = transitionCellsToRefresh({
      changedCell,
      transitions: [transitions[1]!],
      ruleForId: (id) => rulesById.get(id),
    });

    expect(refreshed).toHaveLength(5);
    expect(refreshed).toContainEqual(changedCell);
    expect(refreshed).toContainEqual({ x: 4, y: 3 });
    expect(refreshed).not.toContainEqual({ x: 3, y: 3 });
  });

  it('defaults to around8 when rule lookup is unavailable', () => {
    const changedCell = { x: 0, y: 0 };
    const refreshed = transitionCellsToRefresh({
      changedCell,
      transitions: [transitions[0]!],
    });

    expect(refreshed).toHaveLength(9);
    expect(refreshed).toContainEqual(changedCell);
  });
});

describe('mask keys used by transition tests', () => {
  it('documents edge and corner mask keys for grass to water', () => {
    const north = 1 << Edge4Bits.N;
    expect(formatMaskKey(north, NEIGHBORHOODS.around8)).toBe('10000000');

    const northEast = (1 << Around8Bits.N) | (1 << Around8Bits.E);
    expect(formatMaskKey(northEast, NEIGHBORHOODS.around8)).toBe('10100000');
  });
});

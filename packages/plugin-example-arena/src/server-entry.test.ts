import { makeMapId, makeTileborneMap, type Uuid } from '@tileborne/core';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { ARENA_PLUGIN_ID } from './constants.js';
import { exportModeData, validateMap } from './server-entry.js';

const mapId = makeMapId('550e8400-e29b-41d4-a716-446655440001' as Uuid);
const arenaMap = (arenaRadius: number, enemyCount: number) =>
  makeTileborneMap({
    id: mapId,
    width: 32,
    height: 32,
    tileWidth: 16,
    tileHeight: 16,
    properties: { [ARENA_PLUGIN_ID]: { arenaRadius, enemyCount } },
  });

describe('Example Arena server contracts', () => {
  it('validates the same ranges declared by the generic settings form', () => {
    expect(validateMap(arenaMap(32, 8))).toEqual({ ok: true, issues: [] });
    const invalid = validateMap(arenaMap(2, 80));
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map(({ location }) => location)).toEqual([
      'properties.arenaRadius',
      'properties.enemyCount',
    ]);
  });

  it('exports engine-opaque modeData through the generic Ship contract', () => {
    const result = exportModeData({
      map: arenaMap(32, 8),
      catalog: [],
      placements: [],
      settings: { arenaRadius: 40, enemyCount: 12 },
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({ schemaVersion: 1, arenaRadius: 40, enemyCount: 12 });
    }
  });

  it('rejects invalid settings before packaging', () => {
    const result = exportModeData({
      map: arenaMap(32, 8),
      catalog: [],
      placements: [],
      settings: { arenaRadius: 1, enemyCount: 8 },
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

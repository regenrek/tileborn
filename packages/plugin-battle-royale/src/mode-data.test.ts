import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RuntimeCatalogEntry,
  RuntimeObjectPlacement,
  gameObjectTypeIdForKey,
  makeTileborneMap,
  type JsonObject,
  type TileborneMap,
} from '@tileborne/core';
import { ModeDataExportError } from '@tileborne/plugin-api';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOOT_TABLE,
  DEFAULT_MAX_PLAYERS,
  LOOT_CRATE_KEY,
  PLUGIN_ID,
  SHRINK_ZONE_ANCHOR_KEY,
  ZONE,
} from './constants.js';
import { TEST_MAP_ID, TEST_OBJECT_IDS } from './id-utils.js';
import {
  BattleRoyaleModeData,
  decodeBattleRoyaleModeData,
  exportBattleRoyaleModeData,
} from './mode-data.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const shippedCatalogJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'schemas/game-object-catalog.json'), 'utf8'),
) as { readonly objectTypes: readonly Record<string, unknown>[] };

/** The real BR catalog wrapped as merged runtime entries (plugin origin). */
const catalogEntries = (
  extraObjectTypes: readonly Record<string, unknown>[] = [],
): readonly RuntimeCatalogEntry[] =>
  [...shippedCatalogJson.objectTypes, ...extraObjectTypes].map((objectType) =>
    Schema.decodeUnknownSync(RuntimeCatalogEntry)({
      origin: { _tag: 'plugin', pluginId: PLUGIN_ID },
      objectType,
    }),
  );

const makePlacement = (
  objectId: string,
  typeKey: string,
  x: number,
  y: number,
  instanceProperties?: JsonObject,
): RuntimeObjectPlacement =>
  Schema.decodeUnknownSync(RuntimeObjectPlacement)({
    objectId,
    typeId: gameObjectTypeIdForKey(typeKey),
    x,
    y,
    ...(instanceProperties === undefined ? {} : { instanceProperties }),
  });

const makeMap = (properties: JsonObject = {}): TileborneMap =>
  makeTileborneMap({
    id: TEST_MAP_ID,
    width: 64,
    height: 48,
    tileWidth: 32,
    tileHeight: 32,
    properties,
  });

const exportOrThrow = (input: {
  map?: TileborneMap;
  placements?: readonly RuntimeObjectPlacement[];
  settings?: JsonObject;
  catalog?: readonly RuntimeCatalogEntry[];
}): JsonObject =>
  Result.getOrThrow(
    exportBattleRoyaleModeData({
      map: input.map ?? makeMap(),
      catalog: input.catalog ?? catalogEntries(),
      placements: input.placements ?? [],
      settings: input.settings,
    }),
  );

describe('exportBattleRoyaleModeData', () => {
  it('derives maxPlayers + config override from the namespaced settings', () => {
    const exported = exportOrThrow({
      settings: { maxPlayers: 8, zone: { damagePerSecOutside: 7, schedule: { waitSec: 45 } } },
    });
    const data = decodeBattleRoyaleModeData(exported);
    expect(data.maxPlayers).toBe(8);
    expect(data.battleRoyale?.zone?.damagePerSecOutside).toBe(7);
    expect(data.battleRoyale?.zone?.schedule?.waitSec).toBe(45);
  });

  it("falls back to the map's namespaced settings when context.settings is undefined", () => {
    const exported = exportOrThrow({
      map: makeMap({ [PLUGIN_ID]: { maxPlayers: 6 } }),
    });
    expect(decodeBattleRoyaleModeData(exported).maxPlayers).toBe(6);
  });

  it('derives the shrink schedule from the shrink-zone-anchor placement', () => {
    const exported = exportOrThrow({
      placements: [
        makePlacement(TEST_OBJECT_IDS[0], SHRINK_ZONE_ANCHOR_KEY, 10, 12, {
          initialRadiusTiles: 20,
          finalRadiusTiles: 3,
        }),
      ],
    });
    expect(decodeBattleRoyaleModeData(exported).shrinkSchedule).toEqual({
      centerX: 10,
      centerY: 12,
      startRadiusTiles: 20,
      endRadiusTiles: 3,
      shrinkIntervalMs: ZONE.shrinkIntervalMs,
      damagePerSecond: ZONE.damagePerSecond,
    });
  });

  it('defaults the shrink schedule to the map center when no anchor is placed', () => {
    const exported = exportOrThrow({});
    const data = decodeBattleRoyaleModeData(exported);
    expect(data.maxPlayers).toBe(DEFAULT_MAX_PLAYERS);
    expect(data.shrinkSchedule).toEqual({
      centerX: 32,
      centerY: 24,
      startRadiusTiles: 32,
      endRadiusTiles: 4,
      shrinkIntervalMs: ZONE.shrinkIntervalMs,
      damagePerSecond: ZONE.damagePerSecond,
    });
  });

  it('derives normalized loot tables from loot-source placements', () => {
    const exported = exportOrThrow({
      placements: [
        makePlacement(TEST_OBJECT_IDS[0], LOOT_CRATE_KEY, 4, 4, {
          itemKind: 'health-pack',
          tier: 'common',
          weight: 3,
        }),
        makePlacement(TEST_OBJECT_IDS[1], LOOT_CRATE_KEY, 8, 8, {
          itemKind: 'weapon-crate',
          tier: 'epic',
          weight: 1,
        }),
      ],
    });
    expect(decodeBattleRoyaleModeData(exported).lootTables).toEqual([
      { itemKind: 'health-pack', tier: 'common', weight: 0.75 },
      { itemKind: 'weapon-crate', tier: 'epic', weight: 0.25 },
    ]);
  });

  it('counts any catalog type carrying a loot-source component, not only the well-known crate', () => {
    const customCrate = {
      ...shippedCatalogJson.objectTypes.find(
        (objectType) => objectType.id === String(gameObjectTypeIdForKey(LOOT_CRATE_KEY)),
      )!,
      id: String(gameObjectTypeIdForKey('custom-crate')),
      label: 'Custom Crate',
    };
    const exported = exportOrThrow({
      catalog: catalogEntries([customCrate]),
      placements: [makePlacement(TEST_OBJECT_IDS[0], 'custom-crate', 4, 4, { weight: 2 })],
    });
    expect(decodeBattleRoyaleModeData(exported).lootTables).toEqual([
      { itemKind: 'supply-crate', tier: 'common', weight: 1 },
    ]);
  });

  it('falls back to the default loot table when no loot is placed', () => {
    const exported = exportOrThrow({});
    expect(decodeBattleRoyaleModeData(exported).lootTables).toEqual(DEFAULT_LOOT_TABLE);
  });

  it('rejects settings that violate BR invariants with a ModeDataExportError', () => {
    const result = exportBattleRoyaleModeData({
      map: makeMap(),
      catalog: catalogEntries(),
      placements: [],
      settings: { maxPlayers: 0 },
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ModeDataExportError);
      expect(result.failure.pluginId).toBe(PLUGIN_ID);
      expect(result.failure.message).toContain('maxPlayers must be a positive integer');
    }
  });

  it('never leaks neutral package sections into the mode data', () => {
    const exported = exportOrThrow({
      settings: { maxPlayers: 8, zone: { damagePerSecOutside: 7 } },
      placements: [
        makePlacement(TEST_OBJECT_IDS[0], SHRINK_ZONE_ANCHOR_KEY, 10, 12),
        makePlacement(TEST_OBJECT_IDS[1], LOOT_CRATE_KEY, 4, 4),
      ],
    });
    expect(Object.keys(exported).sort()).toEqual([
      'battleRoyale',
      'lootTables',
      'maxPlayers',
      'schemaVersion',
      'shrinkSchedule',
    ]);
  });

  it('round-trips the wire shape through the schema', () => {
    const exported = exportOrThrow({
      settings: { maxPlayers: 12, zone: { damagePerSecOutside: 6 } },
      placements: [
        makePlacement(TEST_OBJECT_IDS[0], SHRINK_ZONE_ANCHOR_KEY, 16, 16, {
          initialRadiusTiles: 24,
          finalRadiusTiles: 2,
        }),
        makePlacement(TEST_OBJECT_IDS[1], LOOT_CRATE_KEY, 4, 4, { weight: 1 }),
      ],
    });
    const decoded = decodeBattleRoyaleModeData(JSON.parse(JSON.stringify(exported)));
    expect(Schema.encodeSync(BattleRoyaleModeData)(decoded)).toEqual(exported);
  });
});

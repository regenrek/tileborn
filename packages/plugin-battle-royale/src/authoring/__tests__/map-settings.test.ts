import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  MapObject,
  ObjectLayer,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makeTileborneMap,
} from '@tileborne/core';

import {
  DEFAULT_MAX_PLAYERS,
  LOOT_CRATE_KIND,
  PLUGIN_ID,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
} from '../../constants.js';
import {
  applyBattleRoyaleAuthoringSettings,
  battleRoyaleObjectCounts,
  readBattleRoyaleAuthoringSettings,
} from '../map-settings.js';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix}`;
const objectLayerId = makeLayerId(uuid('446655440001'));

describe('battle royale authoring', () => {
  it('counts authored battle royale objects', () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid('446655440002')),
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      layers: [
        new ObjectLayer({
          id: objectLayerId,
          name: 'objects',
          visible: true,
          opacity: 1,
          objectIds: [
            makeObjectId(uuid('446655440003')),
            makeObjectId(uuid('446655440004')),
            makeObjectId(uuid('446655440005')),
          ],
        }),
      ],
      objects: [
        object(SPAWN_POINT_KIND, '446655440003'),
        object(SHRINK_ZONE_ANCHOR_KIND, '446655440004'),
        object(LOOT_CRATE_KIND, '446655440005'),
      ],
    });

    expect(battleRoyaleObjectCounts(map)).toEqual({
      spawnPoints: 1,
      shrinkAnchors: 1,
      lootCrates: 1,
    });
  });

  it('persists settings under the neutral per-plugin namespace, hard-cutting the legacy keys', () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid('446655440006')),
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      properties: {},
    });

    expect(readBattleRoyaleAuthoringSettings(map).maxPlayers).toBe(DEFAULT_MAX_PLAYERS);

    const next = applyBattleRoyaleAuthoringSettings(map, {
      maxPlayers: 12,
      waitSec: 15,
      shrinkSec: 20,
      holdSec: 10,
      shrinkPhases: 4,
      damagePerSecOutside: 7,
    });

    // Values persist under `map.properties.<pluginId>`, NOT the legacy keys.
    expect(next.properties[PLUGIN_ID]).toMatchObject({
      maxPlayers: 12,
      zone: {
        damagePerSecOutside: 7,
        schedule: { waitSec: 15, shrinkSec: 20, holdSec: 10, shrinkPhases: 4 },
      },
    });
    expect(next.properties.battleRoyale).toBeUndefined();
    expect(next.properties.maxPlayers).toBeUndefined();

    // Round-trips back through the reader.
    expect(readBattleRoyaleAuthoringSettings(next)).toEqual({
      maxPlayers: 12,
      waitSec: 15,
      shrinkSec: 20,
      holdSec: 10,
      shrinkPhases: 4,
      damagePerSecOutside: 7,
      matchMode: 'solo',
      respawnEnabled: false,
      matchEndPolicy: 'last-standing',
      friendlyFire: false,
      startingWeaponId: undefined,
    });
  });

  it('migrates settings from the legacy `battleRoyale` + `maxPlayers` keys on read', () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid('446655440007')),
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      properties: {
        maxPlayers: 24,
        battleRoyale: {
          zone: {
            damagePerSecOutside: 9,
            schedule: { waitSec: 12, shrinkSec: 8, holdSec: 6, shrinkPhases: 5 },
          },
        },
      },
    });

    expect(readBattleRoyaleAuthoringSettings(map)).toEqual({
      maxPlayers: 24,
      waitSec: 12,
      shrinkSec: 8,
      holdSec: 6,
      shrinkPhases: 5,
      damagePerSecOutside: 9,
      matchMode: 'solo',
      respawnEnabled: false,
      matchEndPolicy: 'last-standing',
      friendlyFire: false,
      startingWeaponId: undefined,
    });

    // A save folds the legacy override (incl. non-settings fields) into the
    // namespace and removes the legacy keys.
    const next = applyBattleRoyaleAuthoringSettings(map, {
      ...readBattleRoyaleAuthoringSettings(map),
      maxPlayers: 30,
    });
    expect(next.properties.battleRoyale).toBeUndefined();
    expect(next.properties.maxPlayers).toBeUndefined();
    expect(next.properties[PLUGIN_ID]).toMatchObject({ maxPlayers: 30 });
  });

  it('round-trips supported team, elimination and friendly-fire rules', () => {
    const map = makeTileborneMap({
      id: makeMapId(uuid('446655440010')),
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      properties: {},
    });
    const next = applyBattleRoyaleAuthoringSettings(map, {
      ...readBattleRoyaleAuthoringSettings(map),
      matchMode: 'squad',
      respawnEnabled: true,
      friendlyFire: true,
      startingWeaponId: 'weapon:550e8400-e29b-41d4-a716-446655440099',
    });

    expect(next.properties[PLUGIN_ID]).toMatchObject({
      roomRules: {
        matchMode: 'squad',
        respawnEnabled: true,
        matchEndPolicy: 'continuous',
        friendlyFire: true,
      },
      respawn: { enabled: true },
      loadout: { startingWeaponId: 'weapon:550e8400-e29b-41d4-a716-446655440099' },
    });
    expect(readBattleRoyaleAuthoringSettings(next)).toMatchObject({
      matchMode: 'squad',
      respawnEnabled: true,
      matchEndPolicy: 'continuous',
      friendlyFire: true,
      startingWeaponId: 'weapon:550e8400-e29b-41d4-a716-446655440099',
    });
  });
});

const object = (kind: MapObject['kind'], suffix: string): MapObject =>
  new MapObject({
    id: makeObjectId(uuid(suffix)),
    kind,
    x: 0,
    y: 0,
    width: Option.none(),
    height: Option.none(),
    layerId: objectLayerId,
    properties: {},
  });

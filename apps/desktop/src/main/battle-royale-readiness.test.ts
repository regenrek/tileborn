import { GameObjectType, MapObject, SpawnPointComponent, TileborneMap, gameObjectTypeIdForKey, makeGameObjectTypeId, makeLayerId, makeMapId, makeObjectId, type GameObjectTypeId, type Uuid } from '@tileborne/core';
import type { WeaponCatalogEntryView } from '@tileborne/ipc-contracts';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { diagnoseBattleRoyaleMapReadiness } from './battle-royale-readiness';

const PLUGIN_ID = '@tileborne-plugins/battle-royale';
const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;
const mapWithRules = (
  rules: Record<string, unknown>,
  teams: readonly (string | undefined)[] = [],
  spawnKind: GameObjectTypeId = gameObjectTypeIdForKey('spawn-point'),
) => new TileborneMap({
  id: makeMapId(uuid('1')),
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [],
  objects: teams.map((team, index) => new MapObject({
    id: makeObjectId(uuid(String(100 + index))),
    kind: spawnKind,
    x: 1 + (index % 4) * 2,
    y: 1 + Math.floor(index / 4) * 4,
    width: Option.none(),
    height: Option.none(),
    layerId: makeLayerId(uuid('99')),
    properties: team === undefined ? {} : { team },
  })),
  properties: { [PLUGIN_ID]: rules },
});
const weapon = (
  id: string,
  label: string,
  origin: 'plugin' | 'project',
  sourcePluginId: string | undefined,
  deliveryTag: string,
) => ({
  entry: { weapon: { id }, delivery: { _tag: deliveryTag } },
  label,
  origin,
  ...(sourcePluginId === undefined ? {} : { sourcePluginId }),
}) as unknown as WeaponCatalogEntryView;

describe('Battle Royale canonical readiness policy', () => {
  it('reports incompatible plugin weapons before playtest', () => {
    const arenaId = `weapon:${uuid('2')}`;
    const map = mapWithRules({ loadout: { startingWeaponId: arenaId } });

    const issues = diagnoseBattleRoyaleMapReadiness(map, [
      weapon(arenaId, 'Arena Blade', 'plugin', '@tileborne-plugins/example-arena', 'MeleeDelivery'),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'game-mode.battle-royale.starting-weapon.wrong-plugin',
        message: expect.stringContaining('Arena Blade belongs to another game mode'),
        path: 'loadout.startingWeaponId',
      }),
    ]);
  });

  it('reports missing and unsupported project selections but accepts project projectiles', () => {
    const missingId = `weapon:${uuid('3')}`;
    const meleeId = `weapon:${uuid('4')}`;
    const rifleId = `weapon:${uuid('5')}`;

    expect(diagnoseBattleRoyaleMapReadiness(
      mapWithRules({ loadout: { startingWeaponId: missingId } }),
      [],
    )[0]?.code).toBe('game-mode.battle-royale.starting-weapon.missing');
    expect(diagnoseBattleRoyaleMapReadiness(
      mapWithRules({ loadout: { startingWeaponId: meleeId } }),
      [weapon(meleeId, 'Project Hammer', 'project', undefined, 'MeleeDelivery')],
    )[0]?.code).toBe('game-mode.battle-royale.starting-weapon.unsupported-delivery');
    expect(diagnoseBattleRoyaleMapReadiness(
      mapWithRules({ loadout: { startingWeaponId: rifleId } }),
      [weapon(rifleId, 'Project Rifle', 'project', undefined, 'ProjectileDelivery')],
    )).toEqual([]);
  });

  it('reports an explicitly contradictory respawn match-end policy', () => {
    const map = mapWithRules({
      roomRules: { respawnEnabled: true, matchEndPolicy: 'last-standing' },
      respawn: { enabled: true },
    });

    expect(diagnoseBattleRoyaleMapReadiness(map, [])).toEqual([
      expect.objectContaining({ code: 'game-mode.battle-royale.match-end-incompatible' }),
    ]);
  });

  it('accepts eight legacy solo spawn labels as a balanced derived squad topology', () => {
    const map = mapWithRules(
      { maxPlayers: 8, roomRules: { matchMode: 'squad' } },
      Array.from({ length: 8 }, () => 'solo'),
    );

    expect(diagnoseBattleRoyaleMapReadiness(map, [])).toEqual([]);
  });

  it('reports mixed and incoherent authored squad topology before playtest', () => {
    const mixed = mapWithRules(
      { maxPlayers: 8, roomRules: { matchMode: 'squad' } },
      ['alpha', 'alpha', 'alpha', 'alpha', 'solo', 'solo', 'solo', 'solo'],
    );
    expect(diagnoseBattleRoyaleMapReadiness(mixed, []).map(({ code }) => code)).toContain(
      'game-mode.battle-royale.team-topology.mixed-authored-and-legacy-teams',
    );

    const oversized = mapWithRules(
      { maxPlayers: 8, roomRules: { matchMode: 'squad' } },
      Array.from({ length: 8 }, () => 'alpha'),
    );
    expect(diagnoseBattleRoyaleMapReadiness(oversized, []).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'game-mode.battle-royale.team-topology.wrong-team-count',
        'game-mode.battle-royale.team-topology.team-over-capacity',
      ]),
    );
  });

  it('uses component-defined project spawn types in the same readiness policy as runtime', () => {
    const customSpawnId = makeGameObjectTypeId(uuid('200'));
    const customSpawn = new GameObjectType({
      id: customSpawnId,
      schemaVersion: 1,
      label: 'Project Squad Spawn',
      family: 'marker' as GameObjectType['family'],
      category: Option.none(),
      layerHint: Option.none(),
      components: [new SpawnPointComponent({ data: {} })],
      instanceDefaults: {},
    });
    const map = mapWithRules(
      { maxPlayers: 8, roomRules: { matchMode: 'squad' } },
      Array.from({ length: 8 }, () => 'solo'),
      customSpawnId,
    );

    expect(diagnoseBattleRoyaleMapReadiness(map, [], [customSpawn])).toEqual([]);
  });
});

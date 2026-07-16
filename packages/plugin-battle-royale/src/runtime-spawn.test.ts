import {
  AssetLibraryReference,
  MapObject,
  PlayerModelClipSet,
  PlayerModelRef,
  gameObjectTypeIdForKey,
  makeClipId,
  makePackId,
  makeTileborneMap,
} from '@tileborne/core';
import { decodeServerMessage } from '@tileborne/ipc-contracts/protocols/battle-royale';
import { makeCombatEntityId, makeTeamId, type HitContext } from '@tileborne/simulation';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ABILITY,
  DAMAGE,
  DEFAULT_MAX_PLAYERS,
  MOVEMENT,
  PLUGIN_ID,
  SPAWN_POINT_KIND,
  STATUS_EFFECT,
} from './constants.js';
import { createBattleRoyaleHitPolicy } from './ecs/combat-world-view.js';
import {
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  TEAM_COMPONENT,
  VELOCITY_COMPONENT,
  type Player,
  type Team,
} from './ecs/components.js';
import {
  createDamageSystemState,
  recordMatchStarters,
  runDamageSystem,
} from './ecs/damage-system.js';
import {
  countAlivePlayers,
  resolveSpawnSlots,
  spawnPlayersFromArtifact,
} from './ecs/spawn-players.js';
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from './id-utils.js';
import { createRuntimeAdapter } from './runtime-adapter.js';
import { buildTestMapPackage, buildTestRuntimeArtifact } from './test-map-package.js';
import { createTestPluginWorld } from './test-plugin-world.js';

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
  properties: MapObject['properties'] = {},
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties,
  });

const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);
const packId = makePackId('550e8400-e29b-41d4-a716-446655440999');

const testModel = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id,
    ref: new AssetLibraryReference({
      packId,
      kind: 'sprite',
      refId: 'placeable:hero',
      clipId: clipIdAt(0),
    }),
    defaultClipId: clipIdAt(0),
    clips: new PlayerModelClipSet({
      idle: clipIdAt(0),
      walk: clipIdAt(1),
      run: clipIdAt(2),
      shoot: clipIdAt(3),
      reload: clipIdAt(4),
      hit: clipIdAt(5),
      death: clipIdAt(6),
      dash: clipIdAt(7),
      pickup: clipIdAt(8),
    }),
    anchor: { x: 0.5, y: 1 },
    hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
  });

const playerModels = [testModel('model:default'), testModel('model:hero')] as const;

const exportRuntimeArtifact = (
  map = makeSpawnFixtureMap(),
  options: { readonly selectedPlayerModelId?: string } = {},
) =>
  buildTestRuntimeArtifact(map, {
    playerModels,
    ...(options.selectedPlayerModelId === undefined
      ? {}
      : { selectedPlayerModelId: options.selectedPlayerModelId }),
  });

const makeRuntimeMapPackage = (
  map = makeSpawnFixtureMap(),
  options: { readonly playerModels?: readonly PlayerModelRef[] } = {},
) => buildTestMapPackage({ map, playerModels: options.playerModels ?? playerModels });

const makeSpawnFixtureMap = () =>
  makeTileborneMap({
    id: TEST_MAP_ID,
    width: 32,
    height: 32,
    tileWidth: 32,
    tileHeight: 32,
    objects: [
      makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 4, 1),
      makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 2, 3),
      makeTestObject(TEST_OBJECT_IDS[2], SPAWN_POINT_KIND, 6, 2),
      makeTestObject(TEST_OBJECT_IDS[3], 'shrink-zone-anchor', 16, 16),
    ],
    properties: { maxPlayers: DEFAULT_MAX_PLAYERS },
  });

describe('spawnPlayersFromArtifact', () => {
  it('instantiates one Player entity per spawn marker up to maxPlayers', () => {
    const artifact = exportRuntimeArtifact();
    const world = createTestPluginWorld();

    const entities = spawnPlayersFromArtifact(world, artifact);

    expect(entities).toHaveLength(3);
    expect(countAlivePlayers(world)).toBe(3);

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    const positions = world.getComponent(POSITION_COMPONENT);
    const velocities = world.getComponent(VELOCITY_COMPONENT);

    for (const entity of entities) {
      const player = players.get(entity);
      expect(player?.alive).toBe(1);
      expect(player?.health).toBe(DAMAGE.playerHealth);
      expect(typeof player?.playerId).toBe('string');

      const position = positions.get(entity);
      expect(position).toBeDefined();
      expect(Number.isFinite(position?.x)).toBe(true);
      expect(Number.isFinite(position?.y)).toBe(true);

      const velocity = velocities.get(entity);
      expect(velocity).toEqual({ vx: 0, vy: 0 });
    }
  });

  it('assigns selected and default model ids onto spawned players', () => {
    const artifact = exportRuntimeArtifact(undefined, { selectedPlayerModelId: 'model:hero' });
    const world = createTestPluginWorld();

    const entities = spawnPlayersFromArtifact(world, artifact);

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    // The local player selection wins; the rest use the artifact default.
    expect(players.get(entities[0]!)?.modelId).toBe('model:hero');
    expect(players.get(entities[1]!)?.modelId).toBe('model:default');
    expect(players.get(entities[2]!)?.modelId).toBe('model:default');
  });

  it('sorts authored spawn anchors deterministically', () => {
    const artifact = exportRuntimeArtifact();
    const slots = resolveSpawnSlots(artifact);

    expect(slots).toEqual([
      { x: 4, y: 1 },
      { x: 6, y: 2 },
      { x: 2, y: 3 },
    ]);
  });

  it('chooses a spread-out spawn subset when room rules use fewer players than markers', () => {
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 64,
      height: 64,
      tileWidth: 32,
      tileHeight: 32,
      properties: { maxPlayers: 3 },
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 1, 1),
        makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 2, 1),
        makeTestObject(TEST_OBJECT_IDS[2], SPAWN_POINT_KIND, 3, 1),
        makeTestObject(TEST_OBJECT_IDS[3], SPAWN_POINT_KIND, 40, 1),
        makeTestObject(TEST_OBJECT_IDS[4], SPAWN_POINT_KIND, 1, 40),
        makeTestObject(TEST_OBJECT_IDS[5], SPAWN_POINT_KIND, 40, 40),
        makeTestObject(TEST_OBJECT_IDS[6], 'shrink-zone-anchor', 16, 16),
      ],
    });
    const artifact = exportRuntimeArtifact(map);

    expect(resolveSpawnSlots(artifact)).toEqual([
      { x: 1, y: 1 },
      { x: 40, y: 40 },
      { x: 40, y: 1 },
    ]);
  });

  it('caps spawns at maxPlayers from room rules', () => {
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      properties: { maxPlayers: 2 },
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 1, 1),
        makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 2, 2),
        makeTestObject(TEST_OBJECT_IDS[2], SPAWN_POINT_KIND, 3, 3),
        makeTestObject(TEST_OBJECT_IDS[3], 'shrink-zone-anchor', 16, 16),
      ],
    });
    const artifact = exportRuntimeArtifact(map);
    const world = createTestPluginWorld();

    spawnPlayersFromArtifact(world, artifact);

    expect(countAlivePlayers(world)).toBe(2);
  });
});

describe('createRuntimeAdapter', () => {
  it('uses one canonical squad identity for spawn assignment, friendly fire, and match end', () => {
    const squadMap = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 64,
      height: 64,
      tileWidth: 32,
      tileHeight: 32,
      objects: TEST_OBJECT_IDS.map((id, index) =>
        makeTestObject(id, SPAWN_POINT_KIND, 4 + (index % 4) * 12, 4 + Math.floor(index / 4) * 40, {
          team: 'solo',
        }),
      ),
      properties: {
        [PLUGIN_ID]: {
          maxPlayers: 8,
          roomRules: {
            matchMode: 'squad',
            friendlyFire: false,
            respawnEnabled: false,
            matchEndPolicy: 'last-standing',
          },
        },
      },
    });
    const world = createTestPluginWorld();
    const plugin = createRuntimeAdapter({ getMapPackage: () => makeRuntimeMapPackage(squadMap) });

    plugin.onInit?.({ pluginId: plugin.id }, world);

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    const teams = world.getComponent<Team>(TEAM_COMPONENT);
    const roster = [...players.entries()]
      .map(([entity, player]) => ({ entity, player, team: teams.get(entity)?.team }))
      .sort((left, right) => left.player.playerId.localeCompare(right.player.playerId));
    expect(roster).toHaveLength(8);
    expect(new Set(roster.map(({ team }) => team))).toEqual(new Set(['team-1', 'team-2']));
    expect(roster.filter(({ team }) => team === 'team-1')).toHaveLength(4);
    expect(roster.filter(({ team }) => team === 'team-2')).toHaveLength(4);
    for (const { player, team } of roster) expect(player.team).toBe(team);

    const sameTeam = roster.filter(({ team }) => team === roster[0]!.team);
    const opponent = roster.find(({ team }) => team !== roster[0]!.team)!;
    const hitContext = (
      source: (typeof roster)[number],
      target: (typeof roster)[number],
    ): HitContext => ({
      source: Option.some(makeCombatEntityId(source.entity)),
      sourceTeam: Option.some(makeTeamId(source.team!)),
      target: makeCombatEntityId(target.entity),
      targetTeam: Option.some(makeTeamId(target.team!)),
    });
    const friendlyFireOff = createBattleRoyaleHitPolicy({
      matchMode: 'squad',
      friendlyFire: false,
      respawnEnabled: false,
      matchEndPolicy: 'last-standing',
    });
    expect(friendlyFireOff.isHostile(hitContext(sameTeam[0]!, sameTeam[1]!))).toBe(false);
    expect(friendlyFireOff.isHostile(hitContext(sameTeam[0]!, opponent))).toBe(true);
    expect(
      createBattleRoyaleHitPolicy({
        matchMode: 'squad',
        friendlyFire: true,
        respawnEnabled: false,
        matchEndPolicy: 'last-standing',
      }).isHostile(hitContext(sameTeam[0]!, sameTeam[1]!)),
    ).toBe(true);

    const frames: Uint8Array[] = [];
    const damageState = createDamageSystemState();
    const damageContext = {
      msgOut: { push: (frame: Uint8Array) => frames.push(frame) },
      roomRules: {
        matchMode: 'squad' as const,
        friendlyFire: false,
        respawnEnabled: false,
        matchEndPolicy: 'last-standing' as const,
      },
    };
    recordMatchStarters(world, damageState);
    const losingTeam = sameTeam;
    for (const [index, victim] of losingTeam.entries()) {
      players.set(victim.entity, { ...victim.player, health: 0, alive: 0 });
      damageState.pendingKills.push({
        victimEntity: victim.entity,
        victimPlayerId: victim.player.playerId,
        killerId: opponent.player.playerId,
      });
      runDamageSystem(world, index + 1, damageContext, damageState);
      const messages = frames.map(decodeServerMessage);
      if (index === 0) {
        expect(messages.filter((message) => message._tag === 'GameOver')).toHaveLength(0);
        expect(countAlivePlayers(world)).toBe(7);
      }
    }
    expect(
      frames.map(decodeServerMessage).filter((message) => message._tag === 'GameOver'),
    ).toHaveLength(1);
  });

  it('rejects packages that do not satisfy the runtime contract', () => {
    const mapWithoutSpawns = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [makeTestObject(TEST_OBJECT_IDS[0], 'shrink-zone-anchor', 16, 16)],
    });

    expect(() =>
      createRuntimeAdapter({ getMapPackage: () => makeRuntimeMapPackage(mapWithoutSpawns) }),
    ).toThrow(/spawnAnchors/);
  });

  it('rejects packages without a validated player-model roster', () => {
    const mapPackage = makeRuntimeMapPackage(makeSpawnFixtureMap(), { playerModels: [] });

    expect(() => createRuntimeAdapter({ getMapPackage: () => mapPackage })).toThrow(/playerModels/);
  });

  it('registers Player components during onInit for runtime metrics', () => {
    const world = createTestPluginWorld();
    const plugin = createRuntimeAdapter({ getMapPackage: () => makeRuntimeMapPackage() });

    plugin.onInit?.({ pluginId: plugin.id }, world);

    expect([...world.getComponent<Player>(PLAYER_COMPONENT).entries()]).toHaveLength(3);
    expect(countAlivePlayers(world)).toBe(3);
  });

  it('spawns players on first onTick when onInit lacks a world reference', () => {
    const world = createTestPluginWorld();
    const plugin = createRuntimeAdapter({ getMapPackage: () => makeRuntimeMapPackage() });

    plugin.onTick?.(world, 0, 0);

    expect(countAlivePlayers(world)).toBe(3);
  });

  it('emits runtime animation state from player input', () => {
    const world = createTestPluginWorld();
    const frames: Uint8Array[] = [];
    const plugin = createRuntimeAdapter({
      getMapPackage: () => makeRuntimeMapPackage(),
      getPlayerModelSelections: () => [{ playerId: 'player-1', modelId: 'model:hero' }],
      getPlayerInput: (playerId) =>
        playerId === 'player-1'
          ? {
              tick: 1,
              seq: 1,
              shoot: true,
              reload: false,
              interact: false,
              drop: false,
              abilities: [],
              aimDeg: 90,
              swapSlot: 1,
            }
          : undefined,
      msgOut: { push: (frame) => frames.push(frame) },
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);
    frames.length = 0;
    plugin.onTick?.(world, 1 / MOVEMENT.tickRate, 1);

    const frame = decodeServerMessage(frames.at(-1)!);
    expect(frame._tag).toBe('DeltaSnapshot');
    if (frame._tag === 'DeltaSnapshot') {
      const player = frame.updated.find((entry) => entry.id === 'player-1');
      expect(player).toBeDefined();
      expect(Option.isSome(player!.animation)).toBe(true);
      if (Option.isSome(player!.animation)) {
        expect(player!.animation.value).toMatchObject({
          modelId: 'model:hero',
          clipKey: 'shoot',
          facingDeg: 90,
          moving: false,
          aimDeg: 90,
        });
      }
    }
  });

  it('emits authored trap and decoy deployables in the welcome snapshot', () => {
    const mapPackage = makeRuntimeMapPackage(
      makeTileborneMap({
        id: TEST_MAP_ID,
        width: 32,
        height: 32,
        tileWidth: 32,
        tileHeight: 32,
        objects: [
          makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 4, 1),
          makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 2, 3),
          makeTestObject(TEST_OBJECT_IDS[2], 'shrink-zone-anchor', 16, 16),
          makeTestObject(TEST_OBJECT_IDS[3], 'trap', 5, 5, { radius: 28 }),
          makeTestObject(TEST_OBJECT_IDS[4], 'decoy', 7, 5, { durationTicks: 90 }),
        ],
        properties: { maxPlayers: 2 },
      }),
    );
    const world = createTestPluginWorld();
    const frames: Uint8Array[] = [];
    const plugin = createRuntimeAdapter({
      getMapPackage: () => mapPackage,
      msgOut: { push: (frame) => frames.push(frame) },
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);

    const frame = decodeServerMessage(frames[0]!);
    expect(frame._tag).toBe('WelcomeSnapshot');
    if (frame._tag === 'WelcomeSnapshot') {
      expect(frame.deployables?.map((deployable) => deployable.kind).sort()).toEqual([
        'decoy',
        'trap',
      ]);
    }
  });

  it('emits ability deployables and reveal status through delta snapshots', () => {
    const mapPackage = makeRuntimeMapPackage(
      makeTileborneMap({
        id: TEST_MAP_ID,
        width: 32,
        height: 32,
        tileWidth: 32,
        tileHeight: 32,
        objects: [
          makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 4, 4),
          makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 6, 4),
          makeTestObject(TEST_OBJECT_IDS[2], 'shrink-zone-anchor', 16, 16),
        ],
        properties: { maxPlayers: 2 },
      }),
    );
    const world = createTestPluginWorld();
    const frames: Uint8Array[] = [];
    let currentTick = 0;
    const plugin = createRuntimeAdapter({
      getMapPackage: () => mapPackage,
      getPlayerInput: (playerId) =>
        currentTick === 1 && playerId === 'player-1'
          ? {
              tick: 1,
              seq: 1,
              shoot: false,
              reload: false,
              interact: false,
              drop: false,
              abilities: [ABILITY.scanPulse.id, ABILITY.trap.id, ABILITY.decoy.id],
              aimDeg: 0,
            }
          : undefined,
      msgOut: { push: (frame) => frames.push(frame) },
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);
    frames.length = 0;
    currentTick = 1;
    plugin.onTick?.(world, 1 / MOVEMENT.tickRate, 1);

    const frame = decodeServerMessage(frames.at(-1)!);
    expect(frame._tag).toBe('DeltaSnapshot');
    if (frame._tag === 'DeltaSnapshot') {
      const deployableKinds = (frame.deployablesUpdated ?? []).flatMap((deployable) =>
        Option.isSome(deployable.kind) ? [deployable.kind.value] : [],
      );
      expect(deployableKinds.sort()).toEqual(['decoy', 'scan-pulse', 'trap']);
      const revealedPlayer = frame.updated.find((entry) => entry.id === 'player-2');
      expect(revealedPlayer).toBeDefined();
      expect(Option.isSome(revealedPlayer!.statusEffects)).toBe(true);
      if (Option.isSome(revealedPlayer!.statusEffects)) {
        expect(revealedPlayer!.statusEffects.value).toEqual([
          {
            effectId: STATUS_EFFECT.reveal.id,
            remainingTicks: ABILITY.scanPulse.revealTicks,
            stacks: 1,
          },
        ]);
      }
    }
  });
});

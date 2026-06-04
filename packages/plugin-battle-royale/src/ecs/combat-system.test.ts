import {
  MapObject,
  TileChunk,
  TileLayer,
  gameObjectTypeIdForKey,
  makeAssetId,
  makeTileId,
  makeTileborneMap,
  type Uuid,
} from '@tileborne/core';
import { BattleRoyaleProtocol } from '@tileborne/ipc-contracts';
import {
  BitmaskCollisionMask,
  CellSize,
  Tile,
  Tileset,
  TilesetId,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  UVRect,
} from '@tileborne/sdk-tileset/schemas';
import { CombatBlocker, createSeededRng, type ProjectileDelivery } from '@tileborne/simulation';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { DAMAGE, MOVEMENT, PROJECTILE, SPAWN_POINT_KIND } from '../constants.js';
import { DEFAULT_BATTLE_ROYALE_CONFIG } from '../battle-royale-config.js';
import {
  LAST_FACING_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  VELOCITY_COMPONENT,
  type Player,
  type Position,
  type Projectile,
} from './components.js';
import { PluginCollisionEnvironment } from './collision.js';
import {
  buildCombatBlockers,
  createBattleRoyaleCombatWorldView,
  createBattleRoyaleHitPolicy,
} from './combat-world-view.js';
import {
  createCombatSystemState,
  runCombatSystem,
  type CombatSystemContext,
  type MapBounds,
} from './combat-system.js';
import {
  createDamageSystemState,
  runDamageSystem,
  type DamageSystemState,
} from './damage-system.js';
import { resolveBattleRoyaleWeaponEntry } from '../weapon-catalog.js';
import { exportArtifact } from '../export-artifact.js';
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from '../id-utils.js';
import { createTestPluginWorld } from '../test-plugin-world.js';
import type { RuntimePlayerInput } from '../types/runtime-plugin.js';

const DT = 1 / MOVEMENT.tickRate;
const TILE_SIZE = 32;
const CONFIG = DEFAULT_BATTLE_ROYALE_CONFIG;
const WEAPON_ENTRY = resolveBattleRoyaleWeaponEntry(CONFIG);

const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;
const passableTileId = makeTileId(uuid('401'));
const blockedTileId = makeTileId(uuid('402'));

const openMapBounds = (): MapBounds => ({
  minX: -10_000,
  minY: -10_000,
  maxX: 10_000,
  maxY: 10_000,
});

const registerStores = (world: ReturnType<typeof createTestPluginWorld>): void => {
  world.registerComponent(POSITION_COMPONENT);
  world.registerComponent(VELOCITY_COMPONENT);
  world.registerComponent(PLAYER_COMPONENT);
  world.registerComponent(LAST_FACING_COMPONENT);
  world.registerComponent(PROJECTILE_COMPONENT);
};

const spawnPlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerId: string,
  x: number,
  y: number,
  health = DAMAGE.playerHealth,
  team = 'solo',
): number => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, { x, y });
  world.getComponent(VELOCITY_COMPONENT).set(entity, { vx: 0, vy: 0 });
  world.getComponent<Player>(PLAYER_COMPONENT).set(entity, { playerId, health, alive: 1, team });
  world.getComponent(LAST_FACING_COMPONENT).set(entity, { dir: 0 });
  return entity;
};

interface CtxOptions {
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly mapBounds?: MapBounds;
  readonly blockers?: ReturnType<typeof buildCombatBlockers>;
  readonly roomRules?: Parameters<typeof createBattleRoyaleHitPolicy>[0];
}

const makeContext = (
  world: ReturnType<typeof createTestPluginWorld>,
  damageState: DamageSystemState,
  options: CtxOptions = {},
): CombatSystemContext => ({
  worldView: createBattleRoyaleCombatWorldView(
    world,
    { maxHealth: CONFIG.damage.playerHealth, footprintOffsetY: CONFIG.movement.footprintOffsetY },
    options.blockers ?? [],
  ),
  policy: createBattleRoyaleHitPolicy(options.roomRules ?? CONFIG.roomRules),
  weapon: WEAPON_ENTRY.weapon,
  delivery: WEAPON_ENTRY.delivery as ProjectileDelivery,
  rng: createSeededRng(1),
  damageState,
  ...(options.getPlayerInput ? { getPlayerInput: options.getPlayerInput } : {}),
  mapBounds: options.mapBounds ?? openMapBounds(),
  weaponSlotCount: CONFIG.projectile.weaponSlotCount,
  projectileSpeedPerSecond: CONFIG.projectile.speed,
  projectileBoundsRadius: CONFIG.projectile.radius,
  dt: DT,
});

const shooterInput = (
  overrides: Partial<{
    readonly aimDeg: number;
    readonly weaponSlot: number;
    readonly shoot: boolean;
  }> = {},
) => ({ tick: 1, seq: 1, dir: 0 as const, shoot: true, ...overrides });

const inputForPlayer =
  (playerId: string, input: ReturnType<typeof shooterInput> = shooterInput()) =>
  (id: string) =>
    id === playerId ? input : undefined;

const countProjectiles = (world: ReturnType<typeof createTestPluginWorld>): number =>
  [...world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries()].length;

const projectiles = (world: ReturnType<typeof createTestPluginWorld>): readonly Projectile[] =>
  [...world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries()]
    .sort(([left], [right]) => left - right)
    .map(([, projectile]) => projectile);

const makeCollisionTilesetPack = (): TilesetPack =>
  new TilesetPack({
    schemaVersion: 1,
    id: 'pack:660e8400-e29b-41d4-a716-000000000501',
    name: 'Projectile Collision Fixture',
    version: '1.0.0',
    license: new TilesetPackLicense({
      spdxId: 'CC0-1.0',
      attribution: Option.none(),
      sourceUrl: Option.none(),
      notes: Option.none(),
      redistributable: true,
    }),
    tilesets: [
      new Tileset({
        id: Schema.decodeUnknownSync(TilesetId)('tileset:660e8400-e29b-41d4-a716-000000000502'),
        name: 'Collision',
        atlasAssetId: makeAssetId(uuid('503')),
        cellSize: new CellSize({ width: TILE_SIZE, height: TILE_SIZE }),
        margin: 0,
        spacing: 0,
        tiles: [
          new Tile({
            id: passableTileId,
            uv: new UVRect({ x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE }),
            tags: [],
            terrainClass: Option.none(),
            collisionMask: Option.none(),
            animation: Option.none(),
          }),
          new Tile({
            id: blockedTileId,
            uv: new UVRect({ x: TILE_SIZE, y: 0, w: TILE_SIZE, h: TILE_SIZE }),
            tags: [],
            terrainClass: Option.none(),
            collisionMask: Option.some(new BitmaskCollisionMask({ passable: 0, blocked: 15 })),
            animation: Option.none(),
          }),
        ],
        autotileRules: [],
        variantFilters: [],
        terrainTransitions: [],
      }),
    ],
    assets: [
      new TilesetPackAsset({
        id: makeAssetId(uuid('503')),
        path: 'tiles/projectile-collision.png',
        mime: 'image/png',
      }),
    ],
  });

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties: {},
  });

const createMsgCollector = () => {
  const frames: Uint8Array[] = [];
  return {
    msgOut: {
      push: (frame: Uint8Array) => {
        frames.push(frame);
      },
    },
    decodeAll: () => frames.map((frame) => BattleRoyaleProtocol.decodeMessage(frame)),
  };
};

describe('combat system (neutral engine)', () => {
  it('consumes the BR weapon catalog: a single projectile weapon', () => {
    expect(WEAPON_ENTRY.delivery._tag).toBe('ProjectileDelivery');
    expect(WEAPON_ENTRY.weapon.cooldownTicks).toBe(PROJECTILE.shootCooldownTicks);
    expect(WEAPON_ENTRY.weapon.damage).toBe(PROJECTILE.damage);
  });

  it('fires one projectile then gates on cooldown across contiguous ticks', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1'),
    });

    for (let tick = 1; tick <= PROJECTILE.shootCooldownTicks; tick += 1) {
      runCombatSystem(world, ctx, state);
    }
    expect(countProjectiles(world)).toBe(1);

    runCombatSystem(world, ctx, state);
    expect(countProjectiles(world)).toBe(2);
  });

  it('uses aim-only input for projectile direction', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 10, 10);
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1', shooterInput({ aimDeg: 90 })),
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(0), dirY: expect.closeTo(1), weaponSlot: 1 }),
    ]);
  });

  it('uses weapon-slot-only input while falling back to last facing direction', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 10, 10);
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1', shooterInput({ weaponSlot: 2 })),
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(1), dirY: expect.closeTo(0), weaponSlot: 2 }),
    ]);
  });

  it('uses aim and weapon slot together', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 10, 10);
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1', shooterInput({ aimDeg: 180, weaponSlot: 3 })),
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(-1), dirY: expect.closeTo(0), weaponSlot: 3 }),
    ]);
  });

  it('ignores out-of-range weapon slots', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 10, 10);
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1', shooterInput({ weaponSlot: 99 })),
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    expect(projectiles(world)).toEqual([expect.objectContaining({ weaponSlot: 1 })]);
  });

  it('moves projectiles at the configured per-second speed', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1'),
    });

    runCombatSystem(world, ctx, state);
    expect(countProjectiles(world)).toBe(1);
    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const projectileStore = world.getComponent<Projectile>(PROJECTILE_COMPONENT);
    const [projectileEntity] = [...projectileStore.entries()][0] as [number, Projectile];
    const start = positions.get(projectileEntity)!;

    const noInputCtx = makeContext(world, createDamageSystemState(), {});
    runCombatSystem(world, noInputCtx, state);
    const end = positions.get(projectileEntity)!;

    expect(end.x - start.x).toBeCloseTo(PROJECTILE.speed * DT);
    expect(end.y).toBeCloseTo(start.y);
  });

  it('damages another player, enqueues a kill, and removes the projectile', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const victim = spawnPlayer(
      world,
      'player-2',
      MOVEMENT.radius * 2 + PROJECTILE.radius,
      0,
      PROJECTILE.damage,
    );
    const damageState = createDamageSystemState();
    const collector = createMsgCollector();
    const ctx = makeContext(world, damageState, { getPlayerInput: inputForPlayer('player-1') });

    runCombatSystem(world, ctx, createCombatSystemState());
    runDamageSystem(world, 1, { msgOut: collector.msgOut }, damageState);

    expect(world.getComponent<Player>(PLAYER_COMPONENT).get(victim)).toMatchObject({
      health: 0,
      alive: 0,
    });
    expect(countProjectiles(world)).toBe(0);

    const kills = collector.decodeAll().filter((message) => message._tag === 'PlayerKilled');
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({
      killer: BattleRoyaleProtocol.makePlayerId('player-1'),
      victim: BattleRoyaleProtocol.makePlayerId('player-2'),
      tick: 1,
    });
  });

  it('never strikes the projectile owner', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const owner = spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1'),
    });

    runCombatSystem(world, ctx, state);
    for (let tick = 2; tick <= 5; tick += 1) {
      runCombatSystem(world, makeContext(world, createDamageSystemState(), {}), state);
    }

    expect(world.getComponent<Player>(PLAYER_COMPONENT).get(owner)).toMatchObject({
      health: DAMAGE.playerHealth,
      alive: 1,
    });
    expect(countProjectiles(world)).toBe(1);
  });

  it('culls projectiles when ttl expires', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();
    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1'),
      }),
      state,
    );
    expect(countProjectiles(world)).toBe(1);

    for (let tick = 2; tick <= PROJECTILE.ttlTicks + 1; tick += 1) {
      runCombatSystem(world, makeContext(world, createDamageSystemState(), {}), state);
    }
    expect(countProjectiles(world)).toBe(0);
  });

  it('culls projectiles that hit blocking map geometry', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 100, 100);
    const pack = makeCollisionTilesetPack();
    const collisionTiles = Array.from({ length: 32 * 32 }, () => 0);
    collisionTiles[3 * 32 + 4] = 2;
    const artifact = exportArtifact(
      makeTileborneMap({
        id: TEST_MAP_ID,
        width: 32,
        height: 32,
        tileWidth: TILE_SIZE,
        tileHeight: TILE_SIZE,
        layers: [
          new TileLayer({
            id: TEST_LAYER_ID,
            name: 'Ground',
            visible: true,
            opacity: 1,
            chunks: [new TileChunk({ x: 0, y: 0, width: 32, height: 32, tiles: collisionTiles })],
          }),
        ],
        objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 16, 16)],
      }),
      { tilesetPack: pack },
    );
    const blockers = buildCombatBlockers(PluginCollisionEnvironment.fromArtifact(artifact));
    expect(blockers.length).toBeGreaterThan(0);
    const state = createCombatSystemState();

    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1'),
        blockers,
      }),
      state,
    );

    for (let tick = 2; tick <= 20; tick += 1) {
      runCombatSystem(world, makeContext(world, createDamageSystemState(), { blockers }), state);
      if (countProjectiles(world) === 0) {
        return;
      }
    }
    expect(countProjectiles(world)).toBe(0);
  });

  it('culls a projectile whose radius grazes a wall its center never enters', () => {
    // ADR-0018 Slice 7 review fix: BR's projectile carries the combined
    // player+projectile collision radius (16 = MOVEMENT.radius + PROJECTILE.radius)
    // and blocking now sweeps that radius against walls. The shot flies along
    // y = 0; the wall sits 4 units off that line — inside the radius — so the
    // projectile body overlaps it and is culled. A center-only test (pre-fix)
    // would have let it tunnel past.
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const grazingWall = new CombatBlocker({
      minX: 60,
      minY: 4,
      maxX: 64,
      maxY: 400,
      blocksProjectiles: true,
      blocksVision: true,
    });
    const state = createCombatSystemState();
    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1'),
        blockers: [grazingWall],
      }),
      state,
    );
    expect(countProjectiles(world)).toBe(1);

    for (let tick = 2; tick <= 20; tick += 1) {
      runCombatSystem(
        world,
        makeContext(world, createDamageSystemState(), { blockers: [grazingWall] }),
        state,
      );
      if (countProjectiles(world) === 0) {
        return;
      }
    }
    expect(countProjectiles(world)).toBe(0);
  });

  it('does not cull a projectile passing a wall beyond its collision radius', () => {
    // The wall sits 40 units off the flight line — well outside the 16-unit
    // radius — so the projectile passes it cleanly (guards against the cull
    // over-blocking near, but not on, the path).
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const clearWall = new CombatBlocker({
      minX: 60,
      minY: 40,
      maxX: 64,
      maxY: 400,
      blocksProjectiles: true,
      blocksVision: true,
    });
    const state = createCombatSystemState();
    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1'),
        blockers: [clearWall],
      }),
      state,
    );
    expect(countProjectiles(world)).toBe(1);

    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), { blockers: [clearWall] }),
      state,
    );
    expect(countProjectiles(world)).toBe(1);
  });

  it('blocks friendly fire by team and allows it when enabled (HitResolutionPolicy)', () => {
    const fireAtTeammate = (friendlyFire: boolean): number => {
      const world = createTestPluginWorld();
      registerStores(world);
      spawnPlayer(world, 'player-1', 0, 0, DAMAGE.playerHealth, 'alpha');
      const victim = spawnPlayer(
        world,
        'player-2',
        MOVEMENT.radius * 2 + PROJECTILE.radius,
        0,
        DAMAGE.playerHealth,
        'alpha',
      );
      runCombatSystem(
        world,
        makeContext(world, createDamageSystemState(), {
          getPlayerInput: inputForPlayer('player-1'),
          roomRules: { matchMode: 'duo', friendlyFire, respawnEnabled: false },
        }),
        createCombatSystemState(),
      );
      return world.getComponent<Player>(PLAYER_COMPONENT).get(victim)!.health;
    };

    expect(fireAtTeammate(false)).toBe(DAMAGE.playerHealth);
    expect(fireAtTeammate(true)).toBe(DAMAGE.playerHealth - PROJECTILE.damage);
  });
});

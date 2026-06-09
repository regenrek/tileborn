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

import { DAMAGE, INVENTORY, LOOT_PICKUP_RADIUS, MOVEMENT, PROJECTILE, SPAWN_POINT_KIND } from '../constants.js';
import { DEFAULT_BATTLE_ROYALE_CONFIG } from '../battle-royale-config.js';
import {
  AMMO_RESERVE_COMPONENT,
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  FACING_COMPONENT,
  INTERACTABLE_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  RELOAD_STATE_COMPONENT,
  TEAM_COMPONENT,
  VELOCITY_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  type AmmoReserve,
  type DamageIndicator,
  type Player,
  type Position,
  type Projectile,
  type ReloadState,
  type WeaponRuntimeState,
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
  createInventoryLootSystemState,
  runInventoryLootSystem,
} from './inventory-loot-system.js';
import {
  createDamageSystemState,
  runDamageSystem,
  type DamageSystemState,
} from './damage-system.js';
import { resolveBattleRoyaleWeaponEntry } from '../weapon-catalog.js';
import { exportArtifact } from '../export-artifact.js';
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from '../id-utils.js';
import { createBattleRoyaleSnapshotEmitter } from '../server/snapshot-emitter.js';
import { createTestPluginWorld } from '../test-plugin-world.js';
import type { ExportedArtifact } from '../types/artifact.js';
import type { RuntimePlayerInput } from '../types/runtime-plugin.js';

const DT = 1 / MOVEMENT.tickRate;
const TILE_SIZE = 32;
const CONFIG = DEFAULT_BATTLE_ROYALE_CONFIG;
const WEAPON_ENTRY = resolveBattleRoyaleWeaponEntry(CONFIG);
const PROJECTILE_MUZZLE_OFFSET = WEAPON_ENTRY.delivery.radius + 1;

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
  world.registerComponent(FACING_COMPONENT);
  world.registerComponent(TEAM_COMPONENT);
  world.registerComponent(PROJECTILE_COMPONENT);
  world.registerComponent(BREAKABLE_COMPONENT);
  world.registerComponent(COLLISION_BODY_COMPONENT);
  world.registerComponent(INTERACTABLE_COMPONENT);
  world.registerComponent(LOOT_SOURCE_COMPONENT);
  world.registerComponent(PICKUP_COMPONENT);
  world.registerComponent(PICKUP_PROMPT_COMPONENT);
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
  world.getComponent(FACING_COMPONENT).set(entity, { dir: 0 });
  world.getComponent(TEAM_COMPONENT).set(entity, { team });
  return entity;
};

interface CtxOptions {
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly mapBounds?: MapBounds;
  readonly blockers?: ReturnType<typeof buildCombatBlockers>;
  readonly roomRules?: Parameters<typeof createBattleRoyaleHitPolicy>[0];
  readonly tick?: number;
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
  initialAmmoReserve: CONFIG.projectile.initialAmmoReserve,
  projectileBoundsRadius: CONFIG.projectile.radius,
  ...(options.tick === undefined ? {} : { tick: options.tick }),
});

const shooterInput = (
	  overrides: Partial<{
	    readonly aimDeg: number;
	    readonly dir: RuntimePlayerInput['dir'];
	    readonly swapSlot: number;
	    readonly shoot: boolean;
	    readonly reload: boolean;
	    readonly interact: boolean;
	  }> = {},
): RuntimePlayerInput => ({
  tick: 1,
  seq: 1,
  dir: 0,
	  shoot: true,
	  reload: false,
	  interact: false,
	  drop: false,
	  abilities: [],
	  ...overrides,
	});

const idleShooterInput = (
	  overrides: Partial<{
	    readonly aimDeg: number;
	    readonly swapSlot: number;
	    readonly shoot: boolean;
	  }> = {},
): RuntimePlayerInput => ({
  tick: 1,
  seq: 1,
	  shoot: true,
	  reload: false,
	  interact: false,
	  drop: false,
	  abilities: [],
	  ...overrides,
	});

const inputForPlayer =
  (playerId: string, input: RuntimePlayerInput = shooterInput()) =>
  (id: string) =>
    id === playerId ? input : undefined;

const countProjectiles = (world: ReturnType<typeof createTestPluginWorld>): number =>
  [...world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries()].length;

const reserveAmount = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerEntity: number,
): number =>
  world
    .getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT)
    .get(playerEntity)
    ?.stacks.find((stack) => stack.ammoKind === String(WEAPON_ENTRY.weapon.id))?.amount ?? 0;

const reloadState = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerEntity: number,
): ReloadState | undefined =>
  world.getComponent<ReloadState>(RELOAD_STATE_COMPONENT).get(playerEntity);

const weaponRuntimeState = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerEntity: number,
): WeaponRuntimeState | undefined =>
  world.getComponent<WeaponRuntimeState>(WEAPON_RUNTIME_STATE_COMPONENT).get(playerEntity);

const runUntilProjectileCount = (
  world: ReturnType<typeof createTestPluginWorld>,
  state: ReturnType<typeof createCombatSystemState>,
  playerId: string,
  expectedCount: number,
  maxTicks = 80,
): void => {
  const damageState = createDamageSystemState();
  for (let tick = 0; tick < maxTicks; tick += 1) {
    runCombatSystem(
      world,
      makeContext(world, damageState, { getPlayerInput: inputForPlayer(playerId) }),
      state,
    );
    if (countProjectiles(world) >= expectedCount) {
      return;
    }
  }
  expect(countProjectiles(world)).toBeGreaterThanOrEqual(expectedCount);
};

const projectileEntries = (
  world: ReturnType<typeof createTestPluginWorld>,
): readonly [number, Projectile][] =>
  [...world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries()].sort(
    ([left], [right]) => left - right,
  );

const projectiles = (world: ReturnType<typeof createTestPluginWorld>): readonly Projectile[] =>
  projectileEntries(world).map(([, projectile]) => projectile);

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

  it('stops firing when the magazine is empty instead of topping ammo back up', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();

    runUntilProjectileCount(world, state, 'player-1', CONFIG.projectile.magazineSize);

    expect(countProjectiles(world)).toBe(CONFIG.projectile.magazineSize);
    for (let tick = 0; tick < PROJECTILE.shootCooldownTicks + 2; tick += 1) {
      runCombatSystem(
        world,
        makeContext(world, createDamageSystemState(), {
          getPlayerInput: inputForPlayer('player-1'),
        }),
        state,
      );
    }

    expect(countProjectiles(world)).toBe(CONFIG.projectile.magazineSize);
  });

  it('reloads from reserve, consumes reserve rounds, and fires again after reload timing completes', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const playerEntity = spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();

    runUntilProjectileCount(world, state, 'player-1', CONFIG.projectile.magazineSize);

    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1', shooterInput({ shoot: false, reload: true })),
      }),
      state,
    );

    expect(reserveAmount(world, playerEntity)).toBe(
      CONFIG.projectile.initialAmmoReserve - CONFIG.projectile.magazineSize,
    );
    expect(reloadState(world, playerEntity)).toEqual({
      active: true,
      weaponId: String(WEAPON_ENTRY.weapon.id),
      remainingTicks: CONFIG.projectile.reloadTicks,
    });
    expect(weaponRuntimeState(world, playerEntity)).toMatchObject({
      weaponId: String(WEAPON_ENTRY.weapon.id),
      slot: 1,
      ammoInMagazine: 0,
      magazineSize: CONFIG.projectile.magazineSize,
      reloadRemainingTicks: CONFIG.projectile.reloadTicks,
      reloadTotalTicks: CONFIG.projectile.reloadTicks,
    });

    for (let tick = 0; tick < CONFIG.projectile.reloadTicks; tick += 1) {
      runCombatSystem(world, makeContext(world, createDamageSystemState()), state);
    }

    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1'),
      }),
      state,
    );

    expect(countProjectiles(world)).toBe(CONFIG.projectile.magazineSize + 1);
    expect(reloadState(world, playerEntity)).toEqual({
      active: false,
      weaponId: String(WEAPON_ENTRY.weapon.id),
      remainingTicks: 0,
    });
    expect(weaponRuntimeState(world, playerEntity)).toMatchObject({
      ammoInMagazine: CONFIG.projectile.magazineSize - 1,
      reloadRemainingTicks: 0,
    });
  });

  it('does not reload or fire with an empty magazine and no reserve', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const playerEntity = spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();

    runUntilProjectileCount(world, state, 'player-1', CONFIG.projectile.magazineSize);
    world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT).set(playerEntity, {
      stacks: [{ ammoKind: String(WEAPON_ENTRY.weapon.id), amount: 0 }],
    });

    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1', shooterInput({ shoot: false, reload: true })),
      }),
      state,
    );
    runCombatSystem(
      world,
      makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1'),
      }),
      state,
    );

    expect(countProjectiles(world)).toBe(CONFIG.projectile.magazineSize);
    expect(reloadState(world, playerEntity)).toEqual({
      active: false,
      weaponId: String(WEAPON_ENTRY.weapon.id),
      remainingTicks: 0,
    });
    expect(reserveAmount(world, playerEntity)).toBe(0);
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

  it('spawns from an aim-directed muzzle before the first projectile advance', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 10, 10);
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1', shooterInput({ aimDeg: 90 })),
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const entry = projectileEntries(world)[0];
    expect(entry).toBeDefined();
    const [projectileEntity, projectile] = entry!;
    const visiblePosition = positions.get(projectileEntity)!;
    const spawnOrigin = {
      x: visiblePosition.x - projectile.dirX * projectile.speed,
      y: visiblePosition.y - projectile.dirY * projectile.speed,
    };

    expect(projectile).toEqual(
      expect.objectContaining({
        dirX: expect.closeTo(0),
        dirY: expect.closeTo(1),
        speed: expect.closeTo(WEAPON_ENTRY.delivery.speed),
      }),
    );
    expect(spawnOrigin.x).toBeCloseTo(10);
    expect(spawnOrigin.y).toBeCloseTo(10 + PROJECTILE_MUZZLE_OFFSET);
    expect(visiblePosition.y).toBeCloseTo(10 + PROJECTILE_MUZZLE_OFFSET + WEAPON_ENTRY.delivery.speed);
  });

  it('keeps the shooter stationary when firing with and without movement direction', () => {
    const cases: readonly {
      readonly input: RuntimePlayerInput;
      readonly expectedDirX: number;
      readonly expectedDirY: number;
    }[] = [
      { input: shooterInput(), expectedDirX: 1, expectedDirY: 0 },
      { input: idleShooterInput({ aimDeg: 90 }), expectedDirX: 0, expectedDirY: 1 },
    ];

    for (const testCase of cases) {
      const world = createTestPluginWorld();
      registerStores(world);
      const playerEntity = spawnPlayer(world, 'player-1', 10, 10);
      const positions = world.getComponent<Position>(POSITION_COMPONENT);
      const initialPlayerPosition = { ...positions.get(playerEntity)! };
      const ctx = makeContext(world, createDamageSystemState(), {
        getPlayerInput: inputForPlayer('player-1', testCase.input),
      });

      runCombatSystem(world, ctx, createCombatSystemState());

      expect(positions.get(playerEntity)).toEqual(initialPlayerPosition);
      const entry = projectileEntries(world)[0];
      expect(entry).toBeDefined();
      const [projectileEntity, projectile] = entry!;
      const visiblePosition = positions.get(projectileEntity)!;
      const spawnOrigin = {
        x: visiblePosition.x - projectile.dirX * projectile.speed,
        y: visiblePosition.y - projectile.dirY * projectile.speed,
      };
      expect(projectile.dirX).toBeCloseTo(testCase.expectedDirX);
      expect(projectile.dirY).toBeCloseTo(testCase.expectedDirY);
      expect(spawnOrigin.x).toBeCloseTo(
        initialPlayerPosition.x + testCase.expectedDirX * PROJECTILE_MUZZLE_OFFSET,
      );
      expect(spawnOrigin.y).toBeCloseTo(
        initialPlayerPosition.y + testCase.expectedDirY * PROJECTILE_MUZZLE_OFFSET,
      );
    }
  });

  it('uses weapon-slot-only input while falling back to last facing direction', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 10, 10);
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1', shooterInput({ swapSlot: 2 })),
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
      getPlayerInput: inputForPlayer('player-1', shooterInput({ aimDeg: 180, swapSlot: 3 })),
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
      getPlayerInput: inputForPlayer('player-1', shooterInput({ swapSlot: 99 })),
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    expect(projectiles(world)).toEqual([expect.objectContaining({ weaponSlot: 1 })]);
  });

  it('advances projectiles by exactly the delivery per-tick speed', () => {
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
    const entry = projectileEntries(world)[0];
    expect(entry).toBeDefined();
    const [projectileEntity, projectile] = entry!;
    const start = positions.get(projectileEntity)!;

    const noInputCtx = makeContext(world, createDamageSystemState(), {});
    runCombatSystem(world, noInputCtx, state);
    const end = positions.get(projectileEntity)!;

    expect(projectile.speed).toBeCloseTo(WEAPON_ENTRY.delivery.speed);
    expect(WEAPON_ENTRY.delivery.speed).toBeCloseTo(PROJECTILE.speed * DT);
    expect(end.x - start.x).toBeCloseTo(WEAPON_ENTRY.delivery.speed);
    expect(end.y).toBeCloseTo(start.y);
  });

  it('emits the advanced projectile position and heading in snapshots', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const state = createCombatSystemState();
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1'),
    });

    runCombatSystem(world, ctx, state);
    runCombatSystem(world, makeContext(world, createDamageSystemState(), {}), state);

    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const entry = projectileEntries(world)[0];
    expect(entry).toBeDefined();
    const [projectileEntity] = entry!;
    const position = positions.get(projectileEntity)!;
    const frame = createBattleRoyaleSnapshotEmitter().buildWelcome(world, 2);
    const snapshot = BattleRoyaleProtocol.decodeMessage(frame);

    expect(snapshot._tag).toBe('WelcomeSnapshot');
    if (snapshot._tag === 'WelcomeSnapshot') {
      expect(snapshot.projectiles).toHaveLength(1);
      expect(snapshot.projectiles[0]).toMatchObject({
        x: expect.closeTo(position.x),
        y: expect.closeTo(position.y),
        vx: expect.closeTo(WEAPON_ENTRY.delivery.speed),
        vy: expect.closeTo(0),
        rotation: expect.closeTo(0),
      });
    }
  });

  it('damages a target downrange, enqueues a kill, and removes the projectile', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const victim = spawnPlayer(
      world,
      'player-2',
      PROJECTILE_MUZZLE_OFFSET + WEAPON_ENTRY.delivery.speed / 2,
      0,
      PROJECTILE.damage,
    );
    const damageState = createDamageSystemState();
    const collector = createMsgCollector();
    const ctx = makeContext(world, damageState, { getPlayerInput: inputForPlayer('player-1'), tick: 7 });

    runCombatSystem(world, ctx, createCombatSystemState());
    runDamageSystem(world, 1, { msgOut: collector.msgOut }, damageState);

    expect(world.getComponent<Player>(PLAYER_COMPONENT).get(victim)).toMatchObject({
      health: 0,
      alive: 0,
    });
    expect(countProjectiles(world)).toBe(0);
    expect(world.getComponent<DamageIndicator>(DAMAGE_INDICATOR_COMPONENT).get(victim)).toEqual({
      sourceId: 'player-1',
      angleDeg: 180,
      amount: PROJECTILE.damage,
      tick: 7,
    });

    const kills = collector.decodeAll().filter((message) => message._tag === 'PlayerKilled');
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({
      killer: BattleRoyaleProtocol.makePlayerId('player-1'),
      victim: BattleRoyaleProtocol.makePlayerId('player-2'),
      tick: 1,
    });
  });

  it('is blocked by projectile-blocking geometry downrange', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const blocker = new CombatBlocker({
      minX: PROJECTILE_MUZZLE_OFFSET + WEAPON_ENTRY.delivery.speed / 2,
      minY: -2,
      maxX: PROJECTILE_MUZZLE_OFFSET + WEAPON_ENTRY.delivery.speed / 2 + 1,
      maxY: 2,
      blocksProjectiles: true,
      blocksVision: false,
    });
    const ctx = makeContext(world, createDamageSystemState(), {
      getPlayerInput: inputForPlayer('player-1'),
      blockers: [blocker],
    });

    runCombatSystem(world, ctx, createCombatSystemState());

    expect(countProjectiles(world)).toBe(0);
  });

  it('damages shot loot crates and lets the loot system drop their rolled pickup', () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, 'player-1', 0, 0);
    const crateObjectId = 'object:00000000-0000-4000-8000-000000000777';
    const crate = world.createEntity();
    const crateX = PROJECTILE_MUZZLE_OFFSET + WEAPON_ENTRY.delivery.speed / 2;
    world.getComponent<Position>(POSITION_COMPONENT).set(crate, { x: crateX, y: 0 });
    world.getComponent(PICKUP_COMPONENT).set(crate, {
      itemKind: 'supply-crate',
      tier: 'common',
      quantity: 1,
      available: true,
    });
    world.getComponent(LOOT_SOURCE_COMPONENT).set(crate, {
      tableId: crateObjectId,
      tier: 'common',
      weight: 1,
      collected: false,
    });
    world.getComponent(INTERACTABLE_COMPONENT).set(crate, {
      action: 'pickup-loot',
      radius: LOOT_PICKUP_RADIUS,
      enabled: true,
    });
    world.getComponent(BREAKABLE_COMPONENT).set(crate, {
      health: WEAPON_ENTRY.delivery.damage,
      maxHealth: WEAPON_ENTRY.delivery.damage,
      destroyed: false,
    });
    world.getComponent(COLLISION_BODY_COMPONENT).set(crate, {
      objectId: crateObjectId,
      x: crateX - 16,
      y: -16,
      width: 32,
      height: 32,
      blocksMovement: true,
      blocksProjectiles: true,
      blocksVision: true,
    });

    const damageState = createDamageSystemState();
    runCombatSystem(
      world,
      makeContext(world, damageState, { getPlayerInput: inputForPlayer('player-1') }),
      createCombatSystemState(),
    );

    expect(countProjectiles(world)).toBe(0);
    expect(world.getComponent(BREAKABLE_COMPONENT).get(crate)).toMatchObject({
      health: 0,
      destroyed: false,
    });

    runInventoryLootSystem(
      world,
      {
        artifact: {
          schemaVersion: 1,
          maxPlayers: 1,
          spawnPoints: [{ x: 0, y: 0, team: 'solo', weight: 1 }],
          spawnAnchors: [{ x: 0, y: 0, team: 'solo', weight: 1 }],
          shrinkSchedule: {
            centerX: 0,
            centerY: 0,
            startRadiusTiles: 16,
            endRadiusTiles: 4,
            shrinkIntervalMs: 30_000,
            damagePerSecond: 5,
          },
          lootTables: [{ itemKind: 'ammo-box', tier: 'common', weight: 1 }],
          objectPlacements: [],
        } as ExportedArtifact,
        getPlayerInput: () => undefined,
        weaponId: String(WEAPON_ENTRY.weapon.id),
        pickupRadius: LOOT_PICKUP_RADIUS,
        ammoPickupAmount: INVENTORY.ammoPickupAmount,
        healthPackAmount: INVENTORY.healthPackAmount,
        playerHealth: CONFIG.damage.playerHealth,
      },
      createInventoryLootSystemState(1),
    );

    expect(world.getComponent(LOOT_SOURCE_COMPONENT).get(crate)).toMatchObject({
      collected: true,
    });
    expect(world.getComponent(BREAKABLE_COMPONENT).get(crate)).toMatchObject({
      destroyed: true,
    });
    expect(world.getComponent(COLLISION_BODY_COMPONENT).get(crate)).toMatchObject({
      blocksMovement: false,
      blocksProjectiles: false,
      blocksVision: false,
    });
    expect(
      [...world.getComponent(PICKUP_COMPONENT).entries()]
        .map(([, pickup]) => pickup)
        .filter((pickup) => pickup.available),
    ).toEqual([{ itemKind: 'ammo-box', tier: 'common', quantity: 1, available: true }]);
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

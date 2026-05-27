import { MapObject, TileChunk, TileLayer, makeAssetId, makeTileId, makeTileborneMap, type Uuid } from "@tileborne/core";
import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
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
} from "@tileborne/sdk-tileset/schemas";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DAMAGE, MOVEMENT, PROJECTILE, SPAWN_POINT_KIND } from "../constants.js";
import {
  LAST_FACING_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  VELOCITY_COMPONENT,
  type Player,
  type Position,
  type Projectile,
} from "./components.js";
import { PluginCollisionEnvironment } from "./collision.js";
import {
  createProjectileSystemState,
  runProjectileSystem,
  type MapBounds,
  type ProjectileSystemContext,
} from "./projectile-system.js";
import { createDamageSystemState, runDamageSystem, type DamageSystemContext } from "./damage-system.js";
import { exportArtifact } from "../export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "../id-utils.js";
import { createTestPluginWorld } from "../test-plugin-world.js";

const DT = 1 / MOVEMENT.tickRate;
const TILE_SIZE = 32;
const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, "0")}` as Uuid;
const passableTileId = makeTileId(uuid("401"));
const blockedTileId = makeTileId(uuid("402"));

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
): MapObject =>
  new MapObject({
    id,
    kind,
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties: {},
  });

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

const countProjectiles = (world: ReturnType<typeof createTestPluginWorld>): number =>
  world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries().length;

const projectiles = (world: ReturnType<typeof createTestPluginWorld>): readonly Projectile[] =>
  [...world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries()]
    .sort(([left], [right]) => left - right)
    .map(([, projectile]) => projectile);

const spawnPlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerId: string,
  x: number,
  y: number,
  health = DAMAGE.playerHealth,
): number => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, { x, y });
  world.getComponent<Velocity>(VELOCITY_COMPONENT).set(entity, { vx: 0, vy: 0 });
  world.getComponent<Player>(PLAYER_COMPONENT).set(entity, {
    playerId,
    health,
    alive: 1,
    team: "solo",
  });
  world.getComponent(LAST_FACING_COMPONENT).set(entity, { dir: 0 });
  return entity;
};

const shooterInput = (
  tick = 1,
  overrides: Partial<{
    readonly aimDeg: number;
    readonly weaponSlot: number;
  }> = {},
) => ({
  tick,
  seq: 1,
  dir: 0 as const,
  shoot: true,
  ...overrides,
});

const inputForPlayer =
  (playerId: string, input = shooterInput()) =>
  (id: string) =>
    id === playerId ? input : undefined;

const makeCollisionTilesetPack = (): TilesetPack =>
  new TilesetPack({
    schemaVersion: 1,
    id: "pack:660e8400-e29b-41d4-a716-000000000501",
    name: "Projectile Collision Fixture",
    version: "1.0.0",
    license: new TilesetPackLicense({
      spdxId: "CC0-1.0",
      attribution: Option.none(),
      sourceUrl: Option.none(),
      notes: Option.none(),
      redistributable: true,
    }),
    tilesets: [
      new Tileset({
        id: Schema.decodeUnknownSync(TilesetId)("tileset:660e8400-e29b-41d4-a716-000000000502"),
        name: "Collision",
        atlasAssetId: makeAssetId(uuid("503")),
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
        id: makeAssetId(uuid("503")),
        path: "tiles/projectile-collision.png",
        mime: "image/png",
      }),
    ],
  });

const makeProjectileCtx = (
  damageState: ReturnType<typeof createDamageSystemState>,
  partial: Omit<ProjectileSystemContext, "damageState">,
): ProjectileSystemContext => ({
  damageState,
  ...partial,
});

const runTick = (
  world: ReturnType<typeof createTestPluginWorld>,
  tick: number,
  ctx: ProjectileSystemContext,
  state: ReturnType<typeof createProjectileSystemState>,
  msgOut?: DamageSystemContext["msgOut"],
): void => {
  runProjectileSystem(world, DT, tick, ctx, state);
  if (msgOut) {
    runDamageSystem(world, tick, { msgOut }, ctx.damageState);
  }
};

describe("projectile system", () => {
  it("spawns one projectile per cooldown window when shoot stays pressed", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 10, 10);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1"),
    });

    for (let tick = 1; tick <= PROJECTILE.shootCooldownTicks - 1; tick += 1) {
      runTick(world, tick, ctx, state);
    }

    expect(countProjectiles(world)).toBe(1);

    runTick(world, PROJECTILE.shootCooldownTicks + 3, ctx, state);
    expect(countProjectiles(world)).toBe(2);
  });

  it("uses aim-only input for projectile direction", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 10, 10);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1", shooterInput(1, { aimDeg: 90 })),
    });

    runTick(world, 1, ctx, state);

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(0), dirY: expect.closeTo(1), weaponSlot: 1 }),
    ]);
  });

  it("uses weapon-slot-only input while falling back to last movement direction", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 10, 10);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1", shooterInput(1, { weaponSlot: 2 })),
    });

    runTick(world, 1, ctx, state);

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(1), dirY: expect.closeTo(0), weaponSlot: 2 }),
    ]);
  });

  it("uses aim and weapon slot together when both are present", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 10, 10);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1", shooterInput(1, { aimDeg: 180, weaponSlot: 3 })),
    });

    runTick(world, 1, ctx, state);

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(-1), dirY: expect.closeTo(0), weaponSlot: 3 }),
    ]);
  });

  it("ignores out-of-range weapon slots", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 10, 10);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1", shooterInput(1, { weaponSlot: 99 })),
    });

    runTick(world, 1, ctx, state);

    expect(projectiles(world)).toEqual([expect.objectContaining({ weaponSlot: 1 })]);
  });

  it("keeps legacy input behavior when aim and weapon slot are absent", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 10, 10);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1", shooterInput()),
    });

    runTick(world, 1, ctx, state);

    expect(projectiles(world)).toEqual([
      expect.objectContaining({ dirX: expect.closeTo(1), dirY: expect.closeTo(0), weaponSlot: 1 }),
    ]);
  });

  it("moves projectiles at the configured speed", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 0, 0);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1"),
    });

    runTick(world, 1, ctx, state);
    expect(countProjectiles(world)).toBe(1);

    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const projectiles = world.getComponent<Projectile>(PROJECTILE_COMPONENT);
    const [projectileEntity] = projectiles.entries().next().value as [number, Projectile];
    const start = positions.get(projectileEntity)!;

    runTick(world, 2, { ...ctx, getPlayerInput: undefined }, state);
    const end = positions.get(projectileEntity)!;

    expect(end.x - start.x).toBeCloseTo(PROJECTILE.speed * DT);
    expect(end.y).toBeCloseTo(start.y);
  });

  it("damages other players, emits PlayerKilled, and removes the projectile", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 0, 0);
    const victim = spawnPlayer(world, "player-2", MOVEMENT.radius * 2 + PROJECTILE.radius, 0, 30);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const collector = createMsgCollector();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1"),
    });

    runTick(world, 1, ctx, state);
    expect(countProjectiles(world)).toBe(0);
    runTick(world, 2, { ...ctx, getPlayerInput: undefined }, state);

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    expect(players.get(victim)).toMatchObject({
      health: 30 - PROJECTILE.damage,
      alive: 1,
    });
    expect(countProjectiles(world)).toBe(0);

    const lethalHealth = PROJECTILE.damage;
    players.set(victim, {
      playerId: "player-2",
      health: lethalHealth,
      alive: 1,
      team: "solo",
    });
    world.getComponent<Position>(POSITION_COMPONENT).set(victim, {
      x: MOVEMENT.radius * 2 + PROJECTILE.radius,
      y: 0,
    });

    runTick(world, 10, ctx, state, collector.msgOut);
    runTick(world, 11, { ...ctx, getPlayerInput: undefined }, state, collector.msgOut);

    expect(players.get(victim)).toMatchObject({ health: 0, alive: 0 });
    const kills = collector.decodeAll().filter((message) => message._tag === "PlayerKilled");
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({
      killer: BattleRoyaleProtocol.makePlayerId("player-1"),
      victim: BattleRoyaleProtocol.makePlayerId("player-2"),
      tick: 10,
    });
  });

  it("culls projectiles that hit blocking map geometry", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 100, 100);
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
            name: "Ground",
            visible: true,
            opacity: 1,
            chunks: [new TileChunk({ x: 0, y: 0, width: 32, height: 32, tiles: collisionTiles })],
          }),
        ],
        objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 16, 16)],
      }),
      { tilesetPack: pack },
    );
    const collisionEnvironment = PluginCollisionEnvironment.fromArtifact(artifact);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      collisionEnvironment,
      getPlayerInput: inputForPlayer("player-1"),
    });

    runTick(world, 1, ctx, state);
    expect(countProjectiles(world)).toBe(1);

    for (let tick = 2; tick <= 20; tick += 1) {
      runTick(world, tick, { ...ctx, getPlayerInput: undefined }, state);
      if (countProjectiles(world) === 0) {
        return;
      }
    }

    expect(countProjectiles(world)).toBe(0);
  });

  it("ignores collisions with the projectile owner", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const owner = spawnPlayer(world, "player-1", 0, 0);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1"),
    });

    runTick(world, 1, ctx, state);

    for (let tick = 2; tick <= 5; tick += 1) {
      runTick(world, tick, { ...ctx, getPlayerInput: undefined }, state);
    }

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    expect(players.get(owner)).toMatchObject({ health: DAMAGE.playerHealth, alive: 1 });
    expect(countProjectiles(world)).toBe(1);
  });

  it("culls projectiles when ttl expires", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", 0, 0);
    const state = createProjectileSystemState();
    const damageState = createDamageSystemState();
    const ctx = makeProjectileCtx(damageState, {
      mapBounds: openMapBounds(),
      getPlayerInput: inputForPlayer("player-1"),
    });

    runTick(world, 1, ctx, state);
    expect(countProjectiles(world)).toBe(1);

    for (let tick = 2; tick <= PROJECTILE.ttlTicks; tick += 1) {
      runTick(world, tick, { ...ctx, getPlayerInput: undefined }, state);
    }

    expect(countProjectiles(world)).toBe(0);
  });
});

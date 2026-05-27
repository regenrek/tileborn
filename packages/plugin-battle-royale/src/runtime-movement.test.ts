import { MapObject, TileChunk, TileLayer, makeAssetId, makeTileId, makeTileborneMap, type Uuid } from "@tileborne/core";
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
import { afterEach, describe, expect, it } from "vitest";

import { MOVEMENT, SPAWN_POINT_KIND } from "./constants.js";
import { PLAYER_COMPONENT, POSITION_COMPONENT, type Player, type Position } from "./ecs/components.js";
import {
  applyMovementTick,
  buildCollisionEnvironment,
  DEFAULT_TICK_DT,
  direction8ToUnitVector,
} from "./ecs/movement.js";
import { spawnPlayersFromArtifact } from "./ecs/spawn-players.js";
import { resetZoneSingleton } from "./ecs/zone.js";
import { exportArtifact } from "./export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { createRuntimeAdapter } from "./runtime-adapter.js";
import { createTestPluginWorld } from "./test-plugin-world.js";

const DT = 1 / MOVEMENT.tickRate;
const TILE_SIZE = 32;
const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, "0")}` as Uuid;
const passableTileId = makeTileId(uuid("201"));
const blockedTileId = makeTileId(uuid("202"));

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

const spawnSinglePlayer = (world: ReturnType<typeof createTestPluginWorld>, startX = 0, startY = 0) => {
  const map = makeTileborneMap({
    id: TEST_MAP_ID,
    width: 32,
    height: 32,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, startX, startY)],
  });
  const artifact = exportArtifact(map);
  spawnPlayersFromArtifact(world, artifact);
  return artifact;
};

const spawnTwoPlayerArtifact = () =>
  exportArtifact(
    makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 10, 20),
        makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 30, 40),
      ],
      properties: { maxPlayers: 2 },
    }),
  );

const firstPosition = (world: ReturnType<typeof createTestPluginWorld>): Position => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const [, position] = positions.entries().next().value as [number, Position];
  return position;
};

const positionsByPlayerId = (world: ReturnType<typeof createTestPluginWorld>): ReadonlyMap<string, Position> => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const result = new Map<string, Position>();
  for (const [entity, player] of players.entries()) {
    const position = positions.get(entity);
    if (position) {
      result.set(player.playerId, position);
    }
  }
  return result;
};

const makeCollisionTilesetPack = (): TilesetPack =>
  new TilesetPack({
    schemaVersion: 1,
    id: "pack:660e8400-e29b-41d4-a716-000000000301",
    name: "Collision Fixture",
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
        id: Schema.decodeUnknownSync(TilesetId)("tileset:660e8400-e29b-41d4-a716-000000000302"),
        name: "Collision",
        atlasAssetId: makeAssetId(uuid("303")),
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
        id: makeAssetId(uuid("303")),
        path: "tiles/collision.png",
        mime: "image/png",
      }),
    ],
  });

afterEach(() => {
  resetZoneSingleton();
});

describe("direction8ToUnitVector", () => {
  it("maps east and north-east with sqrt(2)/2 diagonal normalization", () => {
    expect(direction8ToUnitVector(0)).toEqual({ x: 1, y: 0 });
    const northEast = direction8ToUnitVector(7);
    expect(northEast.x).toBeCloseTo(Math.SQRT2 / 2);
    expect(northEast.y).toBeCloseTo(-Math.SQRT2 / 2);
  });
});

describe("applyMovementTick", () => {
  it("moves east for two ticks by 2 * speed * dt", () => {
    const world = createTestPluginWorld();
    spawnSinglePlayer(world, 10, 20);
    const input = { dir: 0 as const, shoot: false };

    applyMovementTick(world, DT, new Map([["player-1", input]]), undefined);
    applyMovementTick(world, DT, new Map([["player-1", input]]), undefined);

    const position = firstPosition(world);
    expect(position.x).toBeCloseTo(10 + 2 * MOVEMENT.speed * DT);
    expect(position.y).toBeCloseTo(20);
  });

  it("applies sqrt(2)/2 normalization for north-east movement", () => {
    const world = createTestPluginWorld();
    spawnSinglePlayer(world, 0, 0);
    const input = { dir: 7 as const, shoot: false };
    const axisDelta = (Math.SQRT2 / 2) * MOVEMENT.speed * DT;

    applyMovementTick(world, DT, new Map([["player-1", input]]), undefined);
    applyMovementTick(world, DT, new Map([["player-1", input]]), undefined);

    const position = firstPosition(world);
    expect(position.x).toBeCloseTo(axisDelta * 2);
    expect(position.y).toBeCloseTo(-axisDelta * 2);
  });

  it("blocks movement using SDK collision masks from the tileset pack", () => {
    const world = createTestPluginWorld();
    const pack = makeCollisionTilesetPack();
    const collisionTiles = Array.from({ length: 32 * 32 }, () => 0);
    collisionTiles[3 * 32 + 4] = 2;
    const map = makeTileborneMap({
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
      objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 100, 100)],
    });
    const artifact = exportArtifact(map, { tilesetPack: pack });
    spawnPlayersFromArtifact(world, artifact);
    const environment = buildCollisionEnvironment(artifact);

    const input = { dir: 0 as const, shoot: false };
    for (let tick = 0; tick < 20; tick += 1) {
      applyMovementTick(world, DT, new Map([["player-1", input]]), environment);
    }

    const after = firstPosition(world);
    expect(after.x).toBeLessThanOrEqual(128 - MOVEMENT.radius);
  });

  it("uses each alive player's own runtime input without cross-bleed", () => {
    const world = createTestPluginWorld();
    const artifact = spawnTwoPlayerArtifact();
    const plugin = createRuntimeAdapter({
      getArtifact: () => artifact,
      getPlayerInput: (playerId) => {
        if (playerId === "player-1") {
          return { tick: 1, seq: 1, dir: 0, shoot: false };
        }
        if (playerId === "player-2") {
          return { tick: 1, seq: 1, dir: 2, shoot: false };
        }
        return undefined;
      },
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);
    plugin.onTick?.(world, DT, 1);

    const positions = positionsByPlayerId(world);
    expect(positions.get("player-1")?.x).toBeCloseTo(10 + MOVEMENT.speed * DT);
    expect(positions.get("player-1")?.y).toBeCloseTo(20);
    expect(positions.get("player-2")?.x).toBeCloseTo(30);
    expect(positions.get("player-2")?.y).toBeCloseTo(40 + MOVEMENT.speed * DT);
  });
});

describe("DEFAULT_TICK_DT", () => {
  it("matches 20Hz host tick duration", () => {
    expect(DEFAULT_TICK_DT).toBeCloseTo(DT);
  });
});

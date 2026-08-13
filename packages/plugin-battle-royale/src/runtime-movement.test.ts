import {
  AssetLibraryReference,
  CollisionLayer,
  MapObject,
  PlayerModelClipSet,
  PlayerModelRef,
  TileChunk,
  TileLayer,
  gameObjectTypeIdForKey,
  makeAssetId,
  makeClipId,
  makePackId,
  makeTileId,
  makeTileborneMap,
  type Uuid,
} from '@tileborne/core';
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
import { Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { MOVEMENT, SPAWN_POINT_KIND } from './constants.js';
import {
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  type Player,
  type Position,
  type Projectile,
} from './ecs/components.js';
import {
  applyMovementTick,
  buildCollisionEnvironment,
  DEFAULT_TICK_DT,
  direction8ToUnitVector,
} from './ecs/movement.js';
import { spawnPlayersFromArtifact } from './ecs/spawn-players.js';
import { resetZoneSingleton } from './ecs/zone.js';
import { extractCollisionArtifact } from './collision-artifact.js';
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from './id-utils.js';
import { createRuntimeAdapter } from './runtime-adapter.js';
import { buildTestMapPackage, buildTestRuntimeArtifact } from './test-map-package.js';
import { createTestPluginWorld } from './test-plugin-world.js';

const DT = 1 / MOVEMENT.tickRate;
const TILE_SIZE = 32;
const uuid = (suffix: string): Uuid =>
  `660e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;
const passableTileId = makeTileId(uuid('201'));
const blockedTileId = makeTileId(uuid('202'));
const modelPackId = makePackId('550e8400-e29b-41d4-a716-446655440999');
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const testModel = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id,
    ref: new AssetLibraryReference({
      packId: modelPackId,
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

const playerModels = [testModel('model:default')] as const;

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

const spawnSinglePlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  startX = 0,
  startY = 0,
) => {
  const map = makeTileborneMap({
    id: TEST_MAP_ID,
    width: 32,
    height: 32,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, startX, startY)],
  });
  const artifact = buildTestRuntimeArtifact(map, { playerModels });
  spawnPlayersFromArtifact(world, artifact);
  return artifact;
};

const spawnTwoPlayerMapPackage = () =>
  buildTestMapPackage({
    map: makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 64, 64),
        makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 256, 64),
      ],
      properties: { maxPlayers: 2 },
    }),
    playerModels,
  });

const firstPosition = (world: ReturnType<typeof createTestPluginWorld>): Position => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const [, position] = positions.entries().next().value as [number, Position];
  return position;
};

const positionsByPlayerId = (
  world: ReturnType<typeof createTestPluginWorld>,
): ReadonlyMap<string, Position> => {
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
    id: 'pack:660e8400-e29b-41d4-a716-000000000301',
    name: 'Collision Fixture',
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
        id: Schema.decodeUnknownSync(TilesetId)('tileset:660e8400-e29b-41d4-a716-000000000302'),
        name: 'Collision',
        atlasAssetId: makeAssetId(uuid('303')),
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
        id: makeAssetId(uuid('303')),
        path: 'tiles/collision.png',
        mime: 'image/png',
      }),
    ],
  });

afterEach(() => {
  resetZoneSingleton();
});

describe('direction8ToUnitVector', () => {
  it('maps east and north-east with sqrt(2)/2 diagonal normalization', () => {
    expect(direction8ToUnitVector(0)).toEqual({ x: 1, y: 0 });
    const northEast = direction8ToUnitVector(7);
    expect(northEast.x).toBeCloseTo(Math.SQRT2 / 2);
    expect(northEast.y).toBeCloseTo(-Math.SQRT2 / 2);
  });
});

describe('applyMovementTick', () => {
  it('moves east for two ticks by 2 * speed * dt', () => {
    const world = createTestPluginWorld();
    spawnSinglePlayer(world, 10, 20);
    const input = { dir: 0 as const, shoot: false, reload: false, interact: false };

    applyMovementTick(world, DT, new Map([['player-1', input]]), undefined);
    applyMovementTick(world, DT, new Map([['player-1', input]]), undefined);

    const position = firstPosition(world);
    expect(position.x).toBeCloseTo(10 + 2 * MOVEMENT.speed * DT);
    expect(position.y).toBeCloseTo(20);
  });

  it('applies sqrt(2)/2 normalization for north-east movement', () => {
    const world = createTestPluginWorld();
    spawnSinglePlayer(world, 0, 0);
    const input = { dir: 7 as const, shoot: false, reload: false, interact: false };
    const axisDelta = (Math.SQRT2 / 2) * MOVEMENT.speed * DT;

    applyMovementTick(world, DT, new Map([['player-1', input]]), undefined);
    applyMovementTick(world, DT, new Map([['player-1', input]]), undefined);

    const position = firstPosition(world);
    expect(position.x).toBeCloseTo(axisDelta * 2);
    expect(position.y).toBeCloseTo(-axisDelta * 2);
  });

  it('blocks movement using SDK collision masks from the tileset pack', () => {
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
          name: 'Ground',
          visible: true,
          opacity: 1,
          chunks: [new TileChunk({ x: 0, y: 0, width: 32, height: 32, tiles: collisionTiles })],
        }),
      ],
      objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 100, 100)],
    });
    // The package carries no tileset pack; tile-mask collision overlays the
    // package-derived state directly (same shared extraction).
    const artifact = {
      ...buildTestRuntimeArtifact(map, { playerModels }),
      tilesetPack: pack,
      collision: extractCollisionArtifact(map, pack),
    };
    spawnPlayersFromArtifact(world, artifact);
    const environment = buildCollisionEnvironment(artifact);

    const input = { dir: 0 as const, shoot: false, reload: false, interact: false };
    for (let tick = 0; tick < 20; tick += 1) {
      applyMovementTick(world, DT, new Map([['player-1', input]]), environment);
    }

    const after = firstPosition(world);
    expect(after.x).toBeLessThanOrEqual(128 - MOVEMENT.radius);
  });

  it('exports collision-paint layers into runtime blockers', () => {
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
        new CollisionLayer({
          id: TEST_LAYER_ID,
          name: 'Collision',
          visible: true,
          opacity: 1,
          chunks: [new TileChunk({ x: 0, y: 0, width: 32, height: 32, tiles: collisionTiles })],
        }),
      ],
      objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 100, 100)],
    });
    const artifact = {
      ...buildTestRuntimeArtifact(map, { playerModels }),
      tilesetPack: pack,
      collision: extractCollisionArtifact(map, pack),
    };
    spawnPlayersFromArtifact(world, artifact);
    const environment = buildCollisionEnvironment(artifact);

    const input = { dir: 0 as const, shoot: false, reload: false, interact: false };
    for (let tick = 0; tick < 20; tick += 1) {
      applyMovementTick(world, DT, new Map([['player-1', input]]), environment);
    }

    expect(firstPosition(world).x).toBeLessThanOrEqual(128 - MOVEMENT.radius);
  });

  it('sweeps long movement steps so players cannot tunnel through blockers', () => {
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
        new CollisionLayer({
          id: TEST_LAYER_ID,
          name: 'Collision',
          visible: true,
          opacity: 1,
          chunks: [new TileChunk({ x: 0, y: 0, width: 32, height: 32, tiles: collisionTiles })],
        }),
      ],
      objects: [makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 80, 100)],
    });
    const artifact = {
      ...buildTestRuntimeArtifact(map, { playerModels }),
      tilesetPack: pack,
      collision: extractCollisionArtifact(map, pack),
    };
    spawnPlayersFromArtifact(world, artifact);

    applyMovementTick(
      world,
      2,
      new Map([['player-1', { dir: 0 as const, shoot: false, reload: false, interact: false }]]),
      buildCollisionEnvironment(artifact),
    );

    expect(firstPosition(world).x).toBeLessThanOrEqual(128 - MOVEMENT.radius);
  });

  it('blocks movement against exported object collision rects', () => {
    const world = createTestPluginWorld();
    const artifact = {
      ...spawnSinglePlayer(world, 100, 100),
      objectCollisionRects: [
        {
          objectId: TEST_OBJECT_IDS[1],
          x: 128,
          y: 88,
          width: 32,
          height: 32,
          blocksMovement: true,
          blocksProjectiles: false,
          blocksVision: false,
        },
      ],
    };

    const input = { dir: 0 as const, shoot: false, reload: false, interact: false };
    for (let tick = 0; tick < 20; tick += 1) {
      applyMovementTick(
        world,
        DT,
        new Map([['player-1', input]]),
        buildCollisionEnvironment(artifact),
      );
    }

    expect(firstPosition(world).x).toBeLessThanOrEqual(128 - MOVEMENT.radius);
  });

  it('does not displace idle players from authored spawn positions inside runtime blockers', () => {
    const world = createTestPluginWorld();
    const artifact = {
      ...spawnSinglePlayer(world, 20, 44),
      objectCollisionRects: [
        {
          objectId: TEST_OBJECT_IDS[1],
          x: 28,
          y: 36,
          width: 16,
          height: 16,
          blocksMovement: true,
          blocksProjectiles: true,
          blocksVision: true,
        },
      ],
    };

    applyMovementTick(world, DT, new Map(), buildCollisionEnvironment(artifact));

    expect(firstPosition(world)).toEqual({ x: 20, y: 44 });
  });

  it("uses each alive player's own runtime input without cross-bleed", () => {
    const world = createTestPluginWorld();
    const mapPackage = spawnTwoPlayerMapPackage();
    const plugin = createRuntimeAdapter({
      getMapPackage: () => mapPackage,
      getPlayerInput: (playerId) => {
        if (playerId === 'player-1') {
          return {
            tick: 1,
            seq: 1,
            dir: 0,
            shoot: false,
            reload: false,
            interact: false,
            drop: false,
            abilities: [],
          };
        }
        if (playerId === 'player-2') {
          return {
            tick: 1,
            seq: 1,
            dir: 2,
            shoot: false,
            reload: false,
            interact: false,
            drop: false,
            abilities: [],
          };
        }
        return undefined;
      },
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);
    plugin.onTick?.(world, DT, 1);

    const positions = positionsByPlayerId(world);
    expect(positions.get('player-1')?.x).toBeCloseTo(64 + MOVEMENT.speed * DT);
    expect(positions.get('player-1')?.y).toBeCloseTo(64);
    expect(positions.get('player-2')?.x).toBeCloseTo(256);
    expect(positions.get('player-2')?.y).toBeCloseTo(64 + MOVEMENT.speed * DT);
  });

  it('keeps a player stationary while holding PrimaryAction without movement input', () => {
    const world = createTestPluginWorld();
    const mapPackage = spawnTwoPlayerMapPackage();
    const plugin = createRuntimeAdapter({
      getMapPackage: () => mapPackage,
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
              aimDeg: 0,
            }
          : undefined,
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);
    plugin.onTick?.(world, DT, 1);

    const positions = positionsByPlayerId(world);
    expect(positions.get('player-1')?.x).toBeCloseTo(64);
    expect(positions.get('player-1')?.y).toBeCloseTo(64);
    expect([...world.getComponent<Projectile>(PROJECTILE_COMPONENT).entries()]).toHaveLength(1);
  });
});

describe('DEFAULT_TICK_DT', () => {
  it('matches 20Hz host tick duration', () => {
    expect(DEFAULT_TICK_DT).toBeCloseTo(DT);
  });
});

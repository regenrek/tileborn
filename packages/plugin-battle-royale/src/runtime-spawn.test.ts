import { MapObject, makeTileborneMap } from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { DAMAGE, DEFAULT_MAX_PLAYERS, SPAWN_POINT_KIND } from "./constants.js";
import { PLAYER_COMPONENT, POSITION_COMPONENT, VELOCITY_COMPONENT, type Player } from "./ecs/components.js";
import { countAlivePlayers, resolveSpawnSlots, spawnPlayersFromArtifact } from "./ecs/spawn-players.js";
import { exportArtifact } from "./export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { createRuntimeAdapter } from "./runtime-adapter.js";
import { createTestPluginWorld } from "./test-plugin-world.js";

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
      makeTestObject(TEST_OBJECT_IDS[3], "shrink-zone-anchor", 16, 16),
    ],
    properties: { maxPlayers: DEFAULT_MAX_PLAYERS },
  });

describe("spawnPlayersFromArtifact", () => {
  it("instantiates one Player entity per spawn marker up to maxPlayers", () => {
    const artifact = exportArtifact(makeSpawnFixtureMap());
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
      expect(typeof player?.playerId).toBe("string");

      const position = positions.get(entity);
      expect(position).toBeDefined();
      expect(Number.isFinite(position?.x)).toBe(true);
      expect(Number.isFinite(position?.y)).toBe(true);

      const velocity = velocities.get(entity);
      expect(velocity).toEqual({ vx: 0, vy: 0 });
    }
  });

  it("falls back to map center when no spawn markers exist", () => {
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 40,
      height: 40,
      tileWidth: 32,
      tileHeight: 32,
      objects: [makeTestObject(TEST_OBJECT_IDS[4], "shrink-zone-anchor", 10, 12)],
    });
    const artifact = exportArtifact(map);
    const slots = resolveSpawnSlots(artifact);

    expect(slots).toEqual([{ x: 10, y: 12 }]);
  });

  it("caps spawns at maxPlayers from room rules", () => {
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
        makeTestObject(TEST_OBJECT_IDS[3], "shrink-zone-anchor", 16, 16),
      ],
    });
    const artifact = exportArtifact(map);
    const world = createTestPluginWorld();

    spawnPlayersFromArtifact(world, artifact);

    expect(countAlivePlayers(world)).toBe(2);
  });
});

describe("createRuntimeAdapter", () => {
  it("registers Player components during onInit for runtime metrics", () => {
    const artifact = exportArtifact(makeSpawnFixtureMap());
    const world = createTestPluginWorld();
    const plugin = createRuntimeAdapter({ getArtifact: () => artifact });

    plugin.onInit?.({ pluginId: plugin.id }, world);

    expect([...world.getComponent<Player>(PLAYER_COMPONENT).entries()]).toHaveLength(3);
    expect(countAlivePlayers(world)).toBe(3);
  });

  it("spawns players on first onTick when onInit lacks a world reference", () => {
    const artifact = exportArtifact(makeSpawnFixtureMap());
    const world = createTestPluginWorld();
    const plugin = createRuntimeAdapter({ getArtifact: () => artifact });

    plugin.onTick?.(world, 0, 0);

    expect(countAlivePlayers(world)).toBe(3);
  });
});

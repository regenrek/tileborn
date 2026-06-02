import { MapObject, gameObjectTypeIdForKey, makeTileborneMap } from "@tileborne/core";
import { Option } from "effect";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_PLAYERS, SPAWN_POINT_KIND } from "./constants.js";
import { countAlivePlayers } from "./ecs/spawn-players.js";
import { exportArtifact } from "./export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { createTestPluginWorld } from "./test-plugin-world.js";

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

describe("built runtime bundle", () => {
  it("loads dist/runtime.js and spawns players like the playtest host", async () => {
    const packageRoot = path.dirname(fileURLToPath(import.meta.url));
    const runtimeHref = pathToFileURL(path.join(packageRoot, "../dist/runtime.js")).href;
    const serverHref = pathToFileURL(path.join(packageRoot, "../dist/server.js")).href;
    const runtimeModule = (await import(runtimeHref)) as {
      readonly createRuntimeAdapter: (host: { getArtifact: () => ReturnType<typeof exportArtifact> }) => {
        readonly id: string;
        readonly onInit?: (ctx: { pluginId: string }, world: ReturnType<typeof createTestPluginWorld>) => void;
      };
    };
    const serverModule = (await import(serverHref)) as {
      readonly exportArtifact: typeof exportArtifact;
    };

    const artifact = serverModule.exportArtifact(makeSpawnFixtureMap());
    const plugin = runtimeModule.createRuntimeAdapter({ getArtifact: () => artifact });
    const world = createTestPluginWorld();

    plugin.onInit?.({ pluginId: plugin.id }, world);

    expect(countAlivePlayers(world)).toBe(3);
  });
});

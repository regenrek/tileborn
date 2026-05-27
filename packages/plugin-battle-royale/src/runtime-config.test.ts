import { MapObject, makeTileborneMap } from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { MOVEMENT, PROJECTILE, SPAWN_POINT_KIND } from "./constants.js";
import {
  LAST_FACING_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  VELOCITY_COMPONENT,
  type Position,
  type Projectile,
} from "./ecs/components.js";
import { exportArtifact } from "./export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { createRuntimeAdapter } from "./runtime-adapter.js";
import { createTestPluginWorld } from "./test-plugin-world.js";

const OVERRIDE_PROJECTILE_SPEED = 600;
const DT = 1 / MOVEMENT.tickRate;

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

const makeSpawnFixtureMap = (battleRoyale?: Record<string, unknown>) =>
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
    ...(battleRoyale ? { properties: { battleRoyale } } : {}),
  });

describe("BattleRoyaleConfig overrides", () => {
  it("propagates host projectile.speed override through createRuntimeAdapter", () => {
    const artifact = exportArtifact(makeSpawnFixtureMap());
    const world = createTestPluginWorld();
    world.registerComponent(POSITION_COMPONENT);
    world.registerComponent(VELOCITY_COMPONENT);
    world.registerComponent(PLAYER_COMPONENT);
    world.registerComponent(LAST_FACING_COMPONENT);
    world.registerComponent(PROJECTILE_COMPONENT);

    const plugin = createRuntimeAdapter({
      getArtifact: () => artifact,
      getPlayerInput: () => ({ tick: 1, seq: 1, dir: 0, shoot: true }),
      config: {
        projectile: { speed: OVERRIDE_PROJECTILE_SPEED },
      },
    });

    plugin.onTick?.(world, DT, 1);
    plugin.onTick?.(world, DT, 2);

    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const projectiles = world.getComponent<Projectile>(PROJECTILE_COMPONENT);
    const [projectileEntity] = projectiles.entries().next().value as [number, Projectile];
    const start = positions.get(projectileEntity)!;

    plugin.onTick?.(world, DT, 3);

    const end = positions.get(projectileEntity)!;
    expect(end.x - start.x).toBeCloseTo(OVERRIDE_PROJECTILE_SPEED * DT);
    expect(end.x - start.x).not.toBeCloseTo(PROJECTILE.speed * DT);
  });

  it("merges map.properties.battleRoyale.projectile.speed at adapter init", () => {
    const artifact = exportArtifact(
      makeSpawnFixtureMap({
        projectile: { speed: OVERRIDE_PROJECTILE_SPEED },
      }),
    );
    const world = createTestPluginWorld();
    world.registerComponent(POSITION_COMPONENT);
    world.registerComponent(VELOCITY_COMPONENT);
    world.registerComponent(PLAYER_COMPONENT);
    world.registerComponent(LAST_FACING_COMPONENT);
    world.registerComponent(PROJECTILE_COMPONENT);

    const plugin = createRuntimeAdapter({
      getArtifact: () => artifact,
      getPlayerInput: () => ({ tick: 1, seq: 1, dir: 0, shoot: true }),
    });

    plugin.onTick?.(world, DT, 1);
    plugin.onTick?.(world, DT, 2);

    const positions = world.getComponent<Position>(POSITION_COMPONENT);
    const projectiles = world.getComponent<Projectile>(PROJECTILE_COMPONENT);
    const [projectileEntity] = projectiles.entries().next().value as [number, Projectile];
    const start = positions.get(projectileEntity)!;

    plugin.onTick?.(world, DT, 3);

    const end = positions.get(projectileEntity)!;
    expect(end.x - start.x).toBeCloseTo(OVERRIDE_PROJECTILE_SPEED * DT);
  });
});

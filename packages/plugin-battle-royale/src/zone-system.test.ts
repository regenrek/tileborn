import { MapObject, makeTileborneMap } from "@tileborne/core";
import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import { Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { DAMAGE, SPAWN_POINT_KIND } from "./constants.js";
import { PLAYER_COMPONENT, POSITION_COMPONENT, VELOCITY_COMPONENT, type Player } from "./ecs/components.js";
import { createDamageSystemState, recordMatchStarters, runDamageSystem } from "./ecs/damage-system.js";
import { runZoneSystem } from "./ecs/zone-system.js";
import {
  DEFAULT_ZONE_SCHEDULE,
  getZone,
  initZoneFromArtifact,
  resetZoneSingleton,
  type ZoneScheduleConfig,
} from "./ecs/zone.js";
import { exportArtifact } from "./export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { createRuntimeAdapter } from "./runtime-adapter.js";
import { createTestPluginWorld } from "./test-plugin-world.js";

const TICK_DT = 1 / DEFAULT_ZONE_SCHEDULE.tickRate;

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

const makeFixtureArtifact = () =>
  exportArtifact(
    makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 16, 16),
        makeTestObject(TEST_OBJECT_IDS[1], SPAWN_POINT_KIND, 4, 4),
        makeTestObject(TEST_OBJECT_IDS[3], "shrink-zone-anchor", 16, 16),
      ],
    }),
  );

const fastTestSchedule = (): ZoneScheduleConfig => ({
  waitSec: 0,
  shrinkSec: 1,
  holdSec: 1,
  shrinkPhases: 3,
  radiusFactor: 0.5,
  tickRate: 20,
});

const createMsgCollector = () => {
  const frames: Uint8Array[] = [];
  return {
    msgOut: {
      push: (frame: Uint8Array) => {
        frames.push(frame);
      },
    },
    frames,
    decodeAll: () => frames.map((frame) => BattleRoyaleProtocol.decodeMessage(frame)),
  };
};

const runZoneTick = (
  world: ReturnType<typeof createTestPluginWorld>,
  tick: number,
  damageState: ReturnType<typeof createDamageSystemState>,
  schedule: ZoneScheduleConfig,
  msgOut: { push: (frame: Uint8Array) => void },
): void => {
  runZoneSystem(
    world,
    TICK_DT,
    tick,
    { damageState, schedule },
  );
  runDamageSystem(world, tick, { msgOut }, damageState);
};

afterEach(() => {
  resetZoneSingleton();
});

const registerPlayerStores = (world: ReturnType<typeof createTestPluginWorld>): void => {
  world.registerComponent(POSITION_COMPONENT);
  world.registerComponent(VELOCITY_COMPONENT);
  world.registerComponent(PLAYER_COMPONENT);
};

describe("zone damage", () => {
  it("does not damage players inside the zone", () => {
    const world = createTestPluginWorld();
    const artifact = makeFixtureArtifact();
    initZoneFromArtifact(world, artifact, { damagePerSecOutside: 50 });
    registerPlayerStores(world);

    const inside = world.createEntity();
    world.getComponent(POSITION_COMPONENT).set(inside, { x: 16, y: 16 });
    world.getComponent(PLAYER_COMPONENT).set(inside, {
      playerId: "player-inside-a",
      health: DAMAGE.playerHealth,
      alive: 1,
      team: "solo",
    });

    const alsoInside = world.createEntity();
    world.getComponent(POSITION_COMPONENT).set(alsoInside, { x: 15, y: 15 });
    world.getComponent(PLAYER_COMPONENT).set(alsoInside, {
      playerId: "player-inside-b",
      health: DAMAGE.playerHealth,
      alive: 1,
      team: "solo",
    });

    const collector = createMsgCollector();
    const damageState = createDamageSystemState();
    const schedule = fastTestSchedule();

    for (let tick = 1; tick <= 40; tick += 1) {
      runZoneTick(world, tick, damageState, schedule, collector.msgOut);
    }

    const players = world.getComponent<Player>(PLAYER_COMPONENT);
    for (const [, player] of players.entries()) {
      expect(player.health).toBe(DAMAGE.playerHealth);
      expect(player.alive).toBe(1);
    }
    expect(collector.decodeAll()).toEqual([]);
  });

  it("damages players outside the zone at the configured rate", () => {
    const world = createTestPluginWorld();
    const artifact = makeFixtureArtifact();
    initZoneFromArtifact(world, artifact, { damagePerSecOutside: 100 });
    registerPlayerStores(world);

    const entity = world.createEntity();
    world.getComponent(POSITION_COMPONENT).set(entity, { x: 100, y: 100 });
    world.getComponent(PLAYER_COMPONENT).set(entity, {
      playerId: "player-outside",
      health: DAMAGE.playerHealth,
      alive: 1,
      team: "solo",
    });

    const collector = createMsgCollector();
    const damageState = createDamageSystemState();
    const schedule = fastTestSchedule();

    runZoneTick(world, 1, damageState, schedule, collector.msgOut);

    const player = world.getComponent<Player>(PLAYER_COMPONENT).get(entity);
    expect(player?.health).toBeCloseTo(DAMAGE.playerHealth - 100 * TICK_DT, 5);
    expect(player?.alive).toBe(1);

    for (let tick = 2; tick <= 20; tick += 1) {
      runZoneTick(world, tick, damageState, schedule, collector.msgOut);
    }

    const afterOneSecond = world.getComponent<Player>(PLAYER_COMPONENT).get(entity);
    expect(afterOneSecond?.health).toBeCloseTo(DAMAGE.playerHealth - 100, 1);
  });
});

describe("zone shrink schedule", () => {
  it("shrinks monotonically through each configured phase", () => {
    const world = createTestPluginWorld();
    const artifact = makeFixtureArtifact();
    initZoneFromArtifact(world, artifact);
    registerPlayerStores(world);

    const schedule = fastTestSchedule();
    const damageState = createDamageSystemState();
    const collector = createMsgCollector();
    const samples: number[] = [];

    const totalTicks =
      schedule.shrinkPhases * (schedule.shrinkSec + schedule.holdSec) * schedule.tickRate;

    for (let tick = 1; tick <= totalTicks; tick += 1) {
      runZoneTick(world, tick, damageState, schedule, collector.msgOut);
      const zone = getZone(world);
      expect(zone).toBeDefined();
      samples.push(zone!.currentRadius);
    }

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!).toBeLessThanOrEqual(samples[index - 1]! + 1e-6);
    }

    const finalRadius = samples.at(-1);
    const initialRadius = artifact.shrinkSchedule.startRadiusTiles;
    expect(finalRadius).toBeLessThan(initialRadius);
  });
});

describe("last-man-standing", () => {
  it("emits GameOver when one player remains alive", () => {
    const world = createTestPluginWorld();
    const artifact = makeFixtureArtifact();
    initZoneFromArtifact(world, artifact, { damagePerSecOutside: 1_000 });
    registerPlayerStores(world);

    const inside = world.createEntity();
    world.getComponent(POSITION_COMPONENT).set(inside, { x: 16, y: 16 });
    world.getComponent(PLAYER_COMPONENT).set(inside, {
      playerId: "player-inside",
      health: DAMAGE.playerHealth,
      alive: 1,
      team: "solo",
    });

    const outside = world.createEntity();
    world.getComponent(POSITION_COMPONENT).set(outside, { x: 100, y: 100 });
    world.getComponent(PLAYER_COMPONENT).set(outside, {
      playerId: "player-outside",
      health: DAMAGE.playerHealth,
      alive: 1,
      team: "solo",
    });

    const collector = createMsgCollector();
    const damageState = createDamageSystemState();
    recordMatchStarters(world, damageState);
    const schedule = fastTestSchedule();

    for (let tick = 1; tick <= 10; tick += 1) {
      runZoneTick(world, tick, damageState, schedule, collector.msgOut);
    }

    const messages = collector.decodeAll();
    const kill = messages.find((message) => message._tag === "PlayerKilled");
    const gameOver = messages.find((message) => message._tag === "GameOver");

    expect(kill?._tag).toBe("PlayerKilled");
    if (kill?._tag === "PlayerKilled") {
      expect(kill.killer).toBe(BattleRoyaleProtocol.makePlayerId("zone"));
      expect(kill.victim).toBe(BattleRoyaleProtocol.makePlayerId("player-outside"));
    }

    expect(gameOver?._tag).toBe("GameOver");
    if (gameOver?._tag === "GameOver") {
      expect(gameOver.winner).toBe(BattleRoyaleProtocol.makePlayerId("player-inside"));
    }
  });

  it("routes zone ticks through the runtime adapter msgOut queue", () => {
    const artifact = makeFixtureArtifact();
    const world = createTestPluginWorld();
    const collector = createMsgCollector();
    const plugin = createRuntimeAdapter({
      getArtifact: () => artifact,
      msgOut: collector.msgOut,
      config: {
        zone: {
          damagePerSecOutside: 1_000,
          schedule: {
            waitSec: 0,
            shrinkSec: 1,
            holdSec: 1,
            shrinkPhases: 1,
          },
        },
      },
    });

    plugin.onInit?.({ pluginId: plugin.id }, world);

    for (let tick = 1; tick <= 5; tick += 1) {
      plugin.onTick?.(world, TICK_DT, tick);
    }

    expect(collector.frames.length).toBeGreaterThan(0);
    expect(collector.decodeAll().some((message) => message._tag === "PlayerKilled")).toBe(true);
  });
});

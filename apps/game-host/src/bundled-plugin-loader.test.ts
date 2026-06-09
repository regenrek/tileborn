import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import { LOOT_CRATE_KIND } from "@tileborne/plugin-battle-royale/constants";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { bundledPlugin, createBundledPluginLoader } from "./bundled-plugin-loader.js";

const generatedRuntimeTypesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".generated/plugin-runtime.d.ts",
);
const optionalDirectionPattern = /readonly dir\?: 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7;/gu;
const clipIdAt = (index: number): string => `clip:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const makeRuntimeArtifact = () => ({
  schemaVersion: 1,
  maxPlayers: 1,
  spawnPoints: [{ x: 10, y: 20, team: "solo", weight: 1 }],
  spawnAnchors: [{ x: 10, y: 20, team: "solo", weight: 1 }],
  shrinkSchedule: {
    centerX: 16,
    centerY: 16,
    startRadiusTiles: 16,
    endRadiusTiles: 4,
    shrinkIntervalMs: 30_000,
    damagePerSecond: 5,
  },
  lootTables: [{ itemKind: "rifle", tier: "rare", weight: 1 }],
  objectPlacements: [
    {
      objectId: "object:00000000-0000-4000-8000-000000000103",
      role: "loot-crate",
      kind: LOOT_CRATE_KIND,
      x: 12,
      y: 18,
      properties: { itemKind: "rifle", tier: "rare", weight: 1 },
    },
  ],
  playerModels: [
    {
      id: "model:plain",
      label: "Plain",
      ref: {
        packId: "pack:00000000-0000-4000-8000-000000000002",
        kind: "sprite",
        refId: "placeable:plain",
        clipId: clipIdAt(0),
      },
      defaultClipId: clipIdAt(0),
      clips: {
        idle: clipIdAt(0),
        walk: clipIdAt(1),
        run: clipIdAt(2),
        shoot: clipIdAt(3),
        reload: clipIdAt(4),
        hit: clipIdAt(5),
        death: clipIdAt(6),
        dash: clipIdAt(7),
        pickup: clipIdAt(8),
      },
      anchor: { x: 0.5, y: 1 },
      hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
      muzzle: { x: 0.75, y: 0.45 },
    },
  ],
  defaultPlayerModelId: "model:plain",
});

describe("createBundledPluginLoader", () => {
  it("keeps generated BR input declarations aligned with shoot-only frames", () => {
    const source = readFileSync(generatedRuntimeTypesPath, "utf8");

    expect(source.match(optionalDirectionPattern)).toHaveLength(2);
    expect(source).not.toMatch(/readonly dir: 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7;/u);
  });

  it("registers the bundled BR adapter and emits live tick snapshots", async () => {
    const frames: Uint8Array[] = [];
    let replayFrames: readonly Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      getPlayerIds: () => ["player-1", "player-2"],
      emitFrame: (frame) => {
        frames.push(frame);
      },
      setReplayFrames: (frames) => {
        replayFrames = frames;
      },
      getInput: (playerId) =>
        playerId === "player-1"
          ? { tick: 1, seq: 1, dir: 0, shoot: false, reload: false, interact: false, drop: false, abilities: [] }
          : undefined,
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = "id" in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error("bundled plugin did not expose runtime hooks");
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const messages = frames.map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame));
    const welcome = messages.find((message) => message._tag === "WelcomeSnapshot");
    const delta = messages.find((message) => message._tag === "DeltaSnapshot");

    expect(welcome?._tag).toBe("WelcomeSnapshot");
    expect(delta?._tag).toBe("DeltaSnapshot");
    const replayWelcome = replayFrames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === "WelcomeSnapshot");
    expect(replayWelcome?._tag).toBe("WelcomeSnapshot");
    if (welcome?._tag === "WelcomeSnapshot" && delta?._tag === "DeltaSnapshot") {
      expect(welcome.players).toHaveLength(2);
      const initialPlayer = welcome.players.find((player) => player.id === "player-1");
      const movedPlayer = delta.updated.find((player) => player.id === "player-1");
      expect(initialPlayer).toBeDefined();
      expect(movedPlayer).toBeDefined();
      if (replayWelcome?._tag === "WelcomeSnapshot") {
        const replayPlayer = replayWelcome.players.find((player) => player.id === "player-1");
        expect(replayWelcome.tick).toBe(1);
        expect(replayPlayer?.x).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
      expect(movedPlayer?.x._tag).toBe("Some");
      if (movedPlayer?.x._tag === "Some") {
        expect(movedPlayer.x.value).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
    }
  });

  it("accepts shoot-only bundled runtime input without a movement direction", async () => {
    const frames: Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      getPlayerIds: () => ["player-1"],
      emitFrame: (frame) => {
        frames.push(frame);
      },
	    getInput: (playerId) =>
	      playerId === "player-1"
	        ? { tick: 1, seq: 1, shoot: true, reload: false, interact: false, drop: false, abilities: [], aimDeg: 90, swapSlot: 2 }
	        : undefined,
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = "id" in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error("bundled plugin did not expose runtime hooks");
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const delta = frames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === "DeltaSnapshot");

    expect(delta?._tag).toBe("DeltaSnapshot");
    if (delta?._tag === "DeltaSnapshot") {
      expect(delta.projectilesUpdated).toHaveLength(1);
      expect(delta.projectilesUpdated[0]?.weaponSlot._tag).toBe("Some");
      expect(
        delta.projectilesUpdated[0]?.weaponSlot._tag === "Some"
          ? delta.projectilesUpdated[0].weaponSlot.value
          : undefined,
      ).toBe(2);
    }
  });

  it("uses supplied runtimeArtifact for spawns and object snapshots", async () => {
    const frames: Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      runtimeArtifact: makeRuntimeArtifact(),
      emitFrame: (frame) => {
        frames.push(frame);
      },
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = "id" in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error("bundled plugin did not expose runtime hooks");
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const welcome = frames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === "WelcomeSnapshot");

    expect(welcome?._tag).toBe("WelcomeSnapshot");
    if (welcome?._tag === "WelcomeSnapshot") {
      expect(welcome.players[0]?.x).toBe(10);
      expect(welcome.players[0]?.y).toBe(20);
      expect(welcome.objects?.some((object) => object.x === 12 && object.y === 18 && object.lootSource !== undefined)).toBe(true);
    }
  });
});

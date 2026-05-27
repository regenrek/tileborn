// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { Option } from "effect";
import { PLUGIN_ID, decodeServerFrame } from "@tileborne/plugin-battle-royale";

import {
  getPlaytestRuntimeMetrics,
  getPlaytestRuntimeSnapshot,
  setPlaytestRuntimeInput,
  setPlaytestRuntimeSnapshotNotifier,
  startPlaytestRuntimeHost,
  stopPlaytestRuntimeHost,
} from "../playtest-runtime-host.js";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const battleRoyalePluginRoot = path.resolve(desktopRoot, "../../packages/plugin-battle-royale");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const waitForTickCount = async (sessionId: string, minimumTickCount: number): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const metrics = getPlaytestRuntimeMetrics(sessionId);
    if (metrics && metrics.tickCount >= minimumTickCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${sessionId} to reach tickCount ${minimumTickCount}`);
};

describe("playtest-runtime-host", () => {
  let tempRoot: string | undefined;
  const sessionIds: string[] = [];

  afterEach(async () => {
    setPlaytestRuntimeSnapshotNotifier(undefined);
    for (const sessionId of sessionIds.splice(0)) {
      await stopPlaytestRuntimeHost(sessionId);
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("loads entry.runtime plugins and advances runtime metrics", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-"));
    const artifactDirectory = path.join(tempRoot, "artifact");
    const pluginRoot = path.join(tempRoot, "plugin");
    await mkdir(path.join(pluginRoot, "dist"), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, "map.json"), JSON.stringify({ layers: [] }), "utf8");
    await writeFile(
      path.join(pluginRoot, "tileborne-plugin.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "@tileborne-plugins/test-runtime",
          name: "test-runtime",
          version: "0.0.0",
          entry: { runtime: "./dist/runtime.js" },
          contributes: {},
          permissions: [],
          dependsOn: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(pluginRoot, "dist", "runtime.js"),
      "export default { id: '@tileborne-plugins/test-runtime', onTick() {} };\n",
      "utf8",
    );

    const sessionId = "runtime-host-test";
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      artifactDirectory,
      pluginInstalls: [{ pluginId: "@tileborne-plugins/test-runtime", rootPath: pluginRoot }],
    });

    await waitForTickCount(sessionId, 5);
    expect(getPlaytestRuntimeMetrics(sessionId)?.tickCount).toBeGreaterThanOrEqual(5);
  });

  it("forwards playtest input to the battle royale adapter and updates player position", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-movement-"));
    const artifactDirectory = path.join(tempRoot, "artifact");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      path.join(artifactDirectory, "map.json"),
      JSON.stringify({
        id: "map:test",
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: "obj:00000000-0000-4000-8000-000000000001",
            kind: "spawn-point",
            x: 10,
            y: 20,
            layerId: "layer:00000000-0000-4000-8000-000000000001",
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      }),
      "utf8",
    );

    const sessionId = "runtime-host-movement-test";
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    const before = getPlaytestRuntimeSnapshot(sessionId);
    expect(before?.players[0]).toMatchObject({ playerId: "player-1", x: 10, y: 20 });

    setPlaytestRuntimeInput(sessionId, "player-1", { tick: 3, seq: 1, dir: 0, shoot: false });
    await waitForTickCount(sessionId, 6);

    const after = getPlaytestRuntimeSnapshot(sessionId);
    expect(after?.players[0]?.x).toBeGreaterThan(10);
    expect(getPlaytestRuntimeMetrics(sessionId)?.playerCount).toBe(1);
  });

  it("feeds authored battle royale settings into runtime HUD snapshots", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-settings-"));
    const artifactDirectory = path.join(tempRoot, "artifact");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      path.join(artifactDirectory, "map.json"),
      JSON.stringify({
        id: "map:test",
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: "obj:00000000-0000-4000-8000-000000000001",
            kind: "spawn-point",
            x: 10,
            y: 20,
            layerId: "layer:00000000-0000-4000-8000-000000000001",
            properties: {},
          },
        ],
        properties: {
          maxPlayers: 1,
          battleRoyale: {
            damage: { playerHealth: 55 },
            zone: {
              damagePerSecOutside: 9,
              schedule: { waitSec: 5, shrinkSec: 5, holdSec: 5, shrinkPhases: 2 },
            },
          },
        },
      }),
      "utf8",
    );

    const sessionId = "runtime-host-settings-test";
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    const hud = getPlaytestRuntimeMetrics(sessionId)?.hud;
    expect(hud?.localPlayer).toMatchObject({
      playerId: "player-1",
      health: 55,
    });
    expect(hud?.totalPlayers).toBe(1);
  });

  it("forwards aim and weapon slot input to the battle royale projectile system", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-projectile-"));
    const artifactDirectory = path.join(tempRoot, "artifact");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      path.join(artifactDirectory, "map.json"),
      JSON.stringify({
        id: "map:test",
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: "obj:00000000-0000-4000-8000-000000000001",
            kind: "spawn-point",
            x: 10,
            y: 20,
            layerId: "layer:00000000-0000-4000-8000-000000000001",
            properties: {},
          },
        ],
        properties: { maxPlayers: 1 },
      }),
      "utf8",
    );

    const decodedFrames: unknown[] = [];
    setPlaytestRuntimeSnapshotNotifier((_sessionId, frame) => {
      decodedFrames.push(decodeServerFrame(frame));
    });

    const sessionId = "runtime-host-projectile-test";
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
    });

    await waitForTickCount(sessionId, 2);
    setPlaytestRuntimeInput(sessionId, "player-1", {
      tick: 3,
      seq: 1,
      dir: 0,
      shoot: true,
      aimDeg: 90,
      weaponSlot: 2,
    });
    await waitForTickCount(sessionId, 6);

    const deltaWithProjectile = decodedFrames.find(
      (frame): frame is { readonly projectilesUpdated: readonly Record<string, unknown>[] } =>
        isRecord(frame) &&
        frame._tag === "DeltaSnapshot" &&
        Array.isArray(frame.projectilesUpdated) &&
        frame.projectilesUpdated.length > 0,
    );
    expect(deltaWithProjectile).toBeDefined();
    const projectile = deltaWithProjectile?.projectilesUpdated[0];
    expect(projectile).toBeDefined();
    expect(Option.getOrUndefined(projectile?.weaponSlot as Option.Option<number>)).toBe(2);
    expect(Option.getOrUndefined(projectile?.vx as Option.Option<number>)).toBeCloseTo(0);
    expect(Option.getOrUndefined(projectile?.vy as Option.Option<number>)).toBeGreaterThan(0);
  });
});

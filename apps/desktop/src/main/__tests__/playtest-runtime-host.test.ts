// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AssetLibraryReference,
  PlayerModelClipSet,
  PlayerModelRef,
  gameObjectTypeIdForKey,
  makeClipId,
  makePackId,
} from "@tileborne/core";
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
const packId = makePackId("550e8400-e29b-41d4-a716-446655440999");
const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544000${index}`);

const playerModels = [
  new PlayerModelRef({
    id: "model:test",
    label: "Test Model",
    ref: new AssetLibraryReference({
      packId,
      kind: "sprite",
      refId: "placeable:test",
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
    muzzle: { x: 0.75, y: 0.45 },
  }),
] as const;

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

  it("routes a legacy-`kind` map.json through the shared migrate+normalize contract before the plugin reads it", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-legacy-"));
    const artifactDirectory = path.join(tempRoot, "artifact");
    const pluginRoot = path.join(tempRoot, "plugin");
    const capturePath = path.join(tempRoot, "captured.json");
    await mkdir(path.join(pluginRoot, "dist"), { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });

    // Pre-ADR-0019 map: free-string `kind`, omitted optional object keys
    // (width/height) and a placement that omits its optional sub-keys. The host
    // must migrate + normalize it (single shared plain-JSON contract) before the
    // plugin reads it, instead of bypassing the normalize step.
    await writeFile(
      path.join(artifactDirectory, "map.json"),
      JSON.stringify({
        id: "map:5b1901ca-1abd-42d6-aeac-553b34b9bda6",
        schemaVersion: 1,
        size: { width: 32, height: 32 },
        tileSize: { width: 32, height: 32 },
        layers: [],
        objects: [
          {
            id: "object:f08061c1-423d-4532-b972-0cb221b1a08a",
            kind: "spawn-point",
            x: 10,
            y: 20,
            layerId: "layer:00000000-0000-4000-8000-000000000001",
            properties: {},
            placement: {
              placeableId: "placeable:11111111-1111-4111-8111-111111111111",
              source: "manual",
            },
          },
        ],
        properties: { maxPlayers: 1 },
      }),
      "utf8",
    );

    await writeFile(
      path.join(pluginRoot, "tileborne-plugin.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "@tileborne-plugins/capture-runtime",
        name: "capture-runtime",
        version: "0.0.0",
        entry: { runtime: "./dist/runtime.js" },
        contributes: {},
        permissions: [],
        dependsOn: [],
      }),
      "utf8",
    );

    // The adapter captures the exact map JSON the host hands it. Key presence
    // survives JSON serialization (the filled values are `undefined`, which
    // serialization would drop), so we assert on migrated kind + key presence.
    await writeFile(
      path.join(pluginRoot, "dist", "runtime.js"),
      [
        'import { writeFileSync } from "node:fs";',
        "export const createRuntimeAdapter = (host) => {",
        "  const artifact = host.getArtifact();",
        "  const obj = artifact.objects[0];",
        "  const placement = obj.placement;",
        `  writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
        "    kind: obj.kind,",
        '    hasWidthKey: "width" in obj,',
        '    hasHeightKey: "height" in obj,',
        '    hasPlacementKey: "placement" in obj,',
        '    placementHasPackIdKey: placement && typeof placement === "object" ? "packId" in placement : false,',
        '    placementHasAssetIdKey: placement && typeof placement === "object" ? "assetId" in placement : false,',
        "  }));",
        '  return { id: "@tileborne-plugins/capture-runtime", onTick() {} };',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const sessionId = "runtime-host-legacy-test";
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      artifactDirectory,
      pluginInstalls: [{ pluginId: "@tileborne-plugins/capture-runtime", rootPath: pluginRoot }],
    });

    await waitForTickCount(sessionId, 1);

    const captured = JSON.parse(await readFile(capturePath, "utf8")) as {
      readonly kind: string;
      readonly hasWidthKey: boolean;
      readonly hasHeightKey: boolean;
      readonly hasPlacementKey: boolean;
      readonly placementHasPackIdKey: boolean;
      readonly placementHasAssetIdKey: boolean;
    };

    // Migrated: legacy slug resolved to the catalog GameObjectTypeId.
    expect(captured.kind).toBe(gameObjectTypeIdForKey("spawn-point"));
    // Normalized: omitted optional object/placement keys are now present.
    expect(captured.hasWidthKey).toBe(true);
    expect(captured.hasHeightKey).toBe(true);
    expect(captured.hasPlacementKey).toBe(true);
    expect(captured.placementHasPackIdKey).toBe(true);
    expect(captured.placementHasAssetIdKey).toBe(true);
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
            id: "object:00000000-0000-4000-8000-000000000001",
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
      playerModels,
    });

    await waitForTickCount(sessionId, 2);
    const before = getPlaytestRuntimeSnapshot(sessionId);
    expect(before?.players[0]).toMatchObject({ playerId: "player-1", x: 10, y: 20 });

    setPlaytestRuntimeInput(sessionId, "player-1", {
      tick: 3,
      seq: 1,
      dir: 0,
      shoot: false,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
    });
    await waitForTickCount(sessionId, 6);

    const after = getPlaytestRuntimeSnapshot(sessionId);
    expect(after?.players[0]?.x).toBeGreaterThan(10);
    expect(getPlaytestRuntimeMetrics(sessionId)?.playerCount).toBe(1);
  });

  it("rejects battle royale playtest startup when the map has no authored spawn anchors", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-invalid-br-"));
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
        objects: [],
        properties: { maxPlayers: 1 },
      }),
      "utf8",
    );

    const sessionId = "runtime-host-invalid-br-test";

    await expect(
      startPlaytestRuntimeHost({
        sessionId,
        artifactDirectory,
        pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
        playerModels,
      }),
    ).rejects.toThrow(/spawnAnchors/);
    expect(getPlaytestRuntimeMetrics(sessionId)).toBeUndefined();
    expect(getPlaytestRuntimeSnapshot(sessionId)).toBeUndefined();
  });

  it("starts battle royale from a canonical gobj map and preserves authored spawn coordinates", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileborne-runtime-host-canonical-br-"));
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
            id: "object:00000000-0000-4000-8000-000000000001",
            kind: gameObjectTypeIdForKey("spawn-point"),
            x: 80,
            y: 96,
            layerId: "layer:00000000-0000-4000-8000-000000000001",
            properties: { team: "solo", weight: 1 },
          },
        ],
        properties: { maxPlayers: 1 },
      }),
      "utf8",
    );

    const sessionId = "runtime-host-canonical-br-test";
    sessionIds.push(sessionId);

    await startPlaytestRuntimeHost({
      sessionId,
      artifactDirectory,
      pluginInstalls: [{ pluginId: PLUGIN_ID, rootPath: battleRoyalePluginRoot }],
      playerModels,
    });

    await waitForTickCount(sessionId, 2);

    const snapshot = getPlaytestRuntimeSnapshot(sessionId);
    expect(snapshot?.players).toEqual([
      { playerId: "player-1", x: 80, y: 96 },
    ]);
    expect(snapshot?.frame).toBeInstanceOf(Uint8Array);
    const frame = decodeServerFrame(snapshot!.frame!);
    expect(frame).toMatchObject({
      _tag: "WelcomeSnapshot",
      players: [
        {
          id: "player-1",
          modelId: "model:test",
          animation: { modelId: "model:test", clipKey: "idle" },
        },
      ],
    });
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
            id: "object:00000000-0000-4000-8000-000000000001",
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
      playerModels,
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
            id: "object:00000000-0000-4000-8000-000000000001",
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
      playerModels,
    });

    await waitForTickCount(sessionId, 2);
    setPlaytestRuntimeInput(sessionId, "player-1", {
      tick: 3,
      seq: 1,
      dir: 0,
      shoot: true,
      reload: false,
      interact: false,
      drop: false,
      abilities: [],
      aimDeg: 90,
      swapSlot: 2,
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

    const diagnostics = getPlaytestRuntimeMetrics(sessionId)?.diagnostics;
    expect(diagnostics?.bandwidth.inputEvents).toBeGreaterThanOrEqual(1);
    expect(diagnostics?.bandwidth.snapshotFrames).toBeGreaterThan(0);
    expect(diagnostics?.entities.players).toBe(1);
    expect(diagnostics?.debugOverlay.spawnSlots).toBe(1);
    expect(diagnostics?.debugOverlay.hitboxes).toBeGreaterThan(0);
    expect(diagnostics?.replay.rollingHash).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    expect(diagnostics?.replay.deterministicVerifier).toBe("battle-royale-replay-harness");
    expect(diagnostics?.budgets.snapshotOverBudget).toBe(false);
    expect(diagnostics?.budgets.snapshotFrameBudgetBytes).toBe(8_192);
    expect(diagnostics?.budgets.inputBacklogBudgetFrames).toBeGreaterThan(0);
  });
});

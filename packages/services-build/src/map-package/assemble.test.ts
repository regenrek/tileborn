import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GameObjectCatalog,
  GameModeId,
  PluginId,
  decodePersistedTileborneMapJson,
} from "@tileborne/core";
import { ModeDataExportError } from "@tileborne/plugin-api";
import { loadRuntimeMapPackage } from "@tileborne/runtime/map-package";
import { Effect, Result, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { assembleRuntimeMapPackage } from "./assemble.js";

const UUID = "12345678-1234-4234-8234-123456789abc";
const TYPE_UUID = UUID.replace("1234567", "aaaaaaa");
const PLUGIN = "@tileborne-plugins/example-mode";

const pluginId = Schema.decodeUnknownSync(PluginId)(PLUGIN);
const modeId = Schema.decodeUnknownSync(GameModeId)(PLUGIN);

const catalog = Schema.decodeUnknownSync(GameObjectCatalog)({
  id: `catalog:${UUID}`,
  schemaVersion: 1,
  objectTypes: [
    {
      id: `gobj:${TYPE_UUID}`,
      schemaVersion: 1,
      label: "Spawn Pad",
      family: "spawn",
      components: [{ _tag: "spawn-point", data: {} }],
      instanceDefaults: {},
    },
  ],
});

const map = decodePersistedTileborneMapJson({
  id: `map:${UUID}`,
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [
    {
      kind: "object",
      id: `layer:${UUID}`,
      name: "Objects",
      visible: true,
      opacity: 1,
      objectIds: [`object:${UUID}`],
    },
  ],
  objects: [
    {
      id: `object:${UUID}`,
      kind: `gobj:${TYPE_UUID}`,
      x: 3,
      y: 4,
      layerId: `layer:${UUID}`,
      properties: { team: "alpha" },
    },
  ],
  properties: { [PLUGIN]: { maxPlayers: 4 }, editorOnlyScalar: 7 },
});

const baseInput = (outputDirectory: string) => ({
  projectId: `project:${UUID}`,
  map,
  activeMode: { modeId, pluginId },
  pluginCatalogs: [
    { pluginId, catalogs: [{ contributionId: "example/catalog", catalog }] },
  ],
  playerModels: [],
  playerCapacity: 4,
  engineVersion: "0.1.0",
  outputDirectory,
});

const tempDirs: string[] = [];
const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "tileborne-mappkg-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const fsReader = (directory: string) => async (entryPath: string) => {
  try {
    return new Uint8Array(await readFile(path.join(directory, entryPath)));
  } catch {
    return undefined;
  }
};

describe("assembleRuntimeMapPackage (ADR-0030)", () => {
  it("writes the canonical layout that loadRuntimeMapPackage round-trips", async () => {
    const dir = await makeTempDir();
    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        assets: [
          {
            path: "assets/ab/sprite.png",
            bytes: new Uint8Array([1, 2, 3]),
            assetId: `asset:${UUID}`,
          },
        ],
      }),
    );

    expect(assembled.mapPackage.placements).toHaveLength(1);
    expect(assembled.mapPackage.placements[0]?.instanceProperties).toEqual({ team: "alpha" });
    expect(assembled.mapPackage.catalog[0]?.origin).toEqual({ _tag: "plugin", pluginId });
    // Only namespaced object sections survive into settings.
    expect(Object.keys(assembled.mapPackage.settings)).toEqual([PLUGIN]);

    const loaded = Result.getOrThrow(await loadRuntimeMapPackage(fsReader(dir)));
    expect(loaded.manifest.packageId).toBe(assembled.mapPackage.manifest.packageId);
    // The neutral capacity rides in the manifest (M2 review, F2).
    expect(loaded.manifest.playerCapacity).toBe(4);
    expect(loaded.placements).toHaveLength(1);
    expect(loaded.assets[0]?.path).toBe("assets/ab/sprite.png");
    expect(loaded.map.size.width).toBe(8);

    // The asset payload itself is written content-addressed next to the entries.
    const payload = await readFile(path.join(dir, "assets/ab/sprite.png"));
    expect([...payload]).toEqual([1, 2, 3]);
    expect(loaded.manifest.entryHashes["assets/ab/sprite.png"]).toBe(loaded.assets[0]?.hash);
  });

  it("calls the active mode's exporter with the neutral projections and namespaces its section", async () => {
    const dir = await makeTempDir();
    let seenSettings: unknown;
    let seenPlacements = 0;
    const assembled = await Effect.runPromise(
      assembleRuntimeMapPackage({
        ...baseInput(dir),
        modeDataExporter: (context) => {
          seenSettings = context.settings;
          seenPlacements = context.placements.length;
          return Result.succeed({ zone: { phases: 3 } });
        },
      }),
    );
    expect(seenSettings).toEqual({ maxPlayers: 4 });
    expect(seenPlacements).toBe(1);
    expect(assembled.mapPackage.modeData).toEqual({ [PLUGIN]: { zone: { phases: 3 } } });
  });

  it("fails fast when a placement references a type missing from the merged catalog", async () => {
    const dir = await makeTempDir();
    const result = await Effect.runPromise(
      Effect.result(
        assembleRuntimeMapPackage({
          ...baseInput(dir),
          pluginCatalogs: [],
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("missing from the merged catalog");
    }
  });

  it("fails when the exporter rejects the map", async () => {
    const dir = await makeTempDir();
    const result = await Effect.runPromise(
      Effect.result(
        assembleRuntimeMapPackage({
          ...baseInput(dir),
          modeDataExporter: () =>
            Result.fail(new ModeDataExportError({ pluginId: PLUGIN, message: "no zone config" })),
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("no zone config");
    }
  });

  it("rejects asset paths outside assets/", async () => {
    const dir = await makeTempDir();
    const result = await Effect.runPromise(
      Effect.result(
        assembleRuntimeMapPackage({
          ...baseInput(dir),
          assets: [{ path: "../escape.png", bytes: new Uint8Array([1]) }],
        }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
  });
});

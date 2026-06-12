import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ContentHash } from "@tileborne/core";

import { buildBundledManifest, hashManifestPayload } from "./build/manifest.js";
import type { BundledManifest } from "./types.js";

describe("build-manifest", () => {
  it("hashes manifest payload deterministically", () => {
    const payload = {
      schemaVersion: 1 as const,
      plugin: {
        id: "@tileborne-plugins/fixture",
        version: "1.0.0",
        files: [{ path: "plugin/runtime.js", hash: "sha256:abc" as ContentHash, size: 12 }],
      },
      assetPacks: [],
      maps: [],
      runtimeVersion: "0.0.0",
      protocolVersion: 1,
      workerFiles: [{ path: "worker.js", hash: "sha256:def" as ContentHash, size: 99 }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const left = hashManifestPayload(payload);
    const right = hashManifestPayload(payload);
    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("buildId changes when worker file hash changes", () => {
    const base = buildBundledManifest({
      plugin: { id: "p", version: "1", files: [] },
      assetPacks: [],
      maps: [],
      runtimeVersion: "0.0.0",
      workerFiles: [{ path: "worker.js", hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111" as ContentHash, size: 1 }],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const changed = buildBundledManifest({
      plugin: { id: "p", version: "1", files: [] },
      assetPacks: [],
      maps: [],
      runtimeVersion: "0.0.0",
      workerFiles: [{ path: "worker.js", hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222" as ContentHash, size: 1 }],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(base.buildId).not.toBe(changed.buildId);
  });

  it("filters SDK tileset manifests to only referenced tile renderables", async () => {
    const { buildReferencedTilesetManifest } = await import("../scripts/generate-bundled-modules.mjs");
    const manifest = {
      schemaVersion: 1,
      id: "pack:test",
      name: "Tiny",
      version: "1.0.0",
      license: { spdxId: "CC0-1.0" },
      assets: [{ id: "asset:atlas", path: "atlas.png", mime: "image/png" }],
      terrainClasses: [],
      tilesets: [
        {
          id: "tileset:main",
          name: "Main",
          atlasAssetId: "asset:atlas",
          cellSize: { width: 32, height: 32 },
          margin: 0,
          spacing: 0,
        },
      ],
      tiles: Array.from({ length: 8 }, (_, index) => ({
        id: `tile:${index + 1}`,
        tilesetId: "tileset:main",
        uv: { x: index * 32, y: 0, w: 32, h: 32 },
        tags: [],
      })),
      animations: [],
      collisionMasks: [
        { tileId: "tile:2", mask: { _tag: "bitmask", passable: 0, blocked: 15 } },
        { tileId: "tile:7", mask: { _tag: "bitmask", passable: 0, blocked: 15 } },
      ],
      autotileRules: [],
      variantFilters: [],
      terrainTransitions: [],
    };

    const subset = buildReferencedTilesetManifest(manifest, ["tile:2", "tile:4", "tile:6"]);

    expect(subset.tiles.map((tile: { id: string }) => tile.id)).toEqual(["tile:2", "tile:4", "tile:6"]);
    expect(subset.collisionMasks).toEqual([
      { tileId: "tile:2", mask: { _tag: "bitmask", passable: 0, blocked: 15 } },
    ]);
    expect(subset.assets).toEqual([{ id: "asset:atlas", path: "atlas.png", mime: "image/png" }]);
  });
});

describe("buildCloudflareGameHost fixture bundle", () => {
  it("produces manifest.json and worker.js for a fixture plugin", async () => {
    const { buildCloudflareGameHost } = await import("./build/cloudflare.js");
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tileborne-gh-build-"));
    const pluginRoot = path.join(tempRoot, "plugin-src");
    await mkdir(path.join(pluginRoot, "dist"), { recursive: true });
    await writeFile(path.join(pluginRoot, "dist/runtime.js"), "export default { id: 'fixture' };\n", "utf8");

    const mapId = "map:00000000-0000-4000-8000-000000000001";
    const packageId = "mappkg:00000000-0000-4000-8000-000000000002";
    const mapPackageWire = { manifest: { packageId, mapId } };
    const mapPackageDir = path.join(tempRoot, "map-package");
    await mkdir(mapPackageDir, { recursive: true });
    await writeFile(
      path.join(mapPackageDir, "package.json"),
      `${JSON.stringify(mapPackageWire, null, 2)}\n`,
      "utf8",
    );

    const outDir = path.join(tempRoot, "out");
    const result = await buildCloudflareGameHost({
      outDir,
      pluginId: "@tileborne-plugins/fixture",
      pluginVersion: "0.1.0",
      pluginRoot,
      assetPacks: [],
      mapPackages: [
        {
          mapId,
          packageId,
          sourceDir: mapPackageDir,
          mapPackage: mapPackageWire,
        },
      ],
      runtimeVersion: "0.0.0",
      siteName: "fixture-host",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result.files).toContain("worker.js");
    expect(result.files).toContain("manifest.json");
    expect(result.files).toContain("wrangler.toml");
    const mapFilePath = "maps/map-00000000-0000-4000-8000-000000000001/package.json";
    expect(result.files).toContain(mapFilePath);
    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8")) as BundledManifest;
    expect(manifest.buildId).toBe(result.manifestHash);
    expect(manifest.plugin.id).toBe("@tileborne-plugins/fixture");
    expect(manifest.maps).toHaveLength(1);
    expect(manifest.maps[0]).toMatchObject({ mapId, packageId });
    expect(manifest.maps[0]!.files.map((entry) => entry.path)).toContain(mapFilePath);
    for (const entry of manifest.maps[0]!.files) {
      expect(entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.size).toBeGreaterThan(0);
    }
    const copied = JSON.parse(await readFile(path.join(outDir, mapFilePath), "utf8")) as Record<string, unknown>;
    expect(copied).toEqual(mapPackageWire);
    // The worker bundle bakes in the bundled map package for packageless
    // /rooms/create resolution (M5 S1).
    const workerSource = await readFile(result.bundlePath, "utf8");
    expect(workerSource).toContain("export");
    expect(workerSource).toContain(packageId);
    // The generated wrangler.toml never ships a live signing key — only the
    // `wrangler secret put` instruction (the worker rejects the placeholder).
    const wranglerToml = await readFile(path.join(outDir, "wrangler.toml"), "utf8");
    expect(wranglerToml).not.toContain("replace-me-in-production");
    expect(wranglerToml).not.toMatch(/^HANDOFF_SIGNING_KEY\s*=/m);
    expect(wranglerToml).toContain("wrangler secret put HANDOFF_SIGNING_KEY");
    // Build-time staging never ships inside the artifact.
    await expect(stat(path.join(outDir, ".staging"))).rejects.toThrow();
    await rm(tempRoot, { recursive: true, force: true });
  });
});

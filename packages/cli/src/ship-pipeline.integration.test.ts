import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { MapService, ProjectService } from "@tileborne/services-app";
import { BuildService, GameBuildOptions, ServicesBuildLayer } from "@tileborne/services-build";
import { createLocalGameHost } from "@tileborne/services-build/local-game-host";
import { ConfigLayer, HomeServiceLive, JobServiceLive } from "@tileborne/services-foundation";
import {
  LocalPluginSource,
  PluginInstallerLayer,
  PluginInstallerService,
  PluginLoaderMainLayer,
  PluginRegistryLayer,
  materializePluginManifestInput,
} from "@tileborne/services-plugin";
import { Effect, Layer, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { scaffoldGameProject } from "./commands/game/init.js";
import { TEMPLATE_DIRECTORIES } from "./commands/game/init-templates.js";

/**
 * M5 S4: end-to-end ship-pipeline proof. One chain covering the full thin
 * product-repo flow the CLI ships:
 *
 *   game init (scaffold) → game build --target local (real buildGame path,
 *   bundled RuntimeMapPackage) → game serve boot (miniflare, test port) →
 *   packageless POST /rooms/create resolves the BUNDLED map package into a
 *   joinable room.
 *
 * Fixtures mirror `services-build.test.ts` (ship-mode plugin with generic
 * `exportModeData`/`resolvePlayerModels` node-entry exports); the build runs
 * through the same `BuildService.buildGame` the `tileborne game build`
 * command invokes.
 */

const SHIP_PLUGIN_ID = "@tileborne-plugins/ship-mode";
const TEST_PORT = 18095;

const withTempHome = async <A>(run: (home: string) => Promise<A>): Promise<A> => {
  const previous = process.env["TILEBORNE_HOME"];
  const home = await mkdtemp(path.join(tmpdir(), "tileborne-ship-e2e-home-"));
  process.env["TILEBORNE_HOME"] = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env["TILEBORNE_HOME"];
    } else {
      process.env["TILEBORNE_HOME"] = previous;
    }
    await rm(home, { recursive: true, force: true });
  }
};

const foundationLayer = Layer.mergeAll(HomeServiceLive, JobServiceLive, ConfigLayer);
const pluginLayer = Layer.mergeAll(PluginLoaderMainLayer, PluginInstallerLayer).pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(foundationLayer),
);
const testLayer = ServicesBuildLayer.pipe(
  Layer.provideMerge(pluginLayer),
  Layer.provideMerge(foundationLayer),
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Same mode-plugin fixture shape as services-build.test.ts installShipModePlugin. */
const installShipModePlugin = () =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "tileborne-ship-e2e-plugin-")));
    tempDirs.push(source);
    const manifest = materializePluginManifestInput({
      schemaVersion: 1,
      id: SHIP_PLUGIN_ID,
      name: SHIP_PLUGIN_ID,
      version: "0.0.1",
      displayName: "Ship Mode",
      description: "Ship pipeline e2e fixture plugin",
      author: "Tileborne",
      license: "MIT",
      engines: { tileborne: "^0.1.0" },
      entry: { server: "./server.mjs", runtime: "./dist/runtime.js" },
      permissions: [],
      dependsOn: [],
      contributes: {
        runtime: {
          systems: [
            {
              _tag: "ExecutableRuntimeSystemContribution",
              id: "ship-mode-runtime",
              kind: "executable",
              display: { label: "Ship Mode Runtime" },
              entry: "./dist/runtime.js",
            },
          ],
        },
      },
    });
    yield* Effect.promise(async () => {
      await mkdir(path.join(source, "dist"), { recursive: true });
      await writeFile(
        path.join(source, "tileborne-plugin.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await writeFile(
        path.join(source, "dist", "runtime.js"),
        "export const createRuntimeAdapter = () => ({});\n",
      );
      await writeFile(
        path.join(source, "server.mjs"),
        "export const exportModeData = () => ({ _tag: 'Success', success: { fixture: true } });\nexport const resolvePlayerModels = () => [];\n",
      );
    });
    const installer = yield* PluginInstallerService;
    yield* installer.install(new LocalPluginSource({ path: source }));
  });

interface BundledManifestWire {
  readonly buildId: string;
  readonly plugin: { readonly id: string; readonly files: readonly { readonly path: string }[] };
  readonly maps: readonly {
    readonly mapId: string;
    readonly packageId: string;
    readonly files: readonly { readonly path: string; readonly hash: string; readonly size: number }[];
  }[];
  readonly workerFiles: readonly { readonly path: string; readonly hash: string }[];
}

describe("ship pipeline end to end (scaffold → build → boot → room)", () => {
  it("scaffolds a product repo, builds the local artifact into it, and boots a joinable room from the bundled map package", () =>
    withTempHome(async () => {
      // 1. Scaffold the thin product repo via the `game init` machinery.
      const parent = await mkdtemp(path.join(tmpdir(), "tileborne-ship-e2e-repo-"));
      tempDirs.push(parent);
      const repoDir = path.join(parent, "shipped-game");
      const scaffold = await scaffoldGameProject({ directory: repoDir, pluginId: SHIP_PLUGIN_ID });
      expect(scaffold.pluginId).toBe(SHIP_PLUGIN_ID);
      for (const dir of TEMPLATE_DIRECTORIES) {
        expect((await stat(path.join(repoDir, dir))).isDirectory(), dir).toBe(true);
      }
      const pkg = JSON.parse(await readFile(path.join(repoDir, "package.json"), "utf8")) as {
        readonly scripts: Record<string, string>;
      };
      expect(pkg.scripts["build"]).toContain("scripts/build.mjs");
      const buildScript = await readFile(path.join(repoDir, "scripts", "build.mjs"), "utf8");
      expect(buildScript).toContain(`"${SHIP_PLUGIN_ID}"`);
      expect(buildScript).toContain('"--project"');

      // 2. Build via the REAL buildGame path into the scaffold's dist/game
      //    (the product-repo output convention), with a bundled map package.
      const outDir = path.join(repoDir, "dist", "game");
      const { mapId } = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const maps = yield* MapService;
          const projectId = yield* projects.create({ name: "Ship E2E" });
          const mapId = yield* maps.create(projectId, { width: 16, height: 16 });
          yield* installShipModePlugin();
          const builds = yield* BuildService;
          const artifact = yield* builds.buildGame(
            new GameBuildOptions({
              pluginId: SHIP_PLUGIN_ID,
              target: "local",
              outputDirectory: Option.some(outDir),
              assetPackIds: Option.none(),
              siteName: Option.none(),
              projectId: Option.some(projectId),
              mapIds: Option.none(),
            }),
          );
          expect(artifact.target).toBe("local");
          expect(artifact.files).toContain("worker.js");
          expect(artifact.files).toContain("plugin/runtime.js");
          expect(artifact.files).toContain("README.md");
          return { mapId };
        }).pipe(Effect.provide(testLayer)),
      );

      // 3. Assert artifact contents: worker, plugin runtime, map package
      //    files, and hashed manifest map entries.
      const mapDir = `maps/${mapId.replaceAll(":", "-")}`;
      for (const file of ["worker.js", "plugin/runtime.js", "wrangler.toml", `${mapDir}/map.json`, `${mapDir}/manifest.json`]) {
        expect((await stat(path.join(outDir, ...file.split("/")))).isFile(), file).toBe(true);
      }
      // Build-time staging (generated worker modules + map-package staging)
      // never ships inside the deployable artifact.
      await expect(stat(path.join(outDir, ".staging"))).rejects.toThrow();
      const manifest = JSON.parse(
        await readFile(path.join(outDir, "manifest.json"), "utf8"),
      ) as BundledManifestWire;
      expect(manifest.plugin.id).toBe(SHIP_PLUGIN_ID);
      expect(manifest.maps).toHaveLength(1);
      expect(manifest.maps[0]?.mapId).toBe(mapId);
      expect(manifest.maps[0]?.packageId).toMatch(/^mappkg:/);
      expect(manifest.maps[0]?.files.length).toBeGreaterThan(0);
      for (const entry of manifest.maps[0]?.files ?? []) {
        expect(entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(entry.size).toBeGreaterThan(0);
      }
      expect(manifest.workerFiles.map((entry) => entry.path)).toContain("worker.js");

      // 4. Boot the artifact locally (game serve contract) and create a room
      //    WITHOUT a body mapPackage — the worker resolves the bundled one.
      const host = await createLocalGameHost({
        port: TEST_PORT,
        workerPath: path.join(outDir, "worker.js"),
      });
      try {
        const health = await host.fetch(`${host.baseUrl}/health`);
        expect(health.status).toBe(200);
        const created = await host.fetch(`${host.baseUrl}/rooms/create`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mapId }),
        });
        expect(created.status).toBe(201);
        const room = (await created.json()) as { readonly roomId: string; readonly wsUrl: string };
        expect(room.roomId.length).toBeGreaterThan(0);
        expect(room.wsUrl).toContain(`/rooms/${room.roomId}/connect`);
      } finally {
        await host.stop();
      }
      // The test port is released after stop().
      await expect(fetch(`http://127.0.0.1:${TEST_PORT}/health`)).rejects.toThrow();
    }), 240_000);
});

import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProjectManifest } from "@tileborne/core";
import { PluginManifest } from "@tileborne/plugin-api";
import { MapService, ProjectService } from "@tileborne/services-app";
import { ConfigLayer, HomeServiceLive, JobService, JobServiceLive } from "@tileborne/services-foundation";
import { withTempHome } from "../../services-foundation/src/test-utils.js";
import {
  LocalPluginSource,
  PluginInstallerLayer,
  PluginInstallerService,
  PluginLoaderMainLayer,
  PluginLoaderService,
  PluginRegistryLayer,
  PluginRegistryService,
} from "@tileborne/services-plugin";
import { materializePluginManifestInput } from "../../services-plugin/src/filesystem.js";
import { describe, expect, it } from "vitest";
import { Effect, Fiber, Layer, Option, Schema, Stream } from "effect";

import {
  BuildOptions,
  BuildService,
  BATTLE_ROYALE_PLUGIN_ID,
  CloudflareWorkerExportTarget,
  ExportOptions,
  ExportService,
  NodeExportTarget,
  PlaytestOptions,
  PlaytestService,
  RuntimeDeployCredentials,
  RuntimeDeployOptions,
  RuntimeDeployService,
  RuntimeDeployTarget,
  SupportBundleOptions,
  SupportService,
  WebExportTarget,
  ServicesBuildLayer,
} from "./index.js";
import { metadataFileName } from "./internal/persistence.js";
import { makeNewBuildId } from "./model.js";

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const foundationLayer = Layer.mergeAll(HomeServiceLive, JobServiceLive, ConfigLayer);
const pluginLayer = Layer.mergeAll(PluginLoaderMainLayer, PluginInstallerLayer).pipe(
  Layer.provideMerge(PluginRegistryLayer),
  Layer.provideMerge(foundationLayer),
);
const testLayer = ServicesBuildLayer.pipe(Layer.provideMerge(pluginLayer), Layer.provideMerge(foundationLayer));
const EXAMPLE_ARENA_PLUGIN_ID = "@tileborne-plugins/example-arena";

const waitForJob = (jobId: string) =>
  Effect.gen(function* () {
    const jobs = yield* JobService;
    for (let attempt = 0; attempt < 50; attempt++) {
      const job = (yield* jobs.list()).find((entry) => entry.id === jobId);
      if (
        job &&
        (job.status._tag === "Completed" || job.status._tag === "Failed" || job.status._tag === "Cancelled")
      ) {
        return job;
      }
      yield* Effect.sleep(10);
    }
    throw new Error(`job did not finish: ${jobId}`);
  });

const seedProject = (name = "Arena") =>
  Effect.gen(function* () {
    const projects = yield* ProjectService;
    const maps = yield* MapService;
    const projectId = yield* projects.create({ name });
    const mapId = yield* maps.create(projectId, { width: 16, height: 16 });
    return { projectId, mapId };
  });

const installExportPlugin = (entryBody: string) =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "tileborne-export-plugin-")));
    const manifestInput = materializePluginManifestInput({
      schemaVersion: 1,
      id: "@tileborne-plugins/export",
      name: "@tileborne-plugins/export",
      version: "0.1.0",
      displayName: "Export Plugin",
      description: "Export hook fixture",
      author: "Tileborne",
      license: "MIT",
      engines: { tileborne: "^0.1.0" },
      contributes: {
        editor: {
          exporters: [
            {
              _tag: "ExecutableEditorExporterContribution",
              id: "web-export",
              kind: "executable",
              display: {
                label: "Web Export",
                description: "Fixture export hook",
                icon: "lucide:download",
                order: 1,
              },
              entry: "export.mjs",
            },
          ],
        },
      },
      permissions: [],
      dependsOn: [],
    });
    yield* Effect.promise(async () => {
      await mkdir(source, { recursive: true });
      await writeFile(path.join(source, "tileborne-plugin.json"), `${JSON.stringify(manifestInput, null, 2)}\n`);
      await writeFile(path.join(source, "export.mjs"), entryBody);
      await writeFile(path.join(source, "README.md"), "export fixture\n");
    });
    const installer = yield* PluginInstallerService;
    yield* installer.install(new LocalPluginSource({ path: source }));
    Schema.decodeUnknownSync(PluginManifest)(manifestInput);
    return source;
  });

const installRuntimePlugin = (input: {
  readonly pluginId: string;
  readonly runtimeSystemId: string;
  readonly runtimeLabel: string;
}) =>
  Effect.gen(function* () {
    const source = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "tileborne-runtime-plugin-")));
    const manifest = Schema.decodeUnknownSync(PluginManifest)(
      materializePluginManifestInput({
        schemaVersion: 1,
        id: input.pluginId,
        name: input.pluginId,
        version: "0.0.1",
        displayName: input.runtimeLabel,
        description: "Runtime fixture plugin",
        author: "Tileborne",
        license: "MIT",
        engines: { tileborne: "^0.1.0" },
        entry: { editor: "./node.js", runtime: "./runtime.js" },
        permissions: [],
        dependsOn: [],
        contributes: {
          runtime: {
            systems: [
              {
                _tag: "ExecutableRuntimeSystemContribution",
                id: input.runtimeSystemId,
                kind: "executable",
                display: { label: input.runtimeLabel },
                entry: "./runtime.js",
              },
            ],
          },
        },
      }),
    );
    yield* Effect.promise(async () => {
      await mkdir(source, { recursive: true });
      await writeFile(
        path.join(source, "tileborne-plugin.json"),
        `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
      );
      await writeFile(path.join(source, "node.js"), "export {};\n");
      await writeFile(path.join(source, "runtime.js"), "export {};\n");
    });
    const installer = yield* PluginInstallerService;
    yield* installer.install(new LocalPluginSource({ path: source }));
    return source;
  });

const runBuild = (projectId: import("@tileborne/core").ProjectId, options?: BuildOptions) =>
  Effect.gen(function* () {
    const builds = yield* BuildService;
    const jobId = yield* builds.build(projectId, options);
    const job = yield* waitForJob(jobId);
    expect(job.status._tag).toBe("Completed");
    const [summary] = yield* builds.listBuilds(projectId);
    if (!summary) {
      throw new Error("missing build summary");
    }
    return yield* builds.getBuild(summary.id);
  });

describe("BuildService", () => {
  it("builds a project into the builds cache from services-app snapshots", () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          return yield* runBuild(projectId, new BuildOptions({ target: Option.some("cloudflare"), delayMs: Option.none() }));
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact.project.name).toBe("Arena");
      expect(artifact.target).toBe("cloudflare");
    }));

  it("lists builds verified on read", () =>
    withTempHome(async () => {
      const summaries = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          yield* runBuild(projectId);
          const builds = yield* BuildService;
          return yield* builds.listBuilds(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.integrityHash.startsWith("sha256:")).toBe(true);
    }));

  it("reads a build by id", () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          return yield* runBuild(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact.maps).toHaveLength(1);
    }));

  it("reads project data from ProjectService instead of inline options", () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("From Services");
          return yield* runBuild(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact.project.name).toBe("From Services");
    }));

  it("detects manifest tampering on get", () =>
    withTempHome(async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const { projectId } = yield* seedProject("Arena");
            const artifact = yield* runBuild(projectId);
            const raw = JSON.parse(yield* Effect.promise(() => readFile(artifact.manifestPath, "utf8"))) as {
              project: { name: string };
            };
            raw.project.name = "Tampered";
            yield* Effect.promise(() => writeFile(artifact.manifestPath, JSON.stringify(raw), "utf8"));
            const builds = yield* BuildService;
            return yield* builds.getBuild(artifact.id);
          }).pipe(Effect.provide(testLayer)),
        ),
      ).rejects.toMatchObject({ _tag: "IntegrityMismatchError" });
    }));

  it("publishes a trigger-only build event", () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const builds = yield* BuildService;
          const fiber = yield* builds.subscribe.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
          yield* runBuild(projectId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it("cancels a delayed build and proves the job reaches Cancelled", () =>
    withTempHome(async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const builds = yield* BuildService;
          const jobs = yield* JobService;
          const jobId = yield* builds.build(
            projectId,
            new BuildOptions({ target: Option.none(), delayMs: Option.some(60_000) }),
          );
          yield* Effect.sleep(20);
          const cancelled = yield* jobs.cancel(jobId);
          yield* waitForJob(jobId);
          return { cancelled: cancelled.status._tag };
        }).pipe(Effect.provide(testLayer)),
      );
      expect(result.cancelled).toBe("Cancelled");
    }));

  it("rejects symlink escape when BuildService reads a planted build entry", () =>
    withTempHome(async (home) => {
      // Plant a symlinked build directory under the canonical builds root whose target
      // escapes the home cache. Then call BuildService.getBuild through the real service
      // layer and assert the verifiedChildPath rejection surfaces as a ServicesBuildError.
      const buildsRoot = path.join(home, "cache", "builds");
      await mkdir(buildsRoot, { recursive: true });
      const outsideDir = path.join(home, "outside-build");
      await mkdir(outsideDir, { recursive: true });
      await writeFile(path.join(outsideDir, metadataFileName), JSON.stringify({ leak: true }));
      const plantedId = makeNewBuildId();
      await symlink(outsideDir, path.join(buildsRoot, plantedId));
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const builds = yield* BuildService;
          return yield* builds.getBuild(plantedId).pipe(
            Effect.map(() => new Error("expected symlink rejection")),
            Effect.catch((cause) => Effect.succeed(cause)),
          );
        }).pipe(Effect.provide(testLayer)),
      );
      expect(error).toMatchObject({ _tag: "ServicesBuildError" });
    }));

  it("deletes a build directory", () =>
    withTempHome(async () => {
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const artifact = yield* runBuild(projectId);
          const builds = yield* BuildService;
          yield* builds.deleteBuild(artifact.id);
          return yield* builds.listBuilds(projectId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(remaining).toHaveLength(0);
    }));
});

describe("ExportService", () => {
  it("exports a Cloudflare Worker target", () =>
    withTempHome(async () => {
      const artifact = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new CloudflareWorkerExportTarget({ environment: Option.some("dev") }),
          );
          yield* waitForJob(jobId);
          return (yield* exports.listExports(build.id))[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(artifact?.target._tag).toBe("CloudflareWorkerExportTarget");
    }));

  it("exports a Node target", () =>
    withTempHome(async () => {
      const targetTag = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new NodeExportTarget({ entrypoint: Option.some("server.js") }),
          );
          yield* waitForJob(jobId);
          return (yield* exports.listExports(build.id))[0]?.target._tag;
        }).pipe(Effect.provide(testLayer)),
      );
      expect(targetTag).toBe("NodeExportTarget");
    }));

  it("exports a Web target", () =>
    withTempHome(async () => {
      const targetTag = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.some("/play") }),
          );
          yield* waitForJob(jobId);
          return (yield* exports.listExports(build.id))[0]?.target._tag;
        }).pipe(Effect.provide(testLayer)),
      );
      expect(targetTag).toBe("WebExportTarget");
    }));

  it("reads an export by id", () =>
    withTempHome(async () => {
      const read = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(build.id, new WebExportTarget({ basePath: Option.none() }));
          yield* waitForJob(jobId);
          const [artifact] = yield* exports.listExports(build.id);
          if (!artifact) throw new Error("missing export");
          return yield* exports.getExport(artifact.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(read.id.startsWith("export:")).toBe(true);
    }));

  it("invokes export hooks through PluginLoaderService", () =>
    withTempHome(async () => {
      const invoked = await Effect.runPromise(
        Effect.gen(function* () {
          yield* installExportPlugin(`export default async () => "ok";`);
          const registry = yield* PluginRegistryService;
          yield* registry.discover();
          const projects = yield* ProjectService;
          const projectId = yield* projects.create({
            name: "Export Plugin Project",
            plugins: [{ id: "@tileborne-plugins/export", version: "0.1.0" }],
          });
          const maps = yield* MapService;
          yield* maps.create(projectId, { width: 8, height: 8 });
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const loader = yield* PluginLoaderService;
          const jobId = yield* exports.exportBuild(
            build.id,
            new WebExportTarget({ basePath: Option.none() }),
            new ExportOptions({ delayMs: Option.none() }),
          );
          yield* waitForJob(jobId);
          const loaded = yield* loader.listDeclarative();
          return {
            hooks: (yield* exports.listExports(build.id))[0]?.invokedHooks,
            loaderConsulted: loaded.some((plugin) => plugin.pluginId === "@tileborne-plugins/export"),
          };
        }).pipe(Effect.provide(testLayer)),
      );
      expect(invoked.hooks).toEqual(["export.mjs"]);
      expect(invoked.loaderConsulted).toBe(true);
    }));

  it("publishes export events", () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const fiber = yield* exports.subscribe.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
          const jobId = yield* exports.exportBuild(build.id, new WebExportTarget({ basePath: Option.none() }));
          yield* waitForJob(jobId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it("deletes an export", () =>
    withTempHome(async () => {
      const count = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const jobId = yield* exports.exportBuild(build.id, new WebExportTarget({ basePath: Option.none() }));
          yield* waitForJob(jobId);
          const [artifact] = yield* exports.listExports(build.id);
          if (!artifact) throw new Error("missing export");
          yield* exports.deleteExport(artifact.id);
          return (yield* exports.listExports(build.id)).length;
        }).pipe(Effect.provide(testLayer)),
      );
      expect(count).toBe(0);
    }));
});

describe("PlaytestService", () => {
  it("starts a session and reaches running", () =>
    withTempHome(async () => {
      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          const playtest = yield* PlaytestService;
          return yield* playtest.start(projectId, mapId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(session.status._tag).toBe("Running");
      expect(Option.isSome(session.artifactDirectory)).toBe(true);
    }));

  it("assembles artifact with the enabled battle royale plugin on start", () =>
    withTempHome(async (home) => {
      const pluginRoot = path.join(home, "plugin-fixture");
      await mkdir(pluginRoot, { recursive: true });
      const manifest = Schema.decodeUnknownSync(PluginManifest)(
        materializePluginManifestInput({
          schemaVersion: 1,
          id: BATTLE_ROYALE_PLUGIN_ID,
          name: BATTLE_ROYALE_PLUGIN_ID,
          version: "0.0.1",
          displayName: "CLI Playtest",
          description: "Fixture plugin",
          author: "Tileborne",
          license: "MIT",
          engines: { tileborne: "^0.1.0" },
          entry: { editor: "./node.js", runtime: "./runtime.js" },
          permissions: [],
          dependsOn: [],
          contributes: {
            runtime: {
              systems: [
                {
                  _tag: "ExecutableRuntimeSystemContribution",
                  id: "battle-royale-runtime",
                  kind: "executable",
                  display: { label: "Battle Royale Runtime Adapter" },
                  entry: "./runtime.js",
                },
              ],
            },
          },
        }),
      );
      await writeFile(
        path.join(pluginRoot, "tileborne-plugin.json"),
        `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
      );
      await writeFile(path.join(pluginRoot, "node.js"), "export {};\n");
      await writeFile(path.join(pluginRoot, "runtime.js"), "export {};\n");

      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          const installer = yield* PluginInstallerService;
          yield* installer.install(new LocalPluginSource({ path: pluginRoot }));
          const playtest = yield* PlaytestService;
          return yield* playtest.start(projectId, mapId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(session.activePlugins).toContain(BATTLE_ROYALE_PLUGIN_ID);
      const artifactDirectory = Option.getOrThrow(session.artifactDirectory);
      // The artifact scaffold never writes map.json: assembleRuntimeMapPackage
      // is the single writer of the package directory's map entry.
      expect(await fileExists(path.join(artifactDirectory, "map.json"))).toBe(false);
      expect(await fileExists(path.join(artifactDirectory, "index.html"))).toBe(true);
    }));

  it("assembles artifact with the selected active game mode plugin on start", () =>
    withTempHome(async () => {
      const session = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          yield* installRuntimePlugin({
            pluginId: BATTLE_ROYALE_PLUGIN_ID,
            runtimeSystemId: "battle-royale-runtime",
            runtimeLabel: "Battle Royale Runtime Adapter",
          });
          yield* installRuntimePlugin({
            pluginId: EXAMPLE_ARENA_PLUGIN_ID,
            runtimeSystemId: "arena-runtime",
            runtimeLabel: "Example Arena Runtime Adapter",
          });
          const projects = yield* ProjectService;
          const project = yield* projects.open(projectId);
          yield* projects.save(
            new ProjectManifest({
              ...project,
              settings: {
                ...(project.settings ?? {}),
                activeGameMode: EXAMPLE_ARENA_PLUGIN_ID,
              },
            }),
          );
          const playtest = yield* PlaytestService;
          return yield* playtest.start(projectId, mapId);
        }).pipe(Effect.provide(testLayer)),
      );

      expect(session.activePlugins).toEqual([EXAMPLE_ARENA_PLUGIN_ID]);
    }));

  it("fails fast when multiple enabled game modes have no active selection", () =>
    withTempHome(async () => {
      const sessions = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          yield* installRuntimePlugin({
            pluginId: BATTLE_ROYALE_PLUGIN_ID,
            runtimeSystemId: "battle-royale-runtime",
            runtimeLabel: "Battle Royale Runtime Adapter",
          });
          yield* installRuntimePlugin({
            pluginId: EXAMPLE_ARENA_PLUGIN_ID,
            runtimeSystemId: "arena-runtime",
            runtimeLabel: "Example Arena Runtime Adapter",
          });
          const playtest = yield* PlaytestService;
          let failed = false;
          yield* playtest.start(projectId, mapId).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                failed = true;
                expect(error).toMatchObject({
                  _tag: "ServicesBuildError",
                  message: expect.stringContaining("Multiple enabled game modes are available"),
                });
              }),
            ),
          );
          expect(failed).toBe(true);
          return yield* playtest.list();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(sessions).toHaveLength(0);
    }));

  it("fails fast when the selected active game mode is unavailable", () =>
    withTempHome(async () => {
      const sessions = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          yield* installRuntimePlugin({
            pluginId: BATTLE_ROYALE_PLUGIN_ID,
            runtimeSystemId: "battle-royale-runtime",
            runtimeLabel: "Battle Royale Runtime Adapter",
          });
          const projects = yield* ProjectService;
          const project = yield* projects.open(projectId);
          yield* projects.save(
            new ProjectManifest({
              ...project,
              settings: {
                ...(project.settings ?? {}),
                activeGameMode: EXAMPLE_ARENA_PLUGIN_ID,
              },
            }),
          );
          const playtest = yield* PlaytestService;
          let failed = false;
          yield* playtest.start(projectId, mapId).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                failed = true;
                expect(error).toMatchObject({
                  _tag: "ServicesBuildError",
                  message: expect.stringContaining("Selected active game mode"),
                });
              }),
            ),
          );
          expect(failed).toBe(true);
          return yield* playtest.list();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(sessions).toHaveLength(0);
    }));

  it("stops a running session", () =>
    withTempHome(async () => {
      const stopped = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          const playtest = yield* PlaytestService;
          const session = yield* playtest.start(projectId, mapId);
          return yield* playtest.stop(session.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(stopped.status._tag).toBe("Stopped");
    }));

  it("lists sessions", () =>
    withTempHome(async () => {
      const sessions = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          const playtest = yield* PlaytestService;
          yield* playtest.start(projectId, mapId);
          return yield* playtest.list();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(sessions).toHaveLength(1);
    }));

  it("publishes start and running triggers", () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId, mapId } = yield* seedProject("Arena");
          const playtest = yield* PlaytestService;
          const fiber = yield* playtest.subscribe.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
          yield* playtest.start(
            projectId,
            mapId,
            new PlaytestOptions({ slot: Option.none(), runtimeUrl: Option.none(), delayMs: Option.none() }),
          );
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it("fails to stop an unknown session", () =>
    withTempHome(async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const playtest = yield* PlaytestService;
            return yield* playtest.stop("playtest:00000000-0000-4000-8000-000000000000" as never);
          }).pipe(Effect.provide(testLayer)),
        ),
      ).rejects.toMatchObject({ _tag: "PlaytestSessionNotFoundError" });
    }));
});

describe("RuntimeDeployService", () => {
  it("deploys a build with credentials", () =>
    withTempHome(async () => {
      const deployment = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              stage: "dev",
              workerName: "tileborne-test",
              credentials: Option.some(new RuntimeDeployCredentials({ accountId: "acct", apiToken: "token" })),
            }),
          );
          yield* waitForJob(jobId);
          return (yield* deploy.listDeployments(build.id))[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(deployment?.endpoint).toContain("tileborne-test");
    }));

  it("records missing auth as a typed job error", () =>
    withTempHome(async () => {
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({ stage: "dev", workerName: "tileborne-test", credentials: Option.none() }),
          );
          return yield* waitForJob(jobId);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(status.status._tag).toBe("Failed");
    }));

  it("reads a deployment by id", () =>
    withTempHome(async () => {
      const read = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              stage: "staging",
              workerName: "tileborne-test",
              credentials: Option.some(new RuntimeDeployCredentials({ accountId: "acct", apiToken: "token" })),
            }),
          );
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error("missing deployment");
          return yield* deploy.getDeployment(deployment.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(read.target.stage).toBe("staging");
    }));

  it("publishes deploy events", () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const fiber = yield* deploy.subscribe.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              stage: "dev",
              workerName: "tileborne-test",
              credentials: Option.some(new RuntimeDeployCredentials({ accountId: "acct", apiToken: "token" })),
            }),
          );
          yield* waitForJob(jobId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it("deletes a deployment", () =>
    withTempHome(async () => {
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const deploy = yield* RuntimeDeployService;
          const jobId = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              stage: "dev",
              workerName: "tileborne-test",
              credentials: Option.some(new RuntimeDeployCredentials({ accountId: "acct", apiToken: "token" })),
            }),
          );
          yield* waitForJob(jobId);
          const [deployment] = yield* deploy.listDeployments(build.id);
          if (!deployment) throw new Error("missing deployment");
          yield* deploy.deleteDeployment(deployment.id);
          return yield* deploy.listDeployments(build.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(remaining).toHaveLength(0);
    }));
});

describe("SupportService", () => {
  it("creates a support bundle", () =>
    withTempHome(async () => {
      const bundle = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          return (yield* support.listBundles())[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(bundle?.redactedFiles).toContain("config.redacted.json");
    }));

  it("respects bundle options", () =>
    withTempHome(async () => {
      const bundle = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle(
            new SupportBundleOptions({
              includeLogs: Option.some(false),
              includeConfig: Option.some(true),
              delayMs: Option.none(),
            }),
          );
          yield* waitForJob(jobId);
          return (yield* support.listBundles())[0];
        }).pipe(Effect.provide(testLayer)),
      );
      expect(bundle?.redactedFiles).toEqual(["config.redacted.json"]);
    }));

  it("reads a support bundle by id", () =>
    withTempHome(async () => {
      const read = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          const [bundle] = yield* support.listBundles();
          if (!bundle) throw new Error("missing support bundle");
          return yield* support.getBundle(bundle.id);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(read.id.startsWith("support:")).toBe(true);
    }));

  it("publishes support events", () =>
    withTempHome(async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const fiber = yield* support.subscribe.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(testLayer)),
      );
      expect(Array.from(events)).toEqual([undefined]);
    }));

  it("deletes a support bundle", () =>
    withTempHome(async () => {
      const remaining = await Effect.runPromise(
        Effect.gen(function* () {
          const support = yield* SupportService;
          const jobId = yield* support.createBundle();
          yield* waitForJob(jobId);
          const [bundle] = yield* support.listBundles();
          if (!bundle) throw new Error("missing support bundle");
          yield* support.deleteBundle(bundle.id);
          return yield* support.listBundles();
        }).pipe(Effect.provide(testLayer)),
      );
      expect(remaining).toHaveLength(0);
    }));
});

describe("cross-service workflow", () => {
  it("runs project build export deploy support chain", () =>
    withTempHome(async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const { projectId } = yield* seedProject("Arena");
          const build = yield* runBuild(projectId);
          const exports = yield* ExportService;
          const exportJob = yield* exports.exportBuild(build.id, new WebExportTarget({ basePath: Option.none() }));
          yield* waitForJob(exportJob);
          const deploy = yield* RuntimeDeployService;
          const deployJob = yield* deploy.deploy(
            build.id,
            new RuntimeDeployTarget({
              stage: "dev",
              workerName: "tileborne-test",
              credentials: Option.some(new RuntimeDeployCredentials({ accountId: "acct", apiToken: "token" })),
            }),
            new RuntimeDeployOptions({ delayMs: Option.none() }),
          );
          yield* waitForJob(deployJob);
          const support = yield* SupportService;
          const supportJob = yield* support.createBundle();
          yield* waitForJob(supportJob);
          return {
            exports: (yield* exports.listExports(build.id)).length,
            deployments: (yield* deploy.listDeployments(build.id)).length,
            support: (yield* support.listBundles()).length,
          };
        }).pipe(Effect.provide(testLayer)),
      );
      expect(result).toEqual({ exports: 1, deployments: 1, support: 1 });
    }));
});

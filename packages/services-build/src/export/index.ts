import { pathToFileURL } from "node:url";
import path from "node:path";

import { rejectPathTraversal, rejectSymlinkEscape } from "@tileborne/asset-pipeline";
import { BuildId, PluginId } from "@tileborne/core";
import type { EditorExporterContribution } from "@tileborne/plugin-api";
import { JobId, JobService, HomeService } from "@tileborne/services-foundation";
import {
  PluginLoaderService,
  PluginRegistryService,
  type InstalledPlugin,
} from "@tileborne/services-plugin";
import { Context, Effect, Layer, Option, PubSub, Stream } from "effect";

import { BuildService } from "../build/index.js";
import {
  ExportArtifact,
  ExportId,
  IntegrityMismatchError,
  ExportNotFoundError,
  ExportOptions,
  ExportTarget,
  EditorExporterContext,
  emptyContentHash,
  emptyExportOptions,
  ServicesBuildError,
  makeExportId,
} from "../model.js";
import {
  deleteDirectory,
  ensureDirectory,
  errorMessage,
  listVerifiedJson,
  metadataFileName,
  readVerifiedJson,
  serviceError,
  verifiedChildPath,
  writeTextFile,
  writeVerifiedJson,
} from "../internal/persistence.js";

const isExecutableExporter = (
  contribution: EditorExporterContribution,
): contribution is Extract<EditorExporterContribution, { readonly kind: "executable" }> =>
  contribution.kind === "executable";

const editorExporters = (
  contributions: InstalledPlugin["manifest"]["contributes"],
): readonly EditorExporterContribution[] => {
  const editor = contributions.editor;
  if (Option.isNone(editor)) {
    return [];
  }
  const exporters = editor.value.exporters;
  if (Option.isNone(exporters)) {
    return [];
  }
  return exporters.value;
};

const resolvePluginEntry = (
  pluginRoot: string,
  entry: string,
): Effect.Effect<string, ServicesBuildError> =>
  Effect.tryPromise({
    try: async () => {
      rejectPathTraversal(pluginRoot, entry);
      return await rejectSymlinkEscape(pluginRoot, entry);
    },
    catch: (cause) => serviceError(errorMessage(cause), entry),
  });

const loadExportHook = (
  pluginRoot: string,
  entry: string,
): Effect.Effect<(context: EditorExporterContext) => Promise<unknown> | unknown, ServicesBuildError> =>
  Effect.gen(function* () {
    const entryPath = yield* resolvePluginEntry(pluginRoot, entry);
    const module = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(entryPath).href) as Promise<Record<string, unknown>>,
      catch: (cause) => serviceError(errorMessage(cause), entryPath),
    });
    const hook = module["default"] ?? module[path.basename(entry, path.extname(entry))];
    if (typeof hook !== "function") {
      return yield* Effect.fail(serviceError(`export hook is not callable: ${entry}`, entryPath));
    }
    return hook as (context: EditorExporterContext) => Promise<unknown> | unknown;
  });

export class ExportService extends Context.Service<ExportService, {
  readonly exportBuild: (
    buildId: BuildId,
    target: ExportTarget,
    options?: ExportOptions,
  ) => Effect.Effect<JobId>;
  readonly getExport: (
    exportId: ExportId,
  ) => Effect.Effect<ExportArtifact, ServicesBuildError | ExportNotFoundError | IntegrityMismatchError>;
  readonly listExports: (
    buildId: BuildId,
  ) => Effect.Effect<readonly ExportArtifact[], ServicesBuildError | IntegrityMismatchError>;
  readonly deleteExport: (exportId: ExportId) => Effect.Effect<void, ServicesBuildError>;
  readonly subscribe: Stream.Stream<void>;
}>()("@tileborne/services-build/ExportService") {}

const exportRoot = (cachePath: string): string => path.join(cachePath, "exports");

export const ExportServiceLive = Layer.effect(
  ExportService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const jobs = yield* JobService;
    const builds = yield* BuildService;
    const registry = yield* PluginRegistryService;
    const loader = yield* PluginLoaderService;
    const events = yield* PubSub.unbounded<void>();
    const root = exportRoot(home.paths.cache);
    yield* ensureDirectory(root);

    const getExport = Effect.fn("ExportService.getExport")(function* (exportId: ExportId) {
      const filePath = yield* verifiedChildPath(root, exportId, metadataFileName);
      return yield* readVerifiedJson(filePath, ExportArtifact).pipe(
        Effect.mapError((error) =>
          error._tag === "ServicesBuildError"
            ? new ExportNotFoundError({ exportId, message: `export not found: ${exportId}` })
            : error,
        ),
      );
    });

    const runPluginExportHooks = Effect.fn("ExportService.runPluginExportHooks")(function* (
      context: EditorExporterContext,
    ) {
      const build = context.build;
      const enabledIds = new Set(
        (yield* registry.list())
          .filter((plugin) => plugin.enabled)
          .map((plugin) => plugin.id),
      );
      const projectPluginIds = build.project.plugins
        .map((ref) => ref.id as PluginId)
        .filter((id) => enabledIds.has(id));
      const invoked: string[] = [];
      for (const pluginId of projectPluginIds) {
        const loaded = yield* loader.loadDeclarative(pluginId).pipe(
          Effect.mapError((error) => new ServicesBuildError({ path: Option.none(), message: error.message })),
        );
        const exporters = editorExporters(loaded.manifest.contributes).filter(isExecutableExporter);
        const installed = (yield* registry.list()).find((plugin) => plugin.id === pluginId);
        if (!installed) {
          continue;
        }
        for (const exporter of exporters) {
          const hook = yield* loadExportHook(installed.rootPath, exporter.entry);
          yield* Effect.tryPromise({
            try: async () => hook(context),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          }).pipe(
            Effect.mapError((error) => new ServicesBuildError({ path: Option.none(), message: error.message })),
          );
          invoked.push(exporter.entry);
        }
      }
      return invoked;
    });

    const writeExport = Effect.fn("ExportService.writeExport")(function* (
      buildId: BuildId,
      target: ExportTarget,
      options: ExportOptions,
    ) {
      const exportId = makeExportId();
      const directory = yield* verifiedChildPath(root, exportId);
      yield* ensureDirectory(directory);
      const delayMs = Option.getOrElse(options.delayMs, () => 0);
      if (delayMs > 0) {
        yield* Effect.sleep(delayMs);
      }
      const build = yield* builds.getBuild(buildId);
      const exportContext: EditorExporterContext = {
        build,
        exportId,
        target,
        outputDirectory: directory,
      };
      const invokedHooks = yield* runPluginExportHooks(exportContext);
      yield* writeTextFile(
        yield* verifiedChildPath(directory, "target.txt"),
        `Tileborne export ${exportId}\nTarget: ${target._tag}\n`,
      );
      const manifestPath = yield* verifiedChildPath(directory, metadataFileName);
      const artifact = new ExportArtifact({
        id: exportId,
        buildId,
        target,
        createdAt: new Date().toISOString(),
        directory,
        manifestPath,
        invokedHooks,
        integrityHash: emptyContentHash,
      });
      const integrityHash = yield* writeVerifiedJson(manifestPath, ExportArtifact, artifact);
      yield* PubSub.publish(events, void 0);
      return new ExportArtifact({ ...artifact, integrityHash });
    });

    const exportBuild = Effect.fn("ExportService.exportBuild")(function* (
      buildId: BuildId,
      target: ExportTarget,
      options: ExportOptions = emptyExportOptions,
    ) {
      return yield* jobs.create({
        name: `export ${buildId}`,
        run: writeExport(buildId, target, options),
      });
    });

    const listExports = Effect.fn("ExportService.listExports")(function* (buildId: BuildId) {
      const exports = yield* listVerifiedJson(root, ExportArtifact);
      return exports.filter((artifact) => artifact.buildId === buildId);
    });

    const deleteExport = Effect.fn("ExportService.deleteExport")(function* (exportId: ExportId) {
      yield* deleteDirectory(yield* verifiedChildPath(root, exportId));
      yield* PubSub.publish(events, void 0);
    });

    return {
      exportBuild,
      getExport,
      listExports,
      deleteExport,
      subscribe: Stream.fromPubSub(events),
    };
  }),
);

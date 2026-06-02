import path from "node:path";
import { pathToFileURL } from "node:url";

import { PluginId } from "@tileborne/core";
import { PluginManifest, validatePluginContributions } from "@tileborne/plugin-api";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

import { resolvePluginGameObjectCatalogs } from "../catalog.js";
import {
  hashPluginDirectory,
  readInstalledLock,
  readManifestJson,
  resolvePluginManifestPath,
  validatePluginDirectory,
  validatePluginManifestPaths,
} from "../filesystem.js";
import {
  InstalledPlugin,
  LoadedDeclarativePlugin,
  MaterializedGameObjectCatalog,
  type LoadedExecutablePlugin,
  PLUGIN_MANIFEST_FILE,
  PluginExecutionContext,
  PluginExecutionForbiddenError,
  PluginIntegrityError,
  PluginInstallError,
  PluginNotFoundError,
  PluginValidationError,
  type PluginLoaderError,
} from "../model.js";
import { PluginRegistryService } from "../registry/index.js";
import type { PluginRegistryServiceError } from "../registry/index.js";

export class PluginExecutionContextService extends Context.Service<PluginExecutionContextService, {
  readonly context: PluginExecutionContext;
}>()("@tileborne/services-plugin/PluginExecutionContextService") {
  static readonly main = Layer.succeed(PluginExecutionContextService, {
    context: new PluginExecutionContext({ processKind: "main", allowedInRenderer: false }),
  });

  static readonly cli = Layer.succeed(PluginExecutionContextService, {
    context: new PluginExecutionContext({ processKind: "cli", allowedInRenderer: false }),
  });

  static readonly renderer = Layer.succeed(PluginExecutionContextService, {
    context: new PluginExecutionContext({ processKind: "renderer", allowedInRenderer: false }),
  });
}

export class PluginLoaderService extends Context.Service<PluginLoaderService, {
  readonly loadDeclarative: (pluginId: PluginId) => Effect.Effect<LoadedDeclarativePlugin, PluginLoaderServiceError>;
  readonly loadExecutable: (pluginId: PluginId) => Effect.Effect<LoadedExecutablePlugin, PluginLoaderServiceError>;
  readonly listDeclarative: () => Effect.Effect<readonly LoadedDeclarativePlugin[]>;
}>()("@tileborne/services-plugin/PluginLoaderService") {}

export type PluginLoaderServiceError = PluginLoaderError | PluginRegistryServiceError;

const notFound = (pluginId: PluginId): PluginNotFoundError =>
  new PluginNotFoundError({ pluginId, message: `plugin not found: ${pluginId}` });

const toMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const executableEntry = (manifest: PluginManifest): string | undefined => {
  if (Option.isNone(manifest.entry)) {
    return undefined;
  }
  const entry = manifest.entry.value;
  if (Option.isSome(entry.server)) {
    return entry.server.value;
  }
  if (Option.isSome(entry.runtime)) {
    return entry.runtime.value;
  }
  if (Option.isSome(entry.editor)) {
    return entry.editor.value;
  }
  return undefined;
};

const readVerifiedInstalledPlugin = (
  installed: InstalledPlugin,
): Effect.Effect<InstalledPlugin, PluginIntegrityError | PluginValidationError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => validatePluginDirectory(installed.rootPath),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: installed.rootPath, message: toMessage(cause) }),
    });
    const manifestInput = yield* Effect.tryPromise({
      try: () => readManifestJson(installed.rootPath),
      catch: (cause) =>
        new PluginValidationError({
          path: path.join(installed.rootPath, PLUGIN_MANIFEST_FILE),
          message: toMessage(cause),
        }),
    });
    const manifest = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(PluginManifest)(manifestInput),
      catch: (cause) =>
        new PluginValidationError({
          path: path.join(installed.rootPath, PLUGIN_MANIFEST_FILE),
          message: toMessage(cause),
        }),
    });
    yield* Effect.try({
      try: () => validatePluginContributions(manifest.id, manifest.contributes),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({
            path: path.join(installed.rootPath, PLUGIN_MANIFEST_FILE),
            message: toMessage(cause),
          }),
    });
    const expectedHash = yield* Effect.tryPromise({
      try: () => readInstalledLock(installed.rootPath),
      catch: (cause) => new PluginIntegrityError({ path: installed.rootPath, message: toMessage(cause) }),
    });
    const actualHash = yield* Effect.tryPromise({
      try: () => hashPluginDirectory(installed.rootPath),
      catch: (cause) => new PluginIntegrityError({ path: installed.rootPath, message: toMessage(cause) }),
    });
    if (actualHash !== expectedHash) {
      yield* new PluginIntegrityError({
        path: installed.rootPath,
        pluginId: manifest.id,
        expectedHash,
        actualHash,
        message: `installed plugin integrity mismatch: ${manifest.id}`,
      });
    }
    return new InstalledPlugin({
      ...installed,
      manifest,
      integrity: expectedHash,
    });
  });

export const PluginLoaderServiceLive = Layer.effect(
  PluginLoaderService,
  Effect.gen(function* () {
    const registry = yield* PluginRegistryService;
    const execution = yield* PluginExecutionContextService;
    const declarativeRef = yield* Ref.make(new Map<PluginId, LoadedDeclarativePlugin>());

    const loadDeclarative = Effect.fn("PluginLoaderService.loadDeclarative")(function* (pluginId: PluginId) {
      const plugins = yield* registry.list();
      const installed = plugins.find((candidate) => candidate.id === pluginId);
      if (!installed) {
        yield* notFound(pluginId);
      }
      const plugin = yield* readVerifiedInstalledPlugin(installed!);
      yield* Effect.try({
        try: () => validatePluginManifestPaths(plugin.rootPath, Schema.encodeSync(PluginManifest)(plugin.manifest)),
        catch: (cause) =>
          cause instanceof PluginValidationError
            ? cause
            : new PluginInstallError({ path: plugin.rootPath, message: toMessage(cause) }),
      });
      // Resolve + decode the plugin's catalog contributions at load time
      // (ADR-0019) so the loaded plugin carries materialized catalogs instead of
      // raw `{ indexPath }` indirection. Cross-plugin merge stays deferred to the
      // runtime-map-package capstone.
      const resolvedCatalogs = yield* resolvePluginGameObjectCatalogs(plugin.rootPath, plugin.manifest);
      const loaded = new LoadedDeclarativePlugin({
        pluginId,
        manifest: plugin.manifest,
        contributions: plugin.manifest.contributes,
        gameObjectCatalogs: resolvedCatalogs.map(
          (entry) =>
            new MaterializedGameObjectCatalog({
              contributionId: entry.contributionId,
              catalog: entry.catalog,
            }),
        ),
      });
      yield* Ref.update(declarativeRef, (current) => new Map(current).set(pluginId, loaded));
      return loaded;
    });

    const loadExecutable = Effect.fn("PluginLoaderService.loadExecutable")(function* (pluginId: PluginId) {
      if (execution.context.processKind === "renderer" && !execution.context.allowedInRenderer) {
        yield* new PluginExecutionForbiddenError({
          pluginId,
          processKind: execution.context.processKind,
          message: "plugin executable code is forbidden in the renderer",
        });
      }
      const plugins = yield* registry.list();
      const plugin = plugins.find((candidate) => candidate.id === pluginId);
      if (!plugin) {
        yield* notFound(pluginId);
      }
      const installed = yield* readVerifiedInstalledPlugin(plugin!);
      const entry = executableEntry(installed.manifest);
      if (!entry) {
        yield* new PluginInstallError({
          path: installed.rootPath,
          message: "plugin manifest has no executable entrypoint",
        });
      }
      const entryPath = yield* Effect.tryPromise({
        try: () => resolvePluginManifestPath(installed.rootPath, entry!),
        catch: (cause) =>
          cause instanceof PluginValidationError
            ? cause
            : new PluginInstallError({ path: installed.rootPath, message: toMessage(cause) }),
      });
      const module = yield* Effect.tryPromise({
        try: () => import(pathToFileURL(entryPath).href) as Promise<unknown>,
        catch: (cause) =>
          new PluginInstallError({ path: entryPath, message: toMessage(cause) }),
      });
      return {
        pluginId,
        manifest: installed.manifest,
        module,
      };
    });

    const listDeclarative = Effect.fn("PluginLoaderService.listDeclarative")(function* () {
      return [...(yield* Ref.get(declarativeRef)).values()];
    });

    return {
      loadDeclarative,
      loadExecutable,
      listDeclarative,
    };
  }),
);

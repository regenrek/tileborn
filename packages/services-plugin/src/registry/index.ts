import { readdir } from "node:fs/promises";
import path from "node:path";

import { PluginId } from "@tileborne/core";
import { PluginManifest, validatePluginContributions } from "@tileborne/plugin-api";
import { ConfigService, HomeService, type ConfigServiceError, type HomeServiceError } from "@tileborne/services-foundation";
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect";

import {
  hashPluginDirectory,
  pluginDirectoryName,
  readInstalledLock,
  readManifestJson,
  validatePluginDirectory,
  validatePluginManifestPaths,
} from "../filesystem.js";
import {
  InstalledPlugin,
  PLUGIN_MANIFEST_FILE,
  PluginIntegrityError,
  PluginNotFoundError,
  PluginRegistrySnapshot,
  PluginValidationError,
  PluginVerifyResult,
  type PluginRegistryError,
} from "../model.js";
import { assertWithinRoot, AssetPathSecurityError } from "@tileborne/asset-pipeline";

export type PluginRegistryServiceError =
  | PluginRegistryError
  | ConfigServiceError
  | HomeServiceError;

export class PluginRegistryService extends Context.Service<PluginRegistryService, {
  readonly discover: () => Effect.Effect<readonly InstalledPlugin[], PluginRegistryServiceError>;
  readonly list: () => Effect.Effect<readonly InstalledPlugin[], PluginRegistryServiceError>;
  readonly enable: (pluginId: PluginId) => Effect.Effect<InstalledPlugin, PluginRegistryServiceError>;
  readonly disable: (pluginId: PluginId) => Effect.Effect<InstalledPlugin, PluginRegistryServiceError>;
  readonly getManifest: (pluginId: PluginId) => Effect.Effect<PluginManifest, PluginRegistryServiceError>;
  readonly verify: (pluginId?: PluginId) => Effect.Effect<readonly PluginVerifyResult[], PluginRegistryServiceError>;
  readonly subscribe: Stream.Stream<PluginRegistrySnapshot, PluginRegistryServiceError>;
}>()("@tileborne/services-plugin/PluginRegistryService") {}

const toMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const pluginIdFromDirectoryEntry = (entry: string): PluginId => {
  const lastDash = entry.lastIndexOf("-");
  const encoded = lastDash > 0 ? entry.slice(0, lastDash) : entry;
  return Schema.decodeUnknownSync(PluginId)(decodeURIComponent(encoded));
};

const readInstalledPlugin = (
  rootPath: string,
  enabled: boolean,
): Effect.Effect<InstalledPlugin, PluginValidationError | PluginIntegrityError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => validatePluginDirectory(rootPath),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: rootPath, message: toMessage(cause) }),
    });
    const manifestInput = yield* Effect.tryPromise({
      try: () => readManifestJson(rootPath),
      catch: (cause) =>
        new PluginValidationError({
          path: path.join(rootPath, PLUGIN_MANIFEST_FILE),
          message: toMessage(cause),
        }),
    });
    const manifest = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(PluginManifest)(manifestInput),
      catch: (cause) =>
        new PluginValidationError({
          path: path.join(rootPath, PLUGIN_MANIFEST_FILE),
          message: toMessage(cause),
        }),
    });
    yield* Effect.try({
      try: () => validatePluginContributions(manifest.id, manifest.contributes),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({
            path: path.join(rootPath, PLUGIN_MANIFEST_FILE),
            message: toMessage(cause),
          }),
    });
    yield* Effect.try({
      try: () => validatePluginManifestPaths(rootPath, Schema.encodeSync(PluginManifest)(manifest)),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({
            path: path.join(rootPath, PLUGIN_MANIFEST_FILE),
            message: toMessage(cause),
          }),
    });
    const expectedHash = yield* Effect.tryPromise({
      try: () => readInstalledLock(rootPath),
      catch: (cause) => new PluginIntegrityError({ path: rootPath, message: toMessage(cause) }),
    });
    const actualHash = yield* Effect.tryPromise({
      try: () => hashPluginDirectory(rootPath),
      catch: (cause) => new PluginIntegrityError({ path: rootPath, message: toMessage(cause) }),
    });
    if (actualHash !== expectedHash) {
      yield* new PluginIntegrityError({
        path: rootPath,
        pluginId: manifest.id,
        expectedHash,
        actualHash,
        message: `installed plugin integrity mismatch: ${manifest.id}`,
      });
    }
    return new InstalledPlugin({
      id: manifest.id,
      version: manifest.version,
      enabled,
      rootPath,
      manifestPath: path.join(rootPath, PLUGIN_MANIFEST_FILE),
      manifest,
      integrity: expectedHash,
    });
  });

const notFound = (pluginId: PluginId): PluginNotFoundError =>
  new PluginNotFoundError({ pluginId, message: `plugin not found: ${pluginId}` });

const readPluginDirectoryEntries = (
  pluginsPath: string,
): Effect.Effect<readonly string[], PluginValidationError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        const entries = await readdir(pluginsPath, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
          .map((entry) => entry.name)
          .sort();
      } catch (cause) {
        if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") {
          return [];
        }
        throw cause;
      }
    },
    catch: (cause) =>
      new PluginValidationError({ path: pluginsPath, message: toMessage(cause) }),
  });

export const PluginRegistryServiceLive = Layer.effect(
  PluginRegistryService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const config = yield* ConfigService;
    const paths = yield* home.init();
    const triggerPubSub = yield* PubSub.unbounded<void>();

    const publish = Effect.fn("PluginRegistryService.publish")(function* () {
      yield* PubSub.publish(triggerPubSub, undefined);
    });

    const readVerifiedPlugins = Effect.fn("PluginRegistryService.readVerifiedPlugins")(function* () {
      yield* home.init();
      const currentConfig = yield* config.get;
      const entries = yield* readPluginDirectoryEntries(paths.plugins);
      const discovered = yield* Effect.forEach(entries, (entry) => {
        const rootPath = path.join(paths.plugins, entry);
        try {
          assertWithinRoot(paths.plugins, rootPath);
        } catch (cause) {
          if (!(cause instanceof AssetPathSecurityError)) {
            throw cause;
          }
          return Effect.fail(new PluginValidationError({
            path: rootPath,
            message: cause.message,
          }));
        }
        return readInstalledPlugin(rootPath, true).pipe(
          Effect.map((plugin) =>
            new InstalledPlugin({
              ...plugin,
              enabled: currentConfig.pluginPreferences[plugin.id] ?? true,
            }),
          ),
        );
      });
      return [...new Map(discovered.map((plugin) => [plugin.id, plugin])).values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    });

    const readVerifiedPluginById = Effect.fn("PluginRegistryService.readVerifiedPluginById")(function* (pluginId: PluginId) {
      yield* home.init();
      const currentConfig = yield* config.get;
      const entries = yield* readPluginDirectoryEntries(paths.plugins);
      const encodedPrefix = `${encodeURIComponent(pluginId)}-`;
      const entry = entries.filter((candidate) => candidate.startsWith(encodedPrefix)).at(-1);
      if (!entry) {
        yield* notFound(pluginId);
      }
      const rootPath = path.join(paths.plugins, entry!);
      try {
        assertWithinRoot(paths.plugins, rootPath);
      } catch (cause) {
        if (!(cause instanceof AssetPathSecurityError)) {
          throw cause;
        }
        yield* new PluginValidationError({
          path: rootPath,
          message: cause.message,
        });
      }
      return yield* readInstalledPlugin(rootPath, currentConfig.pluginPreferences[pluginId] ?? true);
    });

    const list = Effect.fn("PluginRegistryService.list")(function* () {
      return yield* readVerifiedPlugins();
    });

    const discover = Effect.fn("PluginRegistryService.discover")(function* () {
      const plugins = yield* readVerifiedPlugins();
      yield* publish();
      return plugins;
    });

    const updateEnabled = (pluginId: PluginId, enabled: boolean) =>
      Effect.fn(`PluginRegistryService.${enabled ? "enable" : "disable"}`)(function* () {
        const current = yield* readVerifiedPluginById(pluginId);
        const next = new InstalledPlugin({ ...current, enabled });
        yield* config.set({ pluginPreferences: { [pluginId]: enabled } });
        yield* publish();
        return next;
      })();

    const getManifest = Effect.fn("PluginRegistryService.getManifest")(function* (pluginId: PluginId) {
      return (yield* readVerifiedPluginById(pluginId)).manifest;
    });

    const versionFromDirectoryEntry = (entry: string): string => {
      const lastDash = entry.lastIndexOf("-");
      return lastDash > 0 ? entry.slice(lastDash + 1) : "0.0.0";
    };

    const verifyOne = (rootPath: string, pluginId: PluginId, enabled: boolean, version: string) =>
      readInstalledPlugin(rootPath, enabled).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.succeed(
              new PluginVerifyResult({
                pluginId,
                version,
                enabled,
                ok: false,
                message: toMessage(error),
              }),
            ),
          onSuccess: (plugin) =>
            Effect.succeed(
              new PluginVerifyResult({
                pluginId,
                version: plugin.version,
                enabled: plugin.enabled,
                ok: true,
                integrity: plugin.integrity,
              }),
            ),
        }),
      );

    const verify = Effect.fn("PluginRegistryService.verify")(function* (pluginId?: PluginId) {
      yield* home.init();
      const currentConfig = yield* config.get;
      if (pluginId) {
        const entries = yield* readPluginDirectoryEntries(paths.plugins);
        const encodedPrefix = `${encodeURIComponent(pluginId)}-`;
        const entry = entries.filter((candidate) => candidate.startsWith(encodedPrefix)).at(-1);
        if (!entry) {
          yield* notFound(pluginId);
        }
        const rootPath = path.join(paths.plugins, entry!);
        return [
          yield* verifyOne(
            rootPath,
            pluginId,
            currentConfig.pluginPreferences[pluginId] ?? true,
            versionFromDirectoryEntry(entry!),
          ),
        ];
      }
      const entries = yield* readPluginDirectoryEntries(paths.plugins);
      return yield* Effect.forEach(entries, (entry) => {
        const rootPath = path.join(paths.plugins, entry);
        const enabled = currentConfig.pluginPreferences[pluginIdFromDirectoryEntry(entry)] ?? true;
        return verifyOne(
          rootPath,
          pluginIdFromDirectoryEntry(entry),
          enabled,
          versionFromDirectoryEntry(entry),
        );
      });
    });

    const readVerifiedSnapshot = readVerifiedPlugins().pipe(
      Effect.map((plugins) => new PluginRegistrySnapshot({ plugins })),
    );

    const subscribe = Stream.unwrap(Effect.gen(function* () {
      const initial = yield* readVerifiedSnapshot;
      const subsequent = Stream.fromPubSub(triggerPubSub).pipe(
        Stream.mapEffect(() => readVerifiedSnapshot),
      );
      return Stream.concat(Stream.make(initial), subsequent);
    }));

    return {
      discover,
      list,
      enable: (pluginId) => updateEnabled(pluginId, true),
      disable: (pluginId) => updateEnabled(pluginId, false),
      getManifest,
      verify,
      subscribe,
    };
  }),
);

export const expectedPluginDirectoryName = pluginDirectoryName;

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Schema } from "effect";

import { ContentHash, type PluginId } from "@tileborne/core";
import {
  hashPluginDirectory,
  type InstalledPlugin,
  LocalPluginSource,
  type PluginInstallerServiceError,
  PluginInstallerService,
  PLUGIN_SEED_FINGERPRINT_FILE,
  type PluginRegistryServiceError,
  PluginRegistryService,
} from "@tileborne/services-plugin";

import { BUNDLED_PLUGINS, type BundledPluginSpec, resolveBundledPluginPath } from "./bundled-plugins.js";

/**
 * Typed failure raised when a bundled plugin's on-disk path cannot be resolved
 * (e.g. an unbuilt plugin package). Modeled as a typed Effect failure — NOT a
 * thrown defect — so the per-plugin {@link Effect.catch} can isolate it and let
 * the boot seed continue to the next bundled plugin.
 */
export class BundledPluginResolveError extends Schema.TaggedErrorClass<BundledPluginResolveError>()(
  "BundledPluginResolveError",
  {
    pluginId: Schema.String,
    message: Schema.String,
  },
) {}

const toMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const seedFingerprintPath = (rootPath: string): string =>
  path.join(rootPath, PLUGIN_SEED_FINGERPRINT_FILE);

const readSeedFingerprint = (rootPath: string) =>
  Effect.promise(async (): Promise<ContentHash | undefined> => {
    try {
      const raw = await readFile(seedFingerprintPath(rootPath), "utf8");
      return Schema.decodeUnknownSync(ContentHash)(raw.trim());
    } catch (cause) {
      if (isNotFound(cause)) {
        return undefined;
      }
      return undefined;
    }
  });

const writeSeedFingerprint = (rootPath: string, fingerprint: ContentHash) =>
  Effect.tryPromise({
    try: () => writeFile(seedFingerprintPath(rootPath), `${fingerprint}\n`, "utf8"),
    catch: (cause) => new Error(`failed to write bundled plugin seed fingerprint: ${toMessage(cause)}`),
  });

const hashBundledSource = (spec: BundledPluginSpec, sourcePath: string) =>
  Effect.tryPromise({
    try: () => hashPluginDirectory(sourcePath),
    catch: (cause) =>
      new BundledPluginResolveError({
        pluginId: spec.id,
        message: `failed to fingerprint bundled plugin at ${sourcePath}: ${toMessage(cause)}`,
      }),
  });

interface BundledPluginSeedServices {
  readonly registry: {
    readonly list: () => Effect.Effect<readonly InstalledPlugin[], PluginRegistryServiceError>;
    readonly enable: (pluginId: PluginId) => Effect.Effect<InstalledPlugin, PluginRegistryServiceError>;
  };
  readonly installer: {
    readonly install: (source: LocalPluginSource) => Effect.Effect<InstalledPlugin, PluginInstallerServiceError>;
  };
}

/**
 * Install (or re-enable) a single bundled plugin from its resolved on-disk root.
 * Idempotent: an already-installed plugin is enabled if needed, and
 * re-installed only when the bundled source fingerprint changes.
 */
export const installBundledPluginWithServices = (
  spec: BundledPluginSpec,
  { registry, installer }: BundledPluginSeedServices,
) =>
  Effect.gen(function* () {
    const sourcePath = yield* Effect.try({
      try: () => resolveBundledPluginPath(spec),
      catch: (cause) => new BundledPluginResolveError({ pluginId: spec.id, message: toMessage(cause) }),
    });
    const sourceFingerprint = yield* hashBundledSource(spec, sourcePath);
    const installed = yield* registry.list();
    const existing = installed.find((plugin) => plugin.id === spec.id);
    const ensureEnabled = (plugin: InstalledPlugin) =>
      plugin.enabled ? Effect.succeed(plugin) : registry.enable(plugin.id);
    if (existing) {
      const installedFingerprint = yield* readSeedFingerprint(existing.rootPath);
      if (installedFingerprint === sourceFingerprint) {
        yield* Effect.logInfo(
          `[tileborne:start] ${spec.id} bundled plugin up-to-date (fingerprint unchanged) -> skipping`,
        );
        return yield* ensureEnabled(existing);
      }
      yield* Effect.logInfo(
        `[tileborne:start] ${spec.id} content drift detected (fingerprint changed) -> reinstalling`,
      );
      const plugin = yield* installer.install(new LocalPluginSource({ path: sourcePath }));
      yield* writeSeedFingerprint(plugin.rootPath, sourceFingerprint);
      return yield* ensureEnabled(plugin);
    }
    yield* Effect.logInfo(`[tileborne:start] ${spec.id} bundled plugin not installed -> installing`);
    const plugin = yield* installer.install(new LocalPluginSource({ path: sourcePath }));
    yield* writeSeedFingerprint(plugin.rootPath, sourceFingerprint);
    if (!plugin.enabled) {
      return yield* registry.enable(plugin.id);
    }
    return plugin;
  });

export const installBundledPlugin = (spec: BundledPluginSpec) =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistryService;
    const installer = yield* PluginInstallerService;
    return yield* installBundledPluginWithServices(spec, { registry, installer });
  });

/**
 * Auto-seed EVERY bundled plugin on boot (Battle Royale + the example arena),
 * discovered from {@link BUNDLED_PLUGINS} — no single hardcoded plugin id/path.
 * Each plugin is seeded independently so a failure to resolve one (e.g. an
 * unbuilt package) does not block the others.
 */
export const seedBundledPlugins = Effect.forEach(
  BUNDLED_PLUGINS,
  (spec) =>
    installBundledPlugin(spec).pipe(
      Effect.asVoid,
      Effect.catch((error) => Effect.logWarning(`Failed to seed bundled plugin ${spec.id}`, error)),
    ),
  { discard: true },
).pipe(Effect.asVoid);

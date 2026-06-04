import { Effect, Schema } from "effect";

import { LocalPluginSource, PluginInstallerService, PluginRegistryService } from "@tileborne/services-plugin";

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

/**
 * Install (or re-enable) a single bundled plugin from its resolved on-disk root.
 * Idempotent: an already-installed plugin is enabled if needed, never
 * re-installed.
 */
export const installBundledPlugin = (spec: BundledPluginSpec) =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistryService;
    const installer = yield* PluginInstallerService;
    const installed = yield* registry.list();
    const existing = installed.find((plugin) => plugin.id === spec.id);
    if (existing) {
      return existing.enabled ? existing : yield* registry.enable(existing.id);
    }
    const sourcePath = yield* Effect.try({
      try: () => resolveBundledPluginPath(spec),
      catch: (cause) => new BundledPluginResolveError({ pluginId: spec.id, message: toMessage(cause) }),
    });
    const plugin = yield* installer.install(new LocalPluginSource({ path: sourcePath }));
    if (!plugin.enabled) {
      return yield* registry.enable(plugin.id);
    }
    return plugin;
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

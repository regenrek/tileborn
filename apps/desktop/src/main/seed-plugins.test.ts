// @vitest-environment node

import { ContentHash, PluginId } from "@tileborne/core";
import { PluginManifest } from "@tileborne/plugin-api";
import {
  InstalledPlugin,
  PluginInstallerService,
  PluginRegistryService,
  materializePluginManifestInput,
} from "@tileborne/services-plugin";
import { Effect, Layer, Logger, Schema, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_PLUGINS, resolveBundledPluginPath } from "./bundled-plugins.js";
import { seedBundledPlugins } from "./seed-plugins.js";

vi.mock("./bundled-plugins.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bundled-plugins.js")>();
  return {
    ...actual,
    resolveBundledPluginPath: vi.fn(actual.resolveBundledPluginPath),
  };
});

const ARENA_PLUGIN_ID = "@tileborne-plugins/example-arena";
const BATTLE_ROYALE_PLUGIN_ID = "@tileborne-plugins/battle-royale";

const fakeManifest = Schema.decodeUnknownSync(PluginManifest)(
  materializePluginManifestInput({
    schemaVersion: 1,
    id: "@tileborne-plugins/fake",
    name: "@tileborne-plugins/fake",
    version: "0.0.0",
    displayName: "Fake",
    description: "Fake bundled plugin used to record seed installs.",
    author: "Tileborne",
    license: "MIT",
    engines: { tileborne: "^0.1.0" },
    permissions: [],
    dependsOn: [],
    contributes: {},
  }),
);

const fakeContentHash = Schema.decodeUnknownSync(ContentHash)(`sha256:${"0".repeat(64)}`);

const fakeInstalled = (id: string, enabled: boolean): InstalledPlugin =>
  new InstalledPlugin({
    id: Schema.decodeUnknownSync(PluginId)(id),
    version: "0.0.0",
    enabled,
    rootPath: "/fake",
    manifestPath: "/fake/tileborne-plugin.json",
    manifest: fakeManifest,
    integrity: fakeContentHash,
  });

const makeServiceLayers = () => {
  const installedPaths: string[] = [];

  const installerLayer = Layer.succeed(PluginInstallerService, {
    install: (source) => {
      installedPaths.push(source._tag === "local" ? source.path : source._tag);
      return Effect.succeed(fakeInstalled("@tileborne-plugins/fake", true));
    },
    uninstall: () => Effect.void,
    update: () => Effect.succeed(fakeInstalled("@tileborne-plugins/fake", true)),
    create: () => Effect.die(new Error("unused in seed")),
    pack: () => Effect.die(new Error("unused in seed")),
  });

  const registryLayer = Layer.succeed(PluginRegistryService, {
    discover: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    enable: (id) => Effect.succeed(fakeInstalled(id, true)),
    disable: (id) => Effect.succeed(fakeInstalled(id, false)),
    getManifest: () => Effect.succeed(fakeManifest),
    verify: () => Effect.succeed([]),
    subscribe: Stream.empty,
  });

  return { installedPaths, installerLayer, registryLayer };
};

const captureWarnings = () => {
  const warnings: string[] = [];
  const logger = Logger.make<unknown, void>((options) => {
    if (options.logLevel === "Warn") {
      warnings.push(String(options.message));
    }
  });
  return { warnings, loggerLayer: Logger.layer([logger]) };
};

describe("seedBundledPlugins", () => {
  beforeEach(async () => {
    // Reset the resolver to its real implementation between tests; individual
    // isolation tests override it to simulate a single plugin failing.
    const actual = await vi.importActual<typeof import("./bundled-plugins.js")>("./bundled-plugins.js");
    vi.mocked(resolveBundledPluginPath).mockImplementation(actual.resolveBundledPluginPath);
  });

  it("seeds EVERY bundled plugin (battle royale AND the example arena), not just one", async () => {
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers();

    await Effect.runPromise(
      seedBundledPlugins.pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer))),
    );

    expect(installedPaths).toHaveLength(BUNDLED_PLUGINS.length);
    expect(installedPaths.some((path) => path.endsWith("plugin-battle-royale"))).toBe(true);
    expect(installedPaths.some((path) => path.endsWith("plugin-example-arena"))).toBe(true);
  });

  it("isolates a throwing path resolution for the arena so battle royale still installs", async () => {
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers();
    const { warnings, loggerLayer } = captureWarnings();

    vi.mocked(resolveBundledPluginPath).mockImplementation((spec) => {
      if (spec.id === ARENA_PLUGIN_ID) {
        throw new Error("example-arena is not built");
      }
      return `/resolved/${spec.bundledDirName}`;
    });

    // Must resolve (not reject): a single resolver throw is isolated, not fatal.
    await expect(
      Effect.runPromise(
        seedBundledPlugins.pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer, loggerLayer))),
      ),
    ).resolves.toBeUndefined();

    expect(installedPaths).toEqual(["/resolved/battle-royale"]);
    expect(warnings.some((message) => message.includes(BATTLE_ROYALE_PLUGIN_ID))).toBe(false);
    expect(warnings.some((message) => message.includes(ARENA_PLUGIN_ID))).toBe(true);
  });

  it("isolates a throwing path resolution for battle royale so the arena still installs", async () => {
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers();
    const { warnings, loggerLayer } = captureWarnings();

    vi.mocked(resolveBundledPluginPath).mockImplementation((spec) => {
      if (spec.id === BATTLE_ROYALE_PLUGIN_ID) {
        throw new Error("battle-royale is not built");
      }
      return `/resolved/${spec.bundledDirName}`;
    });

    await expect(
      Effect.runPromise(
        seedBundledPlugins.pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer, loggerLayer))),
      ),
    ).resolves.toBeUndefined();

    expect(installedPaths).toEqual(["/resolved/example-arena"]);
    expect(warnings.some((message) => message.includes(ARENA_PLUGIN_ID))).toBe(false);
    expect(warnings.some((message) => message.includes(BATTLE_ROYALE_PLUGIN_ID))).toBe(true);
  });
});

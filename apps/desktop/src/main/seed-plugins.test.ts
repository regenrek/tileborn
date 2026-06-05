// @vitest-environment node

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { ContentHash, PluginId } from "@tileborne/core";
import { PluginManifest } from "@tileborne/plugin-api";
import {
  hashPluginDirectory,
  InstalledPlugin,
  PluginInstallerService,
  PLUGIN_SEED_FINGERPRINT_FILE,
  PluginRegistryService,
  materializePluginManifestInput,
} from "@tileborne/services-plugin";
import { Effect, Layer, Logger, Schema, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_PLUGINS, resolveBundledPluginPath } from "./bundled-plugins.js";
import { installBundledPlugin, seedBundledPlugins } from "./seed-plugins.js";

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

const TEST_PLUGIN_ID = "@tileborne-plugins/test";

const fakeInstalled = (id: string, enabled: boolean, rootPath = "/fake"): InstalledPlugin =>
  new InstalledPlugin({
    id: Schema.decodeUnknownSync(PluginId)(id),
    version: "0.0.0",
    enabled,
    rootPath,
    manifestPath: path.join(rootPath, "tileborne-plugin.json"),
    manifest: fakeManifest,
    integrity: fakeContentHash,
  });

const tempDirectory = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "tileborne-seed-plugins-"));

const writeBundledSource = async (
  directory: string,
  options: { readonly manifestLabel?: string; readonly runtimeContent?: string } = {},
): Promise<void> => {
  await mkdir(path.join(directory, "dist"), { recursive: true });
  await writeFile(
    path.join(directory, "tileborne-plugin.json"),
    JSON.stringify({ id: TEST_PLUGIN_ID, label: options.manifestLabel ?? "initial" }, null, 2),
    "utf8",
  );
  await writeFile(path.join(directory, "dist", "runtime.js"), options.runtimeContent ?? "export {};\n", "utf8");
};

const writeSeedFingerprint = async (rootPath: string, fingerprint: ContentHash): Promise<void> => {
  await writeFile(path.join(rootPath, PLUGIN_SEED_FINGERPRINT_FILE), `${fingerprint}\n`, "utf8");
};

const readSeedFingerprint = async (rootPath: string): Promise<string> =>
  (await readFile(path.join(rootPath, PLUGIN_SEED_FINGERPRINT_FILE), "utf8")).trim();

const makeServiceLayers = ({
  installed = [],
  installRoot = "/fake",
  installResultId = "@tileborne-plugins/fake",
}: {
  readonly installed?: readonly InstalledPlugin[];
  readonly installRoot?: string;
  readonly installResultId?: string;
} = {}) => {
  const installedPaths: string[] = [];
  let installedPlugins = [...installed];

  const installerLayer = Layer.succeed(PluginInstallerService, {
    install: (source) => {
      installedPaths.push(source._tag === "local" ? source.path : source._tag);
      const plugin = fakeInstalled(installResultId, true, installRoot);
      installedPlugins = [plugin];
      return Effect.succeed(plugin);
    },
    uninstall: () => Effect.void,
    update: () => Effect.succeed(fakeInstalled(installResultId, true, installRoot)),
    create: () => Effect.die(new Error("unused in seed")),
    pack: () => Effect.die(new Error("unused in seed")),
  });

  const registryLayer = Layer.succeed(PluginRegistryService, {
    discover: () => Effect.succeed([]),
    list: () => Effect.succeed(installedPlugins),
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
    const installRoot = await tempDirectory();
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({ installRoot });

    await Effect.runPromise(
      seedBundledPlugins.pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer))),
    );

    expect(installedPaths).toHaveLength(BUNDLED_PLUGINS.length);
    expect(installedPaths.some((path) => path.endsWith("plugin-battle-royale"))).toBe(true);
    expect(installedPaths.some((path) => path.endsWith("plugin-example-arena"))).toBe(true);
  });

  it("skips an installed bundled plugin when the seed fingerprint is unchanged", async () => {
    const sourceRoot = await tempDirectory();
    const installedRoot = await tempDirectory();
    await writeBundledSource(sourceRoot);
    const fingerprint = await hashPluginDirectory(sourceRoot);
    await writeSeedFingerprint(installedRoot, fingerprint);
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({
      installed: [fakeInstalled(TEST_PLUGIN_ID, true, installedRoot)],
      installRoot: installedRoot,
      installResultId: TEST_PLUGIN_ID,
    });

    vi.mocked(resolveBundledPluginPath).mockReturnValue(sourceRoot);

    await Effect.runPromise(
      installBundledPlugin({
        id: TEST_PLUGIN_ID,
        bundledDirName: "test",
        workspacePackageDir: "plugin-test",
      }).pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer))),
    );

    expect(installedPaths).toEqual([]);
  });

  it("reinstalls an installed bundled plugin when the manifest fingerprint changes", async () => {
    const sourceRoot = await tempDirectory();
    const installedRoot = await tempDirectory();
    await writeBundledSource(sourceRoot);
    const oldFingerprint = await hashPluginDirectory(sourceRoot);
    await writeSeedFingerprint(installedRoot, oldFingerprint);
    await writeBundledSource(sourceRoot, { manifestLabel: "changed" });
    const newFingerprint = await hashPluginDirectory(sourceRoot);
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({
      installed: [fakeInstalled(TEST_PLUGIN_ID, true, installedRoot)],
      installRoot: installedRoot,
      installResultId: TEST_PLUGIN_ID,
    });

    vi.mocked(resolveBundledPluginPath).mockReturnValue(sourceRoot);

    await Effect.runPromise(
      installBundledPlugin({
        id: TEST_PLUGIN_ID,
        bundledDirName: "test",
        workspacePackageDir: "plugin-test",
      }).pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer))),
    );

    expect(installedPaths).toEqual([sourceRoot]);
    expect(await readSeedFingerprint(installedRoot)).toBe(newFingerprint);
  });

  it("reinstalls an installed bundled plugin when dist content changes", async () => {
    const sourceRoot = await tempDirectory();
    const installedRoot = await tempDirectory();
    await writeBundledSource(sourceRoot);
    const oldFingerprint = await hashPluginDirectory(sourceRoot);
    await writeSeedFingerprint(installedRoot, oldFingerprint);
    await writeBundledSource(sourceRoot, { runtimeContent: "export const changed = true;\n" });
    const newFingerprint = await hashPluginDirectory(sourceRoot);
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({
      installed: [fakeInstalled(TEST_PLUGIN_ID, true, installedRoot)],
      installRoot: installedRoot,
      installResultId: TEST_PLUGIN_ID,
    });

    vi.mocked(resolveBundledPluginPath).mockReturnValue(sourceRoot);

    await Effect.runPromise(
      installBundledPlugin({
        id: TEST_PLUGIN_ID,
        bundledDirName: "test",
        workspacePackageDir: "plugin-test",
      }).pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer))),
    );

    expect(installedPaths).toEqual([sourceRoot]);
    expect(await readSeedFingerprint(installedRoot)).toBe(newFingerprint);
  });

  it("installs and records a seed fingerprint when the bundled plugin is not installed", async () => {
    const sourceRoot = await tempDirectory();
    const installedRoot = await tempDirectory();
    await writeBundledSource(sourceRoot);
    const fingerprint = await hashPluginDirectory(sourceRoot);
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({
      installRoot: installedRoot,
      installResultId: TEST_PLUGIN_ID,
    });

    vi.mocked(resolveBundledPluginPath).mockReturnValue(sourceRoot);

    await Effect.runPromise(
      installBundledPlugin({
        id: TEST_PLUGIN_ID,
        bundledDirName: "test",
        workspacePackageDir: "plugin-test",
      }).pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer))),
    );

    expect(installedPaths).toEqual([sourceRoot]);
    expect(await readSeedFingerprint(installedRoot)).toBe(fingerprint);
  });

  it("isolates a throwing path resolution for the arena so battle royale still installs", async () => {
    const installRoot = await tempDirectory();
    const battleRoyaleSource = await tempDirectory();
    await writeBundledSource(battleRoyaleSource);
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({ installRoot });
    const { warnings, loggerLayer } = captureWarnings();

    vi.mocked(resolveBundledPluginPath).mockImplementation((spec) => {
      if (spec.id === ARENA_PLUGIN_ID) {
        throw new Error("example-arena is not built");
      }
      return battleRoyaleSource;
    });

    // Must resolve (not reject): a single resolver throw is isolated, not fatal.
    await expect(
      Effect.runPromise(
        seedBundledPlugins.pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer, loggerLayer))),
      ),
    ).resolves.toBeUndefined();

    expect(installedPaths).toEqual([battleRoyaleSource]);
    expect(warnings.some((message) => message.includes(BATTLE_ROYALE_PLUGIN_ID))).toBe(false);
    expect(warnings.some((message) => message.includes(ARENA_PLUGIN_ID))).toBe(true);
  });

  it("isolates a throwing path resolution for battle royale so the arena still installs", async () => {
    const installRoot = await tempDirectory();
    const arenaSource = await tempDirectory();
    await writeBundledSource(arenaSource);
    const { installedPaths, installerLayer, registryLayer } = makeServiceLayers({ installRoot });
    const { warnings, loggerLayer } = captureWarnings();

    vi.mocked(resolveBundledPluginPath).mockImplementation((spec) => {
      if (spec.id === BATTLE_ROYALE_PLUGIN_ID) {
        throw new Error("battle-royale is not built");
      }
      return arenaSource;
    });

    await expect(
      Effect.runPromise(
        seedBundledPlugins.pipe(Effect.provide(Layer.mergeAll(installerLayer, registryLayer, loggerLayer))),
      ),
    ).resolves.toBeUndefined();

    expect(installedPaths).toEqual([arenaSource]);
    expect(warnings.some((message) => message.includes(ARENA_PLUGIN_ID))).toBe(false);
    expect(warnings.some((message) => message.includes(BATTLE_ROYALE_PLUGIN_ID))).toBe(true);
  });
});

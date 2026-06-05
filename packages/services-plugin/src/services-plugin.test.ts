import { open, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gameObjectTypeIdForKey, PluginId } from "@tileborne/core";
import { mergeWeaponCatalogs, PluginManifest } from "@tileborne/plugin-api";
import { Effect, Fiber, Option, Queue, Result, Schema, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  expectedPluginDirectoryName,
  InstalledPlugin,
  LocalPluginSource,
  MAX_PLUGIN_BYTES,
  PluginExecutionContextService,
  PluginInstallerLayer,
  PluginInstallerService,
  PluginIntegrityError,
  PluginLoaderMainLayer,
  PluginLoaderRendererLayer,
  PluginLoaderService,
  PLUGIN_SEED_FINGERPRINT_FILE,
  PluginRegistryLayer,
  PluginRegistryService,
  PluginRegistrySnapshot,
  PluginValidationError,
  PluginServicesLayer,
} from "./index.js";
import {
  hashPluginDirectory,
  materializePluginManifestInput,
  validateRelativePluginPath,
  writeInstalledLock,
} from "./filesystem.js";

const tempHomes: string[] = [];

afterEach(async () => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      await rm(home, { recursive: true, force: true });
    }
  }
  delete process.env["TILEBORNE_HOME"];
});

const makeTempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), "tileborne-services-plugin-"));
  tempHomes.push(home);
  process.env["TILEBORNE_HOME"] = home;
  return home;
};

const pluginId = (id = "@tileborne-plugins/test"): PluginId => Schema.decodeUnknownSync(PluginId)(id);

const servicesPluginSrcDir = path.dirname(fileURLToPath(import.meta.url));
const battleRoyaleCatalogPath = path.resolve(
  servicesPluginSrcDir,
  "../../plugin-battle-royale/schemas/game-object-catalog.json",
);

const emptyContributes = {
  panels: undefined,
  tools: undefined,
  assetPacks: undefined,
  tilesetPacks: undefined,
  editor: undefined,
  runtime: undefined,
  server: undefined,
};

const manifest = (id: string, version = "0.1.0", extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id,
  name: id,
  version,
  displayName: "Test Plugin",
  description: "A synthetic test plugin.",
  author: "Tileborne",
  license: "MIT",
  engines: { tileborne: "^0.1.0" },
  repository: undefined,
  homepage: undefined,
  entry: undefined,
  contributes: emptyContributes,
  permissions: [],
  dependsOn: [],
  migrations: undefined,
  ...extra,
});

const writePluginSource = async (
  directory: string,
  id = "@tileborne-plugins/test",
  version = "0.1.0",
  extra: Record<string, unknown> = {},
) => {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "tileborne-plugin.json"), `${JSON.stringify(manifest(id, version, extra), null, 2)}\n`);
  await writeFile(path.join(directory, "README.md"), "test plugin\n");
};

const refreshInstalledLock = async (
  directory: string,
  id = "@tileborne-plugins/test",
  version = "0.1.0",
  extra: Record<string, unknown> = {},
) => {
  const decodedManifest = Schema.decodeUnknownSync(PluginManifest)(
    materializePluginManifestInput(manifest(id, version, extra)),
  );
  await writeInstalledLock(new InstalledPlugin({
    id: decodedManifest.id,
    version: decodedManifest.version,
    enabled: true,
    rootPath: directory,
    manifestPath: path.join(directory, "tileborne-plugin.json"),
    manifest: decodedManifest,
    integrity: await hashPluginDirectory(directory),
  }));
};

const writeInstalledPlugin = async (
  home: string,
  id = "@tileborne-plugins/test",
  version = "0.1.0",
  extra: Record<string, unknown> = {},
) => {
  const directory = path.join(home, "plugins", expectedPluginDirectoryName(id, version));
  await writePluginSource(directory, id, version, extra);
  await refreshInstalledLock(directory, id, version, extra);
  return directory;
};

const runWithRegistry = <A, E>(effect: Effect.Effect<A, E, PluginRegistryService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(PluginRegistryLayer)));

const runWithInstaller = <A, E>(effect: Effect.Effect<A, E, PluginInstallerService | PluginRegistryService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(PluginInstallerLayer)));

describe.sequential("PluginRegistryService", () => {
  it("discovers an empty home", async () => {
    await makeTempHome();
    const plugins = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      return yield* registry.discover();
    }));
    expect(plugins).toEqual([]);
  });

  it("discovers synthetic installed plugins", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home, "@tileborne-plugins/a");
    await writeInstalledPlugin(home, "@tileborne-plugins/b", "0.2.0");
    const plugins = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      return yield* registry.discover();
    }));
    expect(plugins.map((plugin) => plugin.id)).toEqual(["@tileborne-plugins/a", "@tileborne-plugins/b"]);
  });

  it("lists installed plugins by verifying the installed directory", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home);
    const plugins = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* registry.discover();
      return yield* registry.list();
    }));
    expect(plugins).toHaveLength(1);
  });

  it("rejects stale list reads when installed contents change after discovery", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);
    await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const plugins = yield* registry.list();
      expect(plugins).toHaveLength(1);
      yield* Effect.promise(() => writeFile(path.join(root, "README.md"), "tampered plugin\n"));
      return yield* registry.list();
    })).then(
      () => {
        throw new Error("expected registry.list to reject tampered plugin contents");
      },
      (cause) => {
        expect(cause).toBeInstanceOf(PluginIntegrityError);
      },
    );
  });

  it("returns a typed manifest by plugin id", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home);
    const found = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* registry.discover();
      return yield* registry.getManifest(pluginId());
    }));
    expect(found.id).toBe("@tileborne-plugins/test");
  });

  it("rejects stale manifest reads when installed contents change after discovery", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);
    await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const found = yield* registry.getManifest(pluginId());
      expect(found.id).toBe("@tileborne-plugins/test");
      yield* Effect.promise(() => writeFile(path.join(root, "README.md"), "tampered plugin\n"));
      return yield* registry.getManifest(pluginId());
    })).then(
      () => {
        throw new Error("expected registry.getManifest to reject tampered plugin contents");
      },
      (cause) => {
        expect(cause).toBeInstanceOf(PluginIntegrityError);
      },
    );
  });

  it("rejects installed plugins when directory contents no longer match the lock", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);
    await writeFile(path.join(root, "README.md"), "tampered plugin\n");

    await expect(runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      return yield* registry.discover();
    }))).rejects.toBeInstanceOf(PluginIntegrityError);
  });

  it("ignores the bundled seed fingerprint marker when verifying installed plugin integrity", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);
    await writeFile(path.join(root, PLUGIN_SEED_FINGERPRINT_FILE), `sha256:${"1".repeat(64)}\n`);

    const plugins = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      return yield* registry.discover();
    }));

    expect(plugins.map((plugin) => plugin.id)).toEqual(["@tileborne-plugins/test"]);
  });

  it("rejects installed plugins when the lock integrity is changed", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);
    const lockPath = path.join(root, "lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    lock["integrity"] = `sha256:${"0".repeat(64)}`;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    await expect(runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      return yield* registry.discover();
    }))).rejects.toBeInstanceOf(PluginIntegrityError);
  });

  it("disables plugins and persists preferences", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home);
    const disabled = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* registry.discover();
      return yield* registry.disable(pluginId());
    }));
    const config = JSON.parse(await readFile(path.join(home, "config.json"), "utf8")) as {
      readonly pluginPreferences: Record<string, boolean>;
    };
    expect(disabled.enabled).toBe(false);
    expect(config.pluginPreferences["@tileborne-plugins/test"]).toBe(false);
  });

  it("enables plugins and persists preferences", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home);
    const enabled = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* registry.discover();
      yield* registry.disable(pluginId());
      return yield* registry.enable(pluginId());
    }));
    expect(enabled.enabled).toBe(true);
  });

  it("emits subscription snapshots on changes", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home);
    const snapshots = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const emitted = yield* Queue.unbounded<PluginRegistrySnapshot>();
      const fiber = yield* registry.subscribe.pipe(
        Stream.take(2),
        Stream.runForEach((snapshot) => Queue.offer(emitted, snapshot)),
        Effect.forkDetach,
      );
      yield* Queue.take(emitted);
      yield* registry.discover();
      const latest = yield* Queue.take(emitted);
      yield* Fiber.join(fiber);
      return [latest];
    }));
    expect([...snapshots].at(-1)?.plugins).toHaveLength(1);
  });

  it("verifies the first subscription snapshot before any discovery", async () => {
    await makeTempHome();
    const snapshots = await runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      return yield* Stream.runCollect(Stream.take(registry.subscribe, 1));
    }));
    expect([...snapshots].at(0)?.plugins).toEqual([]);
  });

  it("rejects stale subscription snapshots when installed contents change after discovery", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);

    await expect(runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* registry.discover();
      yield* Effect.promise(() => writeFile(path.join(root, "README.md"), "tampered plugin\n"));
      return yield* Stream.runCollect(Stream.take(registry.subscribe, 1));
    }))).rejects.toBeInstanceOf(PluginIntegrityError);
  });

  it("rejects tampered plugins before publishing the next subscription snapshot", async () => {
    const home = await makeTempHome();
    const root = await writeInstalledPlugin(home);

    await expect(runWithRegistry(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* registry.discover();
      yield* Effect.promise(() => writeFile(path.join(root, "README.md"), "tampered plugin\n"));
      return yield* registry.discover();
    }))).rejects.toBeInstanceOf(PluginIntegrityError);
  });
});

describe("validateRelativePluginPath", () => {
  it("rejects raw traversal segments before normalization", () => {
    expect(() => validateRelativePluginPath("/root", "dir/../entry.js")).toThrow(PluginValidationError);
    expect(() => validateRelativePluginPath("/root", "..")).toThrow(PluginValidationError);
    expect(() => validateRelativePluginPath("/root", "a/../b")).toThrow(PluginValidationError);
  });

  it("accepts current-shape relative plugin paths", () => {
    expect(validateRelativePluginPath("/root", "./entry.js")).toBe(path.join("/root", "entry.js"));
    expect(validateRelativePluginPath("/root", "a/b/c.js")).toBe(path.join("/root", "a", "b", "c.js"));
  });
});

describe.sequential("PluginInstallerService", () => {
  it("installs a local source through staging and atomic rename", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source);
    try {
      const installed = await runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }));
      expect(installed.rootPath.endsWith(expectedPluginDirectoryName("@tileborne-plugins/test", "0.1.0"))).toBe(true);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects local path traversal source specs", async () => {
    await makeTempHome();
    await expect(runWithInstaller(Effect.gen(function* () {
      const installer = yield* PluginInstallerService;
      return yield* installer.install(new LocalPluginSource({ path: "../../etc/passwd" }));
    }))).rejects.toMatchObject({ _tag: "PluginValidationError" });
  });

  it("rejects symlink escapes inside local sources", async () => {
    await makeTempHome();
    const outside = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-outside-"));
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source);
    await symlink(outside, path.join(source, "outside"), "dir");
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toMatchObject({ _tag: "PluginValidationError" });
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("enforces the plugin size cap", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source);
    const handle = await open(path.join(source, "huge.bin"), "w");
    await handle.truncate(MAX_PLUGIN_BYTES + 1);
    await handle.close();
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toMatchObject({ _tag: "PluginValidationError" });
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects malformed manifest JSON", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "tileborne-plugin.json"), "{");
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toMatchObject({ _tag: "PluginValidationError" });
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects manifests missing required fields", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "tileborne-plugin.json"), JSON.stringify({ id: "@tileborne-plugins/test" }));
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toMatchObject({ _tag: "PluginValidationError" });
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects sidebar contribution zones outside the canonical set", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source, "@tileborne-plugins/test", "0.1.0", {
      contributes: {
        ...emptyContributes,
        panels: [
          {
            id: "bad-zone",
            zone: "activity-bar",
            title: "Bad Zone",
          },
        ],
      },
    });
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toMatchObject({ _tag: "PluginValidationError" });
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects duplicate sidebar panel contribution ids", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source, "@tileborne-plugins/test", "0.1.0", {
      contributes: {
        ...emptyContributes,
        panels: [
          {
            id: "battle-royale-settings",
            zone: "plugins",
            title: "Battle Royale Settings",
          },
          {
            id: "battle-royale-settings",
            zone: "project",
            title: "Battle Royale Settings Copy",
          },
        ],
      },
    });
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toMatchObject({
        _tag: "PluginValidationError",
        message: expect.stringContaining("duplicate panel contribution id"),
      });
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects manifest executable entries that traverse above the plugin root", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source, "@tileborne-plugins/test", "0.1.0", {
      entry: { server: "../escape.js" },
    });
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toBeInstanceOf(PluginValidationError);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("rejects manifest executable entries that use absolute paths", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source, "@tileborne-plugins/test", "0.1.0", {
      entry: { server: "/etc/passwd" },
    });
    try {
      await expect(runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }))).rejects.toBeInstanceOf(PluginValidationError);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("records the SHA-256 integrity hash of local directory sources", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source);
    try {
      const installed = await runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }));
      const expected = await hashPluginDirectory(installed.rootPath);
      expect(installed.integrity).toBe(expected);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("replaces a non-empty existing plugin directory during install", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source);
    const existing = path.join(home, "plugins", expectedPluginDirectoryName("@tileborne-plugins/test", "0.1.0"));
    await mkdir(existing, { recursive: true });
    await writeFile(path.join(existing, "occupied.txt"), "rename target is non-empty\n");
    try {
      const installed = await runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.install(new LocalPluginSource({ path: source }));
      }));
      expect(installed.rootPath).toBe(existing);
      await expect(readFile(path.join(existing, "tileborne-plugin.json"), "utf8")).resolves.toContain(
        "@tileborne-plugins/test",
      );
      await expect(readFile(path.join(existing, "occupied.txt"), "utf8")).rejects.toThrow();
      const staging = path.join(home, "cache", "plugins", "staging");
      expect(await readdir(staging).catch(() => [])).toEqual([]);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("uninstalls all versions for a plugin id", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source);
    try {
      await runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        yield* installer.install(new LocalPluginSource({ path: source }));
        yield* installer.uninstall(pluginId());
      }));
      expect(await readdir(path.join(home, "plugins"))).toEqual([]);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  it("updates by removing the existing install then installing the source", async () => {
    await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-source-"));
    await writePluginSource(source, "@tileborne-plugins/test", "0.2.0");
    try {
      const installed = await runWithInstaller(Effect.gen(function* () {
        const installer = yield* PluginInstallerService;
        return yield* installer.update(pluginId(), new LocalPluginSource({ path: source }));
      }));
      expect(installed.version).toBe("0.2.0");
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });
});

describe.sequential("PluginLoaderService", () => {
  it("loads declarative asset-pack contributions", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", {
      contributes: {
        ...emptyContributes,
        assetPacks: [
          {
            _tag: "AssetPackContribution",
            id: "meadow",
            name: "Meadow",
            path: "./assets/meadow",
            license: { spdxId: "MIT" },
          },
        ],
      },
    });
    const loaded = await Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadDeclarative(pluginId());
    }).pipe(Effect.provide(PluginLoaderMainLayer)));
    expect(loaded.pluginId).toBe("@tileborne-plugins/test");
  });

  it("materializes a plugin's gameObjectCatalogs (indexPath) on load via loadDeclarative", async () => {
    const home = await makeTempHome();
    const id = "@tileborne-plugins/test";
    const version = "0.1.0";
    const extra = {
      contributes: {
        ...emptyContributes,
        runtime: {
          gameObjectCatalogs: [
            {
              _tag: "DeclarativeRuntimeGameObjectCatalogContribution",
              id: "br-game-object-catalog",
              kind: "declarative",
              data: { indexPath: "./schemas/game-object-catalog.json" },
            },
          ],
        },
      },
    };
    const directory = path.join(home, "plugins", expectedPluginDirectoryName(id, version));
    await writePluginSource(directory, id, version, extra);
    // Ship the REAL Battle Royale catalog pack behind the contribution indexPath
    // so loadDeclarative resolves + decodes it through the production path. The
    // catalog file must exist before the lock is refreshed (integrity covers it).
    const realCatalog = await readFile(battleRoyaleCatalogPath, "utf8");
    await mkdir(path.join(directory, "schemas"), { recursive: true });
    await writeFile(path.join(directory, "schemas", "game-object-catalog.json"), realCatalog);
    await refreshInstalledLock(directory, id, version, extra);

    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* PluginRegistryService;
        const loader = yield* PluginLoaderService;
        yield* registry.discover();
        return yield* loader.loadDeclarative(pluginId());
      }).pipe(Effect.provide(PluginLoaderMainLayer)),
    );

    expect(loaded.gameObjectCatalogs).toHaveLength(1);
    const materialized = loaded.gameObjectCatalogs[0];
    expect(materialized?.contributionId).toBe("br-game-object-catalog");
    const objectTypeIds = materialized?.catalog.objectTypes.map((type) => type.id) ?? [];
    expect(objectTypeIds).toContain(gameObjectTypeIdForKey("spawn-point"));
    expect(objectTypeIds).toContain(gameObjectTypeIdForKey("shrink-zone-anchor"));
    expect(objectTypeIds).toContain(gameObjectTypeIdForKey("loot-crate"));
  });

  it("materializes a plugin's weaponCatalogs (inline data) on load and merges them", async () => {
    const home = await makeTempHome();
    const id = "@tileborne-plugins/test";
    const version = "0.1.0";
    const weaponId = "weapon:0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f60";
    const extra = {
      contributes: {
        ...emptyContributes,
        runtime: {
          weaponCatalogs: [
            {
              _tag: "DeclarativeRuntimeWeaponCatalogContribution",
              id: "test-weapon-catalog",
              kind: "declarative",
              data: {
                schemaVersion: 1,
                weapons: [
                  {
                    weapon: {
                      id: weaponId,
                      damage: 25,
                      cooldownTicks: 8,
                      magazineSize: 1,
                      reloadTicks: 0,
                    },
                    delivery: {
                      _tag: "ProjectileDelivery",
                      damage: 25,
                      speed: 20,
                      ttlTicks: 40,
                      radius: 16,
                      falloff: { _tag: "NoFalloff" },
                      knockback: 0,
                    },
                    appliesStatus: [],
                  },
                ],
              },
            },
          ],
        },
      },
    };
    const directory = path.join(home, "plugins", expectedPluginDirectoryName(id, version));
    await writePluginSource(directory, id, version, extra);
    await refreshInstalledLock(directory, id, version, extra);

    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* PluginRegistryService;
        const loader = yield* PluginLoaderService;
        yield* registry.discover();
        return yield* loader.loadDeclarative(pluginId());
      }).pipe(Effect.provide(PluginLoaderMainLayer)),
    );

    expect(loaded.weaponCatalogs).toHaveLength(1);
    const materialized = loaded.weaponCatalogs[0];
    expect(materialized?.contributionId).toBe("test-weapon-catalog");
    expect(materialized?.catalog.weapons[0]?.weapon.id).toBe(weaponId);

    const merged = mergeWeaponCatalogs(
      loaded.weaponCatalogs.map((entry) => ({
        contributionId: entry.contributionId,
        catalog: entry.catalog,
      })),
    );
    expect(Result.isSuccess(merged)).toBe(true);
    if (Result.isSuccess(merged)) {
      expect(merged.success.byId.has(weaponId)).toBe(true);
    }
  });

  it("loads sidebar panel and tool contributions for enabled plugins", async () => {
    const home = await makeTempHome();
    await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", {
      contributes: {
        ...emptyContributes,
        panels: [
          {
            id: "battle-royale-settings",
            zone: "plugins",
            title: "Battle Royale Settings",
            description: "Configure battle royale gameplay.",
          },
        ],
        tools: [
          {
            id: "spawn-tools",
            zone: "working-palette",
            title: "Spawn Tools",
            data: { objectType: "br-spawn" },
          },
        ],
      },
    });
    const loaded = await Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadDeclarative(pluginId());
    }).pipe(Effect.provide(PluginLoaderMainLayer)));

    const panels = Option.getOrElse(loaded.contributions.panels, () => []);
    const tools = Option.getOrElse(loaded.contributions.tools, () => []);
    expect(panels[0]?.zone).toBe("plugins");
    expect(tools[0]?.zone).toBe("working-palette");
  });

  it("loads executable entrypoints in the main process", async () => {
    const home = await makeTempHome();
    const extra = {
      entry: { server: "./entry.js" },
    };
    const root = await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", extra);
    await writeFile(path.join(root, "entry.js"), "export const loaded = true;\n");
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", extra);
    const loaded = await Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadExecutable(pluginId());
    }).pipe(Effect.provide(PluginLoaderMainLayer)));
    expect((loaded.module as { readonly loaded?: boolean }).loaded).toBe(true);
  });

  it("rejects malicious executable entries written after install", async () => {
    const home = await makeTempHome();
    const safeExtra = { entry: { server: "./entry.js" } };
    const root = await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", safeExtra);
    await writeFile(path.join(root, "entry.js"), "export const loaded = true;\n");
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", safeExtra);

    const badExtra = { entry: { server: "../escape.js" } };
    await writeFile(
      path.join(root, "tileborne-plugin.json"),
      `${JSON.stringify(manifest("@tileborne-plugins/test", "0.1.0", badExtra), null, 2)}\n`,
    );
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", badExtra);

    await expect(Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadExecutable(pluginId());
    }).pipe(Effect.provide(PluginLoaderMainLayer)))).rejects.toBeInstanceOf(PluginValidationError);
  });

  it("rejects malicious absolute executable entries written after install", async () => {
    const home = await makeTempHome();
    const safeExtra = { entry: { server: "./entry.js" } };
    const root = await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", safeExtra);
    await writeFile(path.join(root, "entry.js"), "export const loaded = true;\n");
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", safeExtra);

    const badExtra = { entry: { server: "/etc/passwd" } };
    await writeFile(
      path.join(root, "tileborne-plugin.json"),
      `${JSON.stringify(manifest("@tileborne-plugins/test", "0.1.0", badExtra), null, 2)}\n`,
    );
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", badExtra);

    await expect(Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadExecutable(pluginId());
    }).pipe(Effect.provide(PluginLoaderMainLayer)))).rejects.toBeInstanceOf(PluginValidationError);
  });

  it("rejects declarative contribution paths written after install", async () => {
    const home = await makeTempHome();
    const safeExtra = {
      contributes: {
        ...emptyContributes,
        assetPacks: [
          {
            _tag: "AssetPackContribution",
            id: "meadow",
            name: "Meadow",
            path: "./assets/meadow",
            license: { spdxId: "MIT" },
          },
        ],
      },
    };
    const root = await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", safeExtra);
    const badExtra = {
      contributes: {
        ...emptyContributes,
        assetPacks: [
          {
            _tag: "AssetPackContribution",
            id: "meadow",
            name: "Meadow",
            path: "../assets/meadow",
            license: { spdxId: "MIT" },
          },
        ],
      },
    };
    await writeFile(
      path.join(root, "tileborne-plugin.json"),
      `${JSON.stringify(manifest("@tileborne-plugins/test", "0.1.0", badExtra), null, 2)}\n`,
    );
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", badExtra);

    await expect(Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadDeclarative(pluginId());
    }).pipe(Effect.provide(PluginLoaderMainLayer)))).rejects.toBeInstanceOf(PluginValidationError);
  });

  it("forbids executable entrypoints in the renderer", async () => {
    const home = await makeTempHome();
    const extra = {
      entry: { server: "./entry.js" },
    };
    const root = await writeInstalledPlugin(home, "@tileborne-plugins/test", "0.1.0", extra);
    await writeFile(path.join(root, "entry.js"), "export const loaded = true;\n");
    await refreshInstalledLock(root, "@tileborne-plugins/test", "0.1.0", extra);
    await expect(Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      const loader = yield* PluginLoaderService;
      yield* registry.discover();
      return yield* loader.loadExecutable(pluginId());
    }).pipe(Effect.provide(PluginLoaderRendererLayer)))).rejects.toMatchObject({
      _tag: "PluginExecutionForbiddenError",
    });
  });

  it("exposes the main execution context layer", async () => {
    const context = await Effect.runPromise(Effect.gen(function* () {
      const execution = yield* PluginExecutionContextService;
      return execution.context;
    }).pipe(Effect.provide(PluginExecutionContextService.main)));
    expect(context.processKind).toBe("main");
  });

  it("composes the default plugin services layer", async () => {
    await makeTempHome();
    const plugins = await Effect.runPromise(Effect.gen(function* () {
      const registry = yield* PluginRegistryService;
      yield* PluginInstallerService;
      yield* PluginLoaderService;
      return yield* registry.discover();
    }).pipe(Effect.provide(PluginServicesLayer)));
    expect(plugins).toEqual([]);
  });
});

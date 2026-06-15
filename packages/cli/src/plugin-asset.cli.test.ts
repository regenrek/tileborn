import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  AssetPackManifest,
  AssetPackManifestAsset,
  assetPackManifestToJson,
} from "@tileborne/asset-pipeline";
import {
  AssetId,
  ContentHash,
  hashBytes,
  makeAssetId,
  makePackId,
} from "@tileborne/core";
import { License } from "@tileborne/asset-pipeline";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/main.js");

const tempHomes: string[] = [];
let cliChain: Promise<void> = Promise.resolve();

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

afterEach(async () => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      await rm(home, { recursive: true, force: true });
    }
  }
  delete process.env["TILEBORNE_HOME"];
  await pause();
});

beforeEach(() => {
  delete process.env["TILEBORNE_HOME"];
});

const makeTempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), "tileborne-cli-plugin-asset-"));
  tempHomes.push(home);
  return home;
};

const runCli = async (
  args: readonly string[],
  home: string,
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const previous = cliChain;
  let release!: () => void;
  cliChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    try {
      const result = await execFileAsync(process.execPath, [CLI, ...args], {
        env: { ...process.env, TILEBORNE_HOME: home },
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: String(result.stdout), stderr: String(result.stderr), code: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: String(failed.stdout ?? ""),
        stderr: String(failed.stderr ?? ""),
        code: failed.code ?? 1,
      };
    }
  } finally {
    release();
  }
};

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const license = new License({
  spdxId: "CC0-1.0",
  attribution: Option.none(),
  sourceUrl: Option.some("https://example.invalid/assets"),
  notes: Option.none(),
});

const writePluginSource = async (directory: string, id = "@tileborne-plugins/cli-test") => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "tileborne-plugin.json"),
    `{
  "schemaVersion": 1,
  "id": ${JSON.stringify(id)},
  "name": "cli-test",
  "version": "0.1.0",
  "displayName": "CLI Test",
  "description": "CLI test plugin",
  "author": "Tileborne",
  "license": "MIT",
  "engines": { "tileborne": "^0.1.0" },
  "contributes": {},
  "permissions": [],
  "dependsOn": []
}
`,
  );
  await writeFile(path.join(directory, "README.md"), "cli test\n");
};

const writeAssetPackSource = async (directory: string, packId = makePackId("550e8400-e29b-41d4-a716-446655440010")) => {
  const manifest = new AssetPackManifest({
    id: packId,
    name: "CLI Pack",
    version: "1.0.0",
    license,
    assets: [
      new AssetPackManifestAsset({
        id: makeAssetId("550e8400-e29b-41d4-a716-446655440011") as AssetId,
        path: "tiles/terrain.png",
        mime: "image/png",
        size: png.byteLength,
        hash: hashBytes(png) as ContentHash,
        license: Option.some(license),
      }),
    ],
  });
  await mkdir(path.join(directory, "tiles"), { recursive: true });
  await writeFile(path.join(directory, "tileborne-asset-pack.json"), `${JSON.stringify(assetPackManifestToJson(manifest), null, 2)}\n`);
  await writeFile(path.join(directory, "tiles", "terrain.png"), png);
};

describe.sequential("plugin and asset CLI", () => {
describe.sequential("plugin CLI", () => {
  it("installs a local plugin source", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-src-"));
    await writePluginSource(source);
    const result = await runCli(["plugin", "install", "--local", source, "--json"], home);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly ok: boolean; readonly data: { readonly id: string } };
    expect(payload.ok).toBe(true);
    expect(payload.data.id).toBe("@tileborne-plugins/cli-test");
  });

  it("installs a dev-symlink plugin source", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-link-"));
    await writePluginSource(source, "@tileborne-plugins/cli-link");
    const result = await runCli(["plugin", "install", "--dev-symlink", source, "--json"], home);
    expect(result.code).toBe(0);
  });

  it("installs a tarball plugin with integrity", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-tar-src-"));
    await writePluginSource(source, "@tileborne-plugins/cli-tar");
    const bundle = path.join(source, "bundle");
    await mkdir(bundle, { recursive: true });
    await writeFile(path.join(bundle, "tileborne-plugin.json"), await readFile(path.join(source, "tileborne-plugin.json")));
    await writeFile(path.join(bundle, "README.md"), await readFile(path.join(source, "README.md")));
    const archive = path.join(source, "plugin.tbpack");
    await execFileAsync("tar", ["-czf", archive, "-C", source, "bundle"]);
    const bytes = await readFile(archive);
    const { createHash } = await import("node:crypto");
    const expected = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const result = await runCli([
      "plugin",
      "install",
      "--tarball",
      archive,
      "--integrity",
      expected,
      "--json",
    ], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
  });

  it("detects integrity drift after install", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-drift-"));
    await writePluginSource(source, "@tileborne-plugins/cli-drift");
    const install = await runCli(["plugin", "install", "--local", source, "--json"], home);
    expect(install.code, install.stderr + install.stdout).toBe(0);
    await writeFile(path.join(source, "README.md"), "mutated\n");
    const installedDir = path.join(
      home,
      "plugins",
      `${encodeURIComponent("@tileborne-plugins/cli-drift")}-0.1.0`,
    );
    await writeFile(path.join(installedDir, "README.md"), "tampered\n");
    const verify = await runCli(["plugin", "verify", "@tileborne-plugins/cli-drift"], home);
    expect(verify.code).toBe(65);
  });

  it("creates plugin scaffold files", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-create-"));
    tempHomes.push(cwd);
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      const result = await runCli(["plugin", "create", "created-plugin", "--json"], await makeTempHome());
      expect(result.code).toBe(0);
      await expect(readFile(path.join(cwd, "created-plugin", "tileborne-plugin.json"), "utf8")).resolves.toContain(
        "@tileborne-plugins/created-plugin",
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("emits deterministic list json fields", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-list-"));
    await writePluginSource(source, "@tileborne-plugins/cli-list");
    const installed = await runCli(["plugin", "install", "--local", source, "--json"], home);
    expect(installed.code, installed.stderr + installed.stdout).toBe(0);
    const result = await runCli(["plugin", "list", "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly data: { readonly plugins: readonly { readonly id: string; readonly integrityOk: boolean }[] };
    };
    expect(payload.data.plugins[0]).toMatchObject({
      id: "@tileborne-plugins/cli-list",
      integrityOk: true,
    });
  });

  it("packs a plugin directory to .tbpack with metadata", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-pack-src-"));
    await writePluginSource(source, "@tileborne-plugins/cli-pack");
    const archive = path.join(source, "dist", "cli-pack.tbpack");
    const result = await runCli(["plugin", "pack", source, "--out", archive, "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly data: { readonly archivePath: string; readonly integrity: string } };
    expect(payload.data.archivePath).toMatch(/\.tbpack$/);
    await expect(readFile(`${payload.data.archivePath}.meta.json`, "utf8")).resolves.toContain(payload.data.integrity);
  });

  it("reports plugin info and removes an installation", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-info-"));
    const pluginId = "@tileborne-plugins/cli-info";
    await writePluginSource(source, pluginId);
    const install = await runCli(["plugin", "install", "--local", source, "--json"], home);
    expect(install.code).toBe(0);
    const info = await runCli(["plugin", "info", pluginId, "--json"], home);
    expect(info.code).toBe(0);
    const infoPayload = JSON.parse(info.stdout) as { readonly data: { readonly id: string; readonly permissions: unknown[] } };
    expect(infoPayload.data.id).toBe(pluginId);
    expect(infoPayload.data.permissions).toEqual([]);
    const removed = await runCli(["plugin", "remove", pluginId, "--json"], home);
    expect(removed.code).toBe(0);
    const list = await runCli(["plugin", "list", "--json"], home);
    const listPayload = JSON.parse(list.stdout) as { readonly data: { readonly plugins: readonly unknown[] } };
    expect(listPayload.data.plugins).toEqual([]);
  }, 15_000);

  it("toggles enable and disable state", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-toggle-"));
    const pluginId = "@tileborne-plugins/cli-toggle";
    await writePluginSource(source, pluginId);
    expect((await runCli(["plugin", "install", "--local", source, "--json"], home)).code).toBe(0);
    expect((await runCli(["plugin", "disable", pluginId, "--json"], home)).code).toBe(0);
    const disabled = JSON.parse((await runCli(["plugin", "list", "--json"], home)).stdout) as {
      readonly data: { readonly plugins: readonly { readonly id: string; readonly enabled: boolean }[] };
    };
    expect(disabled.data.plugins[0]?.enabled).toBe(false);
    expect((await runCli(["plugin", "enable", pluginId, "--json"], home)).code).toBe(0);
    const enabled = JSON.parse((await runCli(["plugin", "list", "--json"], home)).stdout) as {
      readonly data: { readonly plugins: readonly { readonly enabled: boolean }[] };
    };
    expect(enabled.data.plugins[0]?.enabled).toBe(true);
  }, 15_000);

  it("verifies all installed plugins in json mode", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-verify-all-"));
    await writePluginSource(source, "@tileborne-plugins/cli-verify-all");
    expect((await runCli(["plugin", "install", "--local", source, "--json"], home)).code).toBe(0);
    const verify = await runCli(["plugin", "verify", "--json"], home);
    expect(verify.code).toBe(0);
    const payload = JSON.parse(verify.stdout) as {
      readonly data: { readonly results: readonly { readonly id: string; readonly ok: boolean }[] };
    };
    expect(payload.data.results[0]).toMatchObject({ id: "@tileborne-plugins/cli-verify-all", ok: true });
  });

  it("installs via plugin link alias", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-plugin-link-alias-"));
    await writePluginSource(source, "@tileborne-plugins/cli-link-alias");
    const result = await runCli(["plugin", "link", source, "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
  });
});

describe.sequential("asset CLI", () => {
  it("imports a directory asset pack", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-asset-dir-"));
    await writeAssetPackSource(source, makePackId("550e8400-e29b-41d4-a716-446655440088"));
    const result = await runCli(["asset", "import", source, "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly data: { readonly packId: string } };
    expect(payload.data.packId).toMatch(/^pack:/);
  });

  it("imports a .tbpack archive", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-asset-tar-"));
    const bundle = path.join(source, "pack");
    await writeAssetPackSource(bundle, makePackId("550e8400-e29b-41d4-a716-446655440099"));
    const archive = `${source}.tbpack`;
    await execFileAsync("tar", ["-czf", archive, "-C", bundle, "."]);
    const result = await runCli(["asset", "import", archive, "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
  });

  it("reindex writes the project asset index file", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-asset-reindex-"));
    const packId = makePackId("550e8400-e29b-41d4-a716-446655440020");
    await writeAssetPackSource(source, packId);
    const init = await runCli(["project", "init", "reindex-proj", "--json"], home);
    const projectPath = (JSON.parse(init.stdout) as { readonly data: { readonly path: string } }).data.path;
    const imported = await runCli(["asset", "import", source, "--json"], home);
    expect(imported.code, imported.stderr + imported.stdout).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(projectPath, "project.json"), "utf8")) as {
      assetPacks: { id: string; version: string }[];
    };
    manifest.assetPacks = [{ id: packId, version: "1.0.0" }];
    await writeFile(path.join(projectPath, "project.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const upgrade = await runCli(["project", "upgrade", "--at", projectPath, "--json"], home);
    expect(upgrade.code, upgrade.stderr + upgrade.stdout).toBe(0);
    const result = await runCli(["asset", "reindex", "--project", "reindex-proj", "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const indexPath = path.join(projectPath, ".tileborne", "derived", "asset-index.json");
    await expect(readFile(indexPath, "utf8")).resolves.toContain(packId);
  });

  it("emits deterministic asset list json fields", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-asset-list-"));
    await writeAssetPackSource(source, makePackId("550e8400-e29b-41d4-a716-446655440077"));
    const imported = await runCli(["asset", "import", source, "--json"], home);
    expect(imported.code, imported.stderr + imported.stdout).toBe(0);
    const result = await runCli(["asset", "list", "--json"], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly data: { readonly packs: readonly { readonly id: string; readonly assetCount: number }[] };
    };
    expect(payload.data.packs[0]).toMatchObject({ assetCount: 1 });
  });

  it("reports asset info and removes a pack", async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-asset-info-"));
    const packId = makePackId("550e8400-e29b-41d4-a716-446655440030");
    await writeAssetPackSource(source, packId);
    const imported = await runCli(["asset", "import", source, "--json"], home);
    expect(imported.code).toBe(0);
    const info = await runCli(["asset", "info", packId, "--json"], home);
    expect(info.code).toBe(0);
    const infoPayload = JSON.parse(info.stdout) as { readonly data: { readonly id: string; readonly assetCount: number } };
    expect(infoPayload.data).toMatchObject({ id: packId, assetCount: 1 });
    const removed = await runCli(["asset", "remove", packId, "--json"], home);
    expect(removed.code).toBe(0);
    const list = JSON.parse((await runCli(["asset", "list", "--json"], home)).stdout) as {
      readonly data: { readonly packs: readonly unknown[] };
    };
    expect(list.data.packs).toEqual([]);
  }, 15_000);
});
});

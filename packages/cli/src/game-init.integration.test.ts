import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { decodeBrandConfig } from "@tileborne/core";
import { afterEach, describe, expect, it } from "vitest";

import { scaffoldGameProject } from "./commands/game/init.js";
import { DEFAULT_GAME_PLUGIN_ID, TEMPLATE_DIRECTORIES } from "./commands/game/init-templates.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "tileborne-game-init-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("game init scaffold", () => {
  it("writes the thin product-repo directory shape", async () => {
    const parent = await makeTempDir();
    const target = path.join(parent, "my-game");
    const result = await scaffoldGameProject({ directory: target });
    expect(result.directory).toBe(target);
    expect(result.name).toBe("my-game");
    expect(result.pluginId).toBe(DEFAULT_GAME_PLUGIN_ID);
    for (const dir of TEMPLATE_DIRECTORIES) {
      const info = await stat(path.join(target, dir));
      expect(info.isDirectory(), dir).toBe(true);
    }
    for (const file of [
      "package.json",
      "tileborne.config.json",
      "README.md",
      ".gitignore",
      "branding/tokens.json",
      "scripts/build.mjs",
      "scripts/deploy.mjs",
    ]) {
      expect(result.files).toContain(file);
      const info = await stat(path.join(target, ...file.split("/")));
      expect(info.isFile(), file).toBe(true);
    }
  });

  it("package.json consumes the CLI + plugin externally and wires real subcommands", async () => {
    const parent = await makeTempDir();
    const target = path.join(parent, "external-deps");
    await scaffoldGameProject({ directory: target, name: "petlike", pluginId: "@acme/my-mode" });
    const pkg = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as {
      readonly name: string;
      readonly private: boolean;
      readonly scripts: Record<string, string>;
      readonly devDependencies: Record<string, string>;
      readonly dependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe("petlike");
    expect(pkg.private).toBe(true);
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(["@tileborne/cli", "@acme/my-mode", "wrangler"]),
    );
    // No engine packages beyond the CLI + plugin.
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.scripts["build"]).toContain("scripts/build.mjs");
    expect(pkg.scripts["serve"]).toContain('tileborne game serve --dir "dist/game"');
    expect(pkg.scripts["deploy"]).toContain("scripts/deploy.mjs");
  });

  it("build script reads the project reference from tileborne.config.json and bakes its maps", async () => {
    const parent = await makeTempDir();
    const target = path.join(parent, "build-script");
    await scaffoldGameProject({ directory: target, name: "my-shipped-game" });
    const config = JSON.parse(
      await readFile(path.join(target, "tileborne.config.json"), "utf8"),
    ) as { readonly project: string; readonly maps: readonly string[] };
    // The scaffold name doubles as the default Tileborne project slug.
    expect(config.project).toBe("my-shipped-game");
    expect(config.maps).toEqual([]);
    const script = await readFile(path.join(target, "scripts", "build.mjs"), "utf8");
    expect(script).toContain("tileborne.config.json");
    expect(script).toContain('"game"');
    expect(script).toContain('"build"');
    expect(script).toContain(`"${DEFAULT_GAME_PLUGIN_ID}"`);
    expect(script).toContain('"cloudflare"');
    expect(script).toContain('"--project"');
    expect(script).toContain("config.project");
    expect(script).toContain('"--map"');
  });

  it("deploy script builds, verifies the signing-key secret, and runs wrangler", async () => {
    const parent = await makeTempDir();
    const target = path.join(parent, "deploy-script");
    await scaffoldGameProject({ directory: target });
    const script = await readFile(path.join(target, "scripts", "deploy.mjs"), "utf8");
    expect(script).toContain("build.mjs");
    expect(script).toContain("wrangler secret put HANDOFF_SIGNING_KEY");
    expect(script).toContain('["secret", "list"');
    expect(script).toContain("wrangler");
    expect(script).toContain("dist/game/wrangler.toml");
  });

  it("branding tokens decode against the neutral BrandConfig schema", async () => {
    const parent = await makeTempDir();
    const target = path.join(parent, "branded");
    await scaffoldGameProject({ directory: target, name: "Branded Game" });
    const raw = JSON.parse(await readFile(path.join(target, "branding", "tokens.json"), "utf8"));
    const decoded = decodeBrandConfig(raw);
    expect(decoded.title).toBe("Branded Game");
  });

  it("README documents the authored→build→deploy→play flow without engine code", async () => {
    const parent = await makeTempDir();
    const target = path.join(parent, "readme");
    await scaffoldGameProject({ directory: target });
    const readme = await readFile(path.join(target, "README.md"), "utf8");
    expect(readme).toContain("tileborne game build");
    expect(readme).toContain("tileborne game serve");
    expect(readme).toContain("wrangler deploy");
    expect(readme).toContain("thin consumer");
  });

  it("refuses to scaffold into a non-empty directory", async () => {
    const target = await makeTempDir();
    await writeFile(path.join(target, "existing.txt"), "x\n");
    await expect(scaffoldGameProject({ directory: target })).rejects.toMatchObject({
      _tag: "CliValidationError",
    });
  });
});

import { describe, expect, it } from "vitest";

import { expectCliJsonData, expectCliJsonError } from "./helpers/run-cli.js";
import { makeTempDir, registerE2eHomeHooks } from "./helpers/temp-home.js";

describe.sequential("CLI smoke chain e2e", () => {
  registerE2eHomeHooks();

  it("init --here → map generate → playtest completes without --project", async () => {
    const projectDir = makeTempDir("tileborne-cli-e2e-smoke-chain-");
    await expectCliJsonData(["project", "init", "demo", "--here"], { cwd: projectDir });
    const generated = await expectCliJsonData<{ readonly mapId: string }>(
      ["map", "generate", "hello", "--width", "8", "--height", "8"],
      { cwd: projectDir },
    );
    expect(generated.mapId).toMatch(/^map:/);
    const playtest = await expectCliJsonData<{
      readonly stats: { readonly ticks: number };
    }>(["playtest", generated.mapId, "--duration", "0.5"], { cwd: projectDir });
    expect(playtest.stats.ticks).toBeGreaterThan(0);
  });
});

describe.sequential("CLI JSON error shape e2e", () => {
  registerE2eHomeHooks();

  it("project init without slug returns USAGE JSON error", async () => {
    await expectCliJsonError(["project", "init"], { exitCode: 64, code: "USAGE" });
  });

  it("map validate tampered file returns DATAERR JSON error", async () => {
    const { writeBrokenMapFixture } = await import("./helpers/fixtures.js");
    const brokenDir = await writeBrokenMapFixture();
    await expectCliJsonError(
      ["map", "validate", "--file", `${brokenDir}/broken.json`],
      { exitCode: 65, code: "DATAERR" },
    );
  });

  it("asset import missing path returns NOINPUT JSON error", async () => {
    await expectCliJsonError(
      ["asset", "import", "/nonexistent-tileborne-e2e-asset-path"],
      { exitCode: 66, code: "NOINPUT" },
    );
  });

  it("plugin verify tampered install returns DATAERR JSON error", async () => {
    const path = await import("node:path");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { writeFile } = await import("node:fs/promises");
    const { writePluginSource } = await import("./helpers/fixtures.js");
    const { tileborneHome } = await import("./helpers/temp-home.js");
    const source = await mkdtemp(path.join(tmpdir(), "tileborne-cli-e2e-plugin-verify-json-"));
    const pluginId = "@tileborne-plugins/e2e-verify-json";
    await writePluginSource(source, pluginId);
    await expectCliJsonData(["plugin", "install", "--local", source]);
    const installedDir = path.join(tileborneHome(), "plugins", `${encodeURIComponent(pluginId)}-0.1.0`);
    await writeFile(path.join(installedDir, "README.md"), "tampered\n");
    await expectCliJsonError(["plugin", "verify", pluginId], { exitCode: 65, code: "DATAERR" });
  });
});

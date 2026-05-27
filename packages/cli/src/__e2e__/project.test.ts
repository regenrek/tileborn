import { describe, expect, it } from "vitest";

import { expectCliJsonData, runCli } from "./helpers/run-cli.js";
import { makeTempDir, registerE2eHomeHooks } from "./helpers/temp-home.js";

describe.sequential("project e2e", () => {
  registerE2eHomeHooks();

  it("project init demo --here --json creates manifest with exit 0", async () => {
    const projectDir = makeTempDir("tileborne-cli-e2e-project-");
    const data = await expectCliJsonData<{ readonly path: string; readonly manifest: { readonly name: string } }>(
      ["project", "init", "demo", "--here"],
      { cwd: projectDir },
    );
    expect(data.manifest.name).toBe("demo");
    expect(data.path).toBe(projectDir);
  });

  it("project info --json returns slug and uuid after init", async () => {
    const projectDir = makeTempDir("tileborne-cli-e2e-project-info-");
    const init = await expectCliJsonData<{ readonly manifest: { readonly id: string; readonly name: string } }>(
      ["project", "init", "demo-info", "--here"],
      { cwd: projectDir },
    );
    const info = await expectCliJsonData<{ readonly manifest: { readonly id: string; readonly name: string } }>(
      ["project", "info"],
      { cwd: projectDir },
    );
    expect(info.manifest.name).toBe(init.manifest.name);
    expect(info.manifest.id).toBe(init.manifest.id);
    expect(info.manifest.id).toMatch(/^project:/);
  });

  it("project upgrade --json is idempotent on a fresh project", async () => {
    const projectDir = makeTempDir("tileborne-cli-e2e-project-upgrade-");
    await expectCliJsonData(["project", "init", "demo-upgrade", "--here"], { cwd: projectDir });
    const upgrade = await expectCliJsonData<{ readonly changed: boolean; readonly fromVersion: number }>(
      ["project", "upgrade"],
      { cwd: projectDir },
    );
    expect(upgrade.changed).toBe(false);
    expect(upgrade.fromVersion).toBeGreaterThanOrEqual(1);
  });
});

describe.sequential("project e2e negative", () => {
  registerE2eHomeHooks();

  it("project init without slug exits 64", async () => {
    const result = await runCli(["project", "init"]);
    expect(result.code).toBe(64);
  });
});

import { stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { initHomeProject } from "./helpers/fixtures.js";
import { expectCliJsonData } from "./helpers/run-cli.js";
import { registerE2eHomeHooks, tileborneHome } from "./helpers/temp-home.js";

describe.sequential("support e2e", () => {
  registerE2eHomeHooks();

  it("support bundle writes a non-empty archive", async () => {
    await initHomeProject("support-proj");
    const out = "support.tar.gz";
    const data = await expectCliJsonData<{ readonly archivePath: string }>(["support", "bundle", "--out", out]);
    expect(data.archivePath).toBe(out);
    const info = await stat(`${tileborneHome()}/${out}`);
    expect(info.size).toBeGreaterThan(0);
  });
});

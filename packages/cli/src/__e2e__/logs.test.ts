import path from "node:path";

import { describe, expect, it } from "vitest";

import { expectCliJsonData, runCli } from "./helpers/run-cli.js";
import { registerE2eHomeHooks } from "./helpers/temp-home.js";

describe.sequential("logs e2e", () => {
  registerE2eHomeHooks();

  it("logs path --json prints an existing log file after doctor", async () => {
    await runCli(["config", "set", "loggerLevel", "debug"], { json: true });
    const doctor = await runCli(["doctor"], { json: true });
    expect(doctor.code).toBe(0);
    const data = await expectCliJsonData<{ readonly path: string }>(["logs", "path"]);
    expect(path.isAbsolute(data.path)).toBe(true);
  });
});

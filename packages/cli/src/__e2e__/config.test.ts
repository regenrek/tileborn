import { describe, expect, it } from "vitest";

import { expectCliJsonData, runCli } from "./helpers/run-cli.js";
import { registerE2eHomeHooks } from "./helpers/temp-home.js";

describe.sequential("config e2e", () => {
  registerE2eHomeHooks();

  it("config set/get round-trips lastOpenedProject", async () => {
    const setResult = await runCli(["config", "set", "lastOpenedProject", "bar"], { json: true });
    expect(setResult.code).toBe(0);

    const got = await expectCliJsonData<{ readonly key: string; readonly value: { readonly _tag: string; readonly value: string } }>([
      "config",
      "get",
      "lastOpenedProject",
    ]);
    expect(got.key).toBe("lastOpenedProject");
    expect(got.value._tag).toBe("Some");
    expect(got.value.value).toBe("bar");
  });

  it("config list --json includes configured keys", async () => {
    await runCli(["config", "set", "lastOpenedProject", "bar"], { json: true });
    const list = await expectCliJsonData<{ readonly lastOpenedProject: { readonly _tag: string; readonly value: string } }>([
      "config",
      "list",
    ]);
    expect(list.lastOpenedProject._tag).toBe("Some");
    expect(list.lastOpenedProject.value).toBe("bar");
  });
});

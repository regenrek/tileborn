import { describe, expect, it } from "vitest";

import { expectCliJsonData } from "./helpers/run-cli.js";
import { registerE2eHomeHooks } from "./helpers/temp-home.js";

describe.sequential("runtime e2e", () => {
  registerE2eHomeHooks();

  it("runtime discover --json lists the TS backend", async () => {
    const data = await expectCliJsonData<{
      readonly backends: readonly { readonly impl: string; readonly available: boolean }[];
    }>(["runtime", "discover"]);
    expect(data.backends.some((backend) => backend.impl === "ts" && backend.available)).toBe(true);
  });
});

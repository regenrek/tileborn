import { describe, expect, it } from "vitest";

import { initHomeProject } from "./helpers/fixtures.js";
import { expectCliJsonData } from "./helpers/run-cli.js";
import { registerE2eHomeHooks } from "./helpers/temp-home.js";

describe.sequential("playtest e2e", () => {
  registerE2eHomeHooks();

  it("playtest exits 0 with tick stats", async () => {
    const { projectSlug } = await initHomeProject("play-proj");
    const generated = await expectCliJsonData<{ readonly mapId: string }>([
      "map",
      "generate",
      "play-map",
      "--width",
      "8",
      "--height",
      "8",
      "--project",
      projectSlug,
    ]);
    const data = await expectCliJsonData<{
      readonly stats: { readonly ticks: number; readonly hookSummary: Record<string, number> };
    }>(["playtest", generated.mapId, "--duration", "0.5", "--project", projectSlug]);
    expect(data.stats.ticks).toBeGreaterThan(0);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PlaytestArtifact } from "@tileborne/services-build";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHeadlessPlaytest } from "./playtest-headless.js";

/** A playtest artifact whose exported `map.json` predates ADR-0019: it carries a
 * legacy free-string `kind`. The headless run must decode it through the
 * canonical migration boundary instead of failing on the legacy shape. */
const legacyArtifactMapJson = {
  id: "map:5b1901ca-1abd-42d6-aeac-553b34b9bda6",
  schemaVersion: 1,
  size: { width: 4, height: 4 },
  tileSize: { width: 32, height: 32 },
  layers: [
    {
      kind: "object",
      id: "layer:00000000-0000-4000-8000-000000000004",
      name: "entities",
      visible: true,
      opacity: 1,
      objectIds: ["object:f08061c1-423d-4532-b972-0cb221b1a08a"],
    },
  ],
  objects: [
    {
      id: "object:f08061c1-423d-4532-b972-0cb221b1a08a",
      kind: "spawn-point",
      x: 352,
      y: 672,
      layerId: "layer:00000000-0000-4000-8000-000000000004",
      properties: {},
    },
  ],
  properties: {},
};

describe("runHeadlessPlaytest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tileborne-headless-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("decodes a legacy-`kind` artifact map cleanly and runs to completion", async () => {
    const mapPath = path.join(dir, "map.json");
    await writeFile(mapPath, JSON.stringify(legacyArtifactMapJson), "utf8");

    const artifact = {
      directory: dir,
      manifestPath: path.join(dir, "playtest.json"),
      indexPath: path.join(dir, "index.html"),
      mapPath,
      manifest: { plugins: [] },
    } as unknown as PlaytestArtifact;

    const result = await runHeadlessPlaytest(artifact, 0.2);

    expect(result.ticks).toBeGreaterThan(0);
  });
});

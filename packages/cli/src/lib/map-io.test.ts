import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { gameObjectTypeIdForKey } from "@tileborne/core";
import { Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readMapFile } from "./map-io.js";

/** A persisted map written before ADR-0019: free-string `kind` and omitted
 * `OptionFromUndefinedOr` object keys. It must load through the canonical
 * migration boundary without the caller doing anything special. */
const legacyMapJson = {
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

describe("readMapFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tileborne-map-io-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("decodes a legacy-`kind` map cleanly through the migration boundary", async () => {
    const filePath = path.join(dir, "legacy.json");
    await writeFile(filePath, JSON.stringify(legacyMapJson), "utf8");

    const map = await readMapFile(filePath);

    expect(map.objects[0]?.kind).toBe(gameObjectTypeIdForKey("spawn-point"));
    expect(Option.isNone(map.objects[0]!.width)).toBe(true);
  });
});

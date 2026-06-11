import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { gameObjectTypeIdForKey } from "../catalog/well-known.js";
import { TileborneMap } from "./index.js";
import {
  LegacyMapObjectKindError,
  migrateLegacyMapJson,
  migrateLegacyMapObjectKind,
} from "./migrate.js";

describe("migrateLegacyMapObjectKind", () => {
  it("maps a legacy slug to the same id as gameObjectTypeIdForKey", () => {
    expect(migrateLegacyMapObjectKind("placeable")).toBe(gameObjectTypeIdForKey("placeable"));
    expect(migrateLegacyMapObjectKind("spawn-point")).toBe(gameObjectTypeIdForKey("spawn-point"));
    expect(migrateLegacyMapObjectKind("object")).toBe(gameObjectTypeIdForKey("object"));
  });

  it("passes through an already-migrated gobj id (idempotent)", () => {
    const id = gameObjectTypeIdForKey("loot-crate");
    expect(migrateLegacyMapObjectKind(id)).toBe(id);
  });

  it("throws loudly on an unmappable kind", () => {
    expect(() => migrateLegacyMapObjectKind("")).toThrow(LegacyMapObjectKindError);
    expect(() => migrateLegacyMapObjectKind("asset:not-a-kind")).toThrow(LegacyMapObjectKindError);
  });
});

describe("migrateLegacyMapJson", () => {
  const legacyMap = {
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

  it("rewrites legacy object kinds and decodes cleanly", () => {
    const migrated = migrateLegacyMapJson(legacyMap) as typeof legacyMap;
    expect(migrated.objects[0]?.kind).toBe(gameObjectTypeIdForKey("spawn-point"));
    // The migrated JSON now decodes against the catalog-aware MapObject schema.
    const map = Schema.decodeUnknownSync(TileborneMap)(migrated);
    expect(map.objects[0]?.kind).toBe(gameObjectTypeIdForKey("spawn-point"));
  });

  it("is idempotent", () => {
    const once = migrateLegacyMapJson(legacyMap);
    const twice = migrateLegacyMapJson(once);
    expect(twice).toEqual(once);
  });
});

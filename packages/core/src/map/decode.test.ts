import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { gameObjectTypeIdForKey } from "../catalog/well-known.js";
import {
  decodePersistedTileborneMapJson,
  normalizeAndMigratePersistedMapJson,
} from "./decode.js";
import { LegacyMapObjectKindError } from "./migrate.js";

/** A persisted map written before the catalog: free-string `kind`, and the
 * `OptionFromUndefinedOr` object keys (`width`/`height`) omitted entirely. */
const legacyPersistedMap = {
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

describe("decodePersistedTileborneMapJson", () => {
  it("migrates a legacy `kind` and decodes a map that omits optional keys", () => {
    const map = decodePersistedTileborneMapJson(legacyPersistedMap);
    expect(map.objects[0]?.kind).toBe(gameObjectTypeIdForKey("spawn-point"));
    // Omitted width/height decode to Option.none rather than failing.
    expect(Option.isNone(map.objects[0]!.width)).toBe(true);
    expect(Option.isNone(map.objects[0]!.height)).toBe(true);
  });

  it("is idempotent on an already-migrated map (re-decode of a decoded map)", () => {
    const once = decodePersistedTileborneMapJson(legacyPersistedMap);
    const reEncoded = {
      ...legacyPersistedMap,
      objects: [{ ...legacyPersistedMap.objects[0], kind: once.objects[0]!.kind }],
    };
    const twice = decodePersistedTileborneMapJson(reEncoded);
    expect(twice.objects[0]?.kind).toBe(once.objects[0]?.kind);
  });

  it("throws loudly on an unmappable legacy kind", () => {
    const bad = {
      ...legacyPersistedMap,
      objects: [{ ...legacyPersistedMap.objects[0], kind: "asset:not-a-kind" }],
    };
    expect(() => decodePersistedTileborneMapJson(bad)).toThrow(LegacyMapObjectKindError);
  });

  it("normalizes a present placement's omitted Option keys before decode", () => {
    const withPlacement = {
      ...legacyPersistedMap,
      objects: [
        {
          ...legacyPersistedMap.objects[0],
          placement: {
            placeableId: "placeable:11111111-1111-4111-8111-111111111111",
            source: "manual",
          },
        },
      ],
    };
    const map = decodePersistedTileborneMapJson(withPlacement);
    const placement = map.objects[0]?.placement;
    expect(placement).toBeDefined();
    expect(Option.isNone(placement!.assetId)).toBe(true);
    expect(Option.isNone(placement!.packId)).toBe(true);
  });
});

describe("normalizeAndMigratePersistedMapJson", () => {
  it("returns non-map input unchanged", () => {
    expect(normalizeAndMigratePersistedMapJson(42)).toBe(42);
    expect(normalizeAndMigratePersistedMapJson({ not: "a map" })).toEqual({ not: "a map" });
  });

  it("migrates legacy kinds and fills omitted optional keys, returning plain JSON", () => {
    const result = normalizeAndMigratePersistedMapJson(legacyPersistedMap) as {
      objects: readonly { readonly kind: string; readonly width: unknown; readonly placement: unknown }[];
    };
    // Plain JSON (not a decoded class): width is a literal `undefined`, not Option.none.
    expect(result.objects[0]?.kind).toBe(gameObjectTypeIdForKey("spawn-point"));
    expect(result.objects[0]?.width).toBeUndefined();
    expect("placement" in (result.objects[0] as object)).toBe(true);
  });
});

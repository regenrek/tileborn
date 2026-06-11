import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { gameObjectTypeIdForKey } from "../catalog/well-known.js";
import { decodePersistedTileborneMapJson } from "./decode.js";
import { TileborneMap } from "./index.js";
import { LegacyMapObjectKindError } from "./migrate.js";

/** A persisted map written before the catalog: free-string `kind`, and the
 * optional object keys (`width`/`height`) omitted entirely. */
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

  it("decodes a present placement whose Option keys are omitted", () => {
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

describe("TileborneMap JSON round-trip (optional-key Option encoding)", () => {
  it("encodes none-Options as ABSENT keys and decodes after JSON.stringify/parse without normalization", () => {
    const map = decodePersistedTileborneMapJson({
      ...legacyPersistedMap,
      objects: [
        {
          ...legacyPersistedMap.objects[0],
          placement: {
            placeableId: "placeable:11111111-1111-4111-8111-111111111111",
            source: "manual",
            gid: 7,
          },
        },
      ],
    });

    const encoded = Schema.encodeSync(TileborneMap)(map);
    const encodedObject = (encoded as { objects: readonly Record<string, unknown>[] })
      .objects[0]!;
    // none-Options are encoded as absent keys, never present-undefined.
    expect("width" in encodedObject).toBe(false);
    expect("height" in encodedObject).toBe(false);
    const encodedPlacement = encodedObject.placement as Record<string, unknown>;
    expect("packId" in encodedPlacement).toBe(false);
    expect("assetId" in encodedPlacement).toBe(false);
    expect("tileId" in encodedPlacement).toBe(false);
    expect(encodedPlacement.gid).toBe(7);

    // The JSON wire round-trip is lossless and decodes with the STRICT schema
    // decode — no key backfill / normalization step in between.
    const wire: unknown = JSON.parse(JSON.stringify(encoded));
    const decoded = Schema.decodeUnknownSync(TileborneMap)(wire);
    expect(Option.isNone(decoded.objects[0]!.width)).toBe(true);
    expect(Option.isNone(decoded.objects[0]!.placement!.packId)).toBe(true);
    expect(Option.getOrNull(decoded.objects[0]!.placement!.gid)).toBe(7);
    expect(decoded).toStrictEqual(map);
  });
});

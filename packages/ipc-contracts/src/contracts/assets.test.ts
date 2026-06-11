import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { hashJsonStable, makePackId } from "@tileborne/core";

import {
  AssetsCapabilityRefreshedEventPayload,
  AssetsDescribePackContract,
  AssetsContracts,
  AssetsGetPackContract,
  AssetsImportSpriteSheetContract,
  AssetsListPacksContract,
  AssetsRemovePackContract,
} from "../../dist/contracts/assets.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const packId = makePackId(UUID);

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

const capability = {
  packId,
  paintable: false,
  tilesetCount: 0,
  tileCount: 0,
  placeableCount: 0,
  autotileRuleCount: 0,
  terrainClassCount: 0,
  hasAnimations: false,
  hasCollisionMasks: false,
  source: "asset-only",
  diagnostics: [
    {
      _tag: "PACK.no-tilesets",
      message: "Pack does not contain paintable tilesets.",
    },
  ],
} as const;

const pack = {
  id: packId,
  name: "Asset Only",
  version: "1.0.0",
  licenseSpdxId: "CC0-1.0",
  integrityHash: hashJsonStable({ id: packId }),
  assetCount: 1,
  capability,
};

describe("asset IPC contracts", () => {
  it("includes describePack in the built asset registry", () => {
    expect(AssetsContracts).toContain(AssetsDescribePackContract);
  });

  it("round-trips pack capability on list/get/describe responses", () => {
    roundTrip(AssetsListPacksContract.response, { packs: [pack] });
    roundTrip(AssetsGetPackContract.response, { pack });
    roundTrip(AssetsDescribePackContract.request, { packId });
    roundTrip(AssetsImportSpriteSheetContract.request, {
      imageBase64: "AA==",
      imageFileName: "hero.png",
      mime: "image/png",
      imageWidth: 288,
      imageHeight: 32,
      slice: { cellWidth: 32, cellHeight: 32, columns: 9, rows: 1 },
      spriteName: "Hero",
      anchor: "bottom-left",
      clips: [{ name: "idle", frameIndices: [0], loop: true, defaultDurationMs: 100 }],
      playerModel: {
        renderScale: 1.5,
        hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
        hand: { x: 0.75, y: 0.45 },
      },
    });
    roundTrip(AssetsRemovePackContract.request, { packId });
    roundTrip(AssetsRemovePackContract.response, {
      removedPackId: packId,
      invalidatedAssetLibraryCacheEntries: 2,
      prunedWorkingPaletteItemCount: 3,
      affectedProjectIds: ["project:550e8400-e29b-41d4-a716-446655440001"],
      affectedPaletteIds: ["working-palette:550e8400-e29b-41d4-a716-446655440002"],
    });
    roundTrip(AssetsDescribePackContract.response, {
      pack,
      capability,
      diagnostics: capability.diagnostics,
    });
  });

  it("round-trips capability refreshed event payloads", () => {
    roundTrip(AssetsCapabilityRefreshedEventPayload, { packId, capability });
  });
});

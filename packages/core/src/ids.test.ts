import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  AssetId,
  BuildId,
  LayerId,
  MapId,
  ObjectId,
  PackId,
  PlaceableId,
  TileId,
  TileSetId,
  RuntimeId,
  isPrefixedId,
  makeAssetId,
  parsePluginId,
  parsePrefixedId,
  ProjectId,
} from "./ids.js";

const SAMPLE_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("ids", () => {
  it("accepts valid prefixed ids", () => {
    const assetId = makeAssetId(SAMPLE_UUID);
    expect(assetId).toBe(`asset:${SAMPLE_UUID}`);
    expect(isPrefixedId(AssetId, assetId)).toBe(true);
  });

  it("rejects invalid prefixes and uuid shapes", () => {
    expect(Result.isFailure(parsePrefixedId(AssetId, "tile:550e8400-e29b-41d4-a716-446655440000"))).toBe(
      true,
    );
    expect(Result.isFailure(parsePrefixedId(AssetId, "asset:not-a-uuid"))).toBe(true);
    expect(Result.isFailure(parsePrefixedId(AssetId, 42))).toBe(true);
  });

  it("parses every branded prefixed id schema", () => {
    const cases = [
      [AssetId, `asset:${SAMPLE_UUID}`],
      [TileId, `tile:${SAMPLE_UUID}`],
      [ProjectId, `project:${SAMPLE_UUID}`],
      [MapId, `map:${SAMPLE_UUID}`],
      [LayerId, `layer:${SAMPLE_UUID}`],
      [ObjectId, `object:${SAMPLE_UUID}`],
      [PlaceableId, `placeable:${SAMPLE_UUID}`],
      [TileSetId, `tileset:${SAMPLE_UUID}`],
      [RuntimeId, `runtime:${SAMPLE_UUID}`],
      [BuildId, `build:${SAMPLE_UUID}`],
      [PackId, `pack:${SAMPLE_UUID}`],
    ] as const;

    for (const [schema, value] of cases) {
      expect(Result.isSuccess(parsePrefixedId(schema as typeof AssetId, value))).toBe(true);
    }
  });

  it("validates scoped plugin ids", () => {
    expect(Result.isSuccess(parsePluginId("@tileborne-plugins/battle-royale"))).toBe(true);
    expect(Result.isFailure(parsePluginId("battle-royale"))).toBe(true);
  });
});

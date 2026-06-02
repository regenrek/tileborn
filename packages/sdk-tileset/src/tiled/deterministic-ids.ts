import {
  hashBytes,
  makeAssetId,
  makeClipId,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makePackId,
  makePlaceableId,
  makeTileId,
  type AssetId,
  type ClipId,
  type LayerId,
  type MapId,
  type ObjectId,
  type PackId,
  type PlaceableId,
  type TileId,
  type Uuid,
} from "@tileborne/core";
import { Schema } from "effect";

import {
  AnimationId,
  AutotileRuleId,
  TilesetId,
  VariantFilterId,
} from "../schemas/ids.js";

const encoder = new TextEncoder();

export const uuidFromSeed = (seed: string): Uuid => {
  const hex = hashBytes(encoder.encode(seed)).slice("sha256:".length);
  const variant = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}` as Uuid;
};

export const deterministicPackId = (seed: string): PackId => makePackId(uuidFromSeed(seed));
export const deterministicAssetId = (seed: string): AssetId => makeAssetId(uuidFromSeed(seed));
export const deterministicTileId = (seed: string): TileId => makeTileId(uuidFromSeed(seed));
export const deterministicPlaceableId = (seed: string): PlaceableId => makePlaceableId(uuidFromSeed(seed));
export const deterministicClipId = (seed: string): ClipId => makeClipId(uuidFromSeed(seed));
export const deterministicMapId = (seed: string): MapId => makeMapId(uuidFromSeed(seed));
export const deterministicLayerId = (seed: string): LayerId => makeLayerId(uuidFromSeed(seed));
export const deterministicObjectId = (seed: string): ObjectId => makeObjectId(uuidFromSeed(seed));

export const deterministicTilesetId = (seed: string): typeof TilesetId.Type =>
  Schema.decodeUnknownSync(TilesetId)(`tileset:${uuidFromSeed(seed)}`);

export const deterministicAutotileRuleId = (seed: string): typeof AutotileRuleId.Type =>
  Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuidFromSeed(seed)}`);

export const deterministicVariantFilterId = (seed: string): typeof VariantFilterId.Type =>
  Schema.decodeUnknownSync(VariantFilterId)(`variant-filter:${uuidFromSeed(seed)}`);

export const deterministicAnimationId = (seed: string): typeof AnimationId.Type =>
  Schema.decodeUnknownSync(AnimationId)(`animation:${uuidFromSeed(seed)}`);

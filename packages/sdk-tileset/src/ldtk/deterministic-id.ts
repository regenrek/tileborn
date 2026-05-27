import { hashBytes, makeAssetId, makePackId, makeTileId, type AssetId, type PackId, type TileId, type Uuid } from "@tileborne/core";
import { Schema } from "effect";

import { AutotileRuleId, TilesetId } from "../schemas/ids.js";

const encoder = new TextEncoder();

const uuidFromSeed = (seed: string): Uuid => {
  const hex = hashBytes(encoder.encode(seed)).slice("sha256:".length);
  const variant = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}` as Uuid;
};

export const ldtkAssetId = (projectPath: string, relPath: string): AssetId =>
  makeAssetId(uuidFromSeed(`${projectPath}::asset::${relPath}`));

export const ldtkTileId = (projectPath: string, tilesetUid: number, tileIndex: number): TileId =>
  makeTileId(uuidFromSeed(`${projectPath}::tile::${tilesetUid}::${tileIndex}`));

export const ldtkTilesetId = (projectPath: string, tilesetUid: number): TilesetId =>
  Schema.decodeUnknownSync(TilesetId)(`tileset:${uuidFromSeed(`${projectPath}::tileset::${tilesetUid}`)}`);

export const ldtkAutotileRuleId = (projectPath: string, layerUid: number, ruleUid: number): AutotileRuleId =>
  Schema.decodeUnknownSync(AutotileRuleId)(
    `autotile-rule:${uuidFromSeed(`${projectPath}::autotile-rule::${layerUid}::${ruleUid}`)}`,
  );

export const ldtkPackId = (projectPath: string, projectIid: string): PackId =>
  makePackId(uuidFromSeed(`${projectPath}::pack::${projectIid}`));

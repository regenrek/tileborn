import { Schema } from "effect";

import { TileId } from "./ids.js";

export const AssetSemanticRoleName = Schema.Literals([
  "floor",
  "wall",
  "water",
  "path",
  "decoration",
  "collision",
  "spawn-blocking",
] as const);
export type AssetSemanticRoleName = typeof AssetSemanticRoleName.Type;

export const AssetSemanticRoleSource = Schema.Literals([
  "tiled-metadata",
  "user",
] as const);
export type AssetSemanticRoleSource = typeof AssetSemanticRoleSource.Type;

export class AssetSemanticRole extends Schema.Class<AssetSemanticRole>("AssetSemanticRole")({
  role: AssetSemanticRoleName,
  tileId: TileId,
  source: AssetSemanticRoleSource,
  confidence: Schema.Number,
}) {}

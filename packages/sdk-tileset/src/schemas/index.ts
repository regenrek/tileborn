export {
  AnimationId,
  AutotileRuleId,
  ClipId,
  PackId,
  PlaceableId,
  TileId,
  TilesetId,
  VariantFilterId,
} from "./ids.js";
export type {
  AnimationId as AnimationIdType,
  AutotileRuleId as AutotileRuleIdType,
  ClipId as ClipIdType,
  PackId as PackIdType,
  PlaceableId as PlaceableIdType,
  TileId as TileIdType,
  TilesetId as TilesetIdType,
  VariantFilterId as VariantFilterIdType,
} from "./ids.js";

export { TerrainClass } from "./terrain-class.js";
export type { TerrainClass as TerrainClassType } from "./terrain-class.js";

export { UVRect } from "./uv-rect.js";

export {
  BitmaskCollisionMask,
  CollisionEdge,
  CollisionMask,
  PolygonCollisionMask,
} from "./collision-mask.js";
export type { CollisionMask as CollisionMaskType } from "./collision-mask.js";

export { Animation, AnimationFrame } from "./animation.js";

export { Tile } from "./tile.js";

export {
  Placeable,
  PlaceableFrameRef,
  PlaceablePlacementMode,
  PlaceableSize,
  SpriteClip,
  TiledPlaceableSource,
} from "./placeable.js";
export type { PlaceablePlacementMode as PlaceablePlacementModeType } from "./placeable.js";

export { VariantFilter } from "./variant-filter.js";

export {
  AutotileRule,
  AutotileRulePattern,
  Blob47AutotileRule,
  CustomAutotileRule,
  RpgmA2AutotileRule,
  RpgmA3AutotileRule,
  RpgmA4AutotileRule,
  Wang2CornerAutotileRule,
  Wang2EdgeAutotileRule,
  Wang4CornerAutotileRule,
} from "./autotile-rule.js";
export type { AutotileRule as AutotileRuleType, AutotileRulePattern as AutotileRulePatternType } from "./autotile-rule.js";

export { TerrainTransition } from "./terrain-transition.js";

export {
  AssetSemanticRole,
  AssetSemanticRoleName,
  AssetSemanticRoleSource,
} from "./semantic-role.js";
export type {
  AssetSemanticRoleName as AssetSemanticRoleNameType,
  AssetSemanticRoleSource as AssetSemanticRoleSourceType,
} from "./semantic-role.js";

export { CellSize, Tileset } from "./tileset.js";

export { TilesetPack, TilesetPackAsset, TilesetPackLicense } from "./tileset-pack.js";

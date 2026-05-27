export {
  collisionMaskFromManifest,
  compileCollisionFromLdtkIntGridValue,
  compileCollisionFromTiledObject,
  compileCollisionFromTiledObjectGroup,
  compileCollisionFromUnityMetaSprite,
  polygonEdgesFromPoints,
  rectangleEdges,
} from "./collision.js";
export { compileTileMetadata, namespaceCustomProperties, KNOWN_NAMESPACES } from "./metadata-compile.js";
export type { CompileTileMetadataInput } from "./metadata-compile.js";
export { validateCollisionMask } from "./validate.js";
export type {
  AxisAlignedBounds,
  CollisionCellSize,
  CompiledTileMetadata,
  LdtkIntGridCollisionValue,
  NamespacedProperties,
  PathfindingHint,
  SpawnAnchor,
  UnityMetaSprite,
} from "./types.js";

export { createRuntimeAdapter, BattleRoyaleConfig, resolveBattleRoyaleConfig } from "./runtime-adapter.js";
export type { BattleRoyaleConfigInput, ResolvedBattleRoyaleConfig } from "./battle-royale-config.js";
export { createSimulationRules, defaultPickupRadius } from "./simulation-rules.js";
export { validateMap } from "./validate-map.js";
export { generateMap } from "./generate-map.js";
export { exportArtifact } from "./export-artifact.js";
export {
  createInitialFrame,
  createBattleRoyaleProjector,
  createBattleRoyaleRenderManifest,
  decodeClientFrameView,
  decodeServerFrame,
  encodeClientInputFrame,
  encodeHeartbeatFrame,
  encodeServerFrame,
  mergeBattleRoyaleFrame,
  serverFrameToView,
  textureManifestForAtlas,
} from "./renderer/battle-royale-projector.js";
export {
  decodeHostClientFrame,
  decodeHostClientFrameView,
  encodeInvalidClientFrame,
  isHostWelcomeFrame,
} from "./host-protocol-bridge.js";
export {
  createBattleRoyaleBundledAssets,
  PLAYER_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
} from "./renderer/bundled-assets.js";
export type {
  BattleRoyaleProjectorConfig,
  ClientFrameView,
  ClientInputFrame,
  FramePlayerUpdateView,
  InitialFrameInput,
  InitialFramePlayerView,
  InputDirection,
  PlayerModelRenderData,
  ServerFrameView,
  ZoneView,
} from "./renderer/battle-royale-projector.js";
export type {
  RuntimeClientFrameDecodeResult,
  RuntimeClientFrameView,
  RuntimeClientInputFrame,
} from "./host-protocol-bridge.js";
export {
  BR_INPUT_MAP_CONTRIBUTION_ID,
  BR_INPUT_MAP_ID,
  battleRoyaleDefaultInputMap,
  buildBattleRoyaleInputMapData,
  resolveBattleRoyaleInputIntent,
} from "./input-map.js";
export type { BattleRoyaleAimContext, BattleRoyaleInputIntent } from "./input-map.js";
export { PLUGIN_ID } from "./constants.js";
export {
  DEFAULT_MAX_PLAYERS,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  ZONE,
} from "./constants.js";
export type { ExportedArtifact, GenerateMapOptions, ValidationResult } from "./types/artifact.js";
export type { RuntimePlugin, RuntimePluginHost } from "./types/runtime-plugin.js";

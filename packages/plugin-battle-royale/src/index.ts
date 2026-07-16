export { createRuntimeAdapter, BattleRoyaleConfig, resolveBattleRoyaleConfig } from "./runtime-adapter.js";
export type { BattleRoyaleConfigInput, ResolvedBattleRoyaleConfig } from "./battle-royale-config.js";
export {
  assessBattleRoyaleWeaponCompatibility,
  isBattleRoyaleWeaponCompatible,
} from "./weapon-compatibility.js";
export type {
  BattleRoyaleWeaponCompatibilityCandidate,
  BattleRoyaleWeaponCompatibilityCode,
  BattleRoyaleWeaponCompatibilityResult,
} from "./weapon-compatibility.js";
export {
  assertBattleRoyaleTeamTopology,
  resolveBattleRoyaleTeamTopology,
  selectBattleRoyaleSpawnTeamSlots,
} from "./team-topology.js";
export type {
  BattleRoyaleAuthoredSpawnTeam,
  BattleRoyaleMatchMode,
  BattleRoyaleTeamTopology,
  BattleRoyaleTeamTopologyIssue,
} from "./team-topology.js";
export { createSimulationRules, defaultPickupRadius } from "./simulation-rules.js";
export { validateMap } from "./validate-map.js";
export { generateMap } from "./generate-map.js";
export { createBattleRoyaleSampleMaps } from "./sample-maps.js";
export { buildBattleRoyaleRuntimeState } from "./runtime-state-from-package.js";
export {
  BattleRoyaleModeData,
  decodeBattleRoyaleModeData,
  exportBattleRoyaleModeData,
} from "./mode-data.js";
export {
  createInitialFrame,
  createBattleRoyaleProjector,
  createBattleRoyaleRenderManifest,
  decodeClientFrameView,
  decodeServerFrame,
  encodeClientInputFrame,
  encodeHeartbeatFrame,
  encodeSnapshotAckFrame,
  encodeServerFrame,
  mergeBattleRoyaleFrame,
  requiredBattleRoyaleRenderableAssetIds,
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
  IMPACT_BURST_TEXTURE_ASSET_ID,
  LOOT_CRATE_TEXTURE_ASSET_ID,
  PLAYER_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
  SCAN_PULSE_TEXTURE_ASSET_ID,
  SHADOW_TEXTURE_ASSET_ID,
  SHIELD_TEXTURE_ASSET_ID,
  TRAP_TEXTURE_ASSET_ID,
  UI_PIXEL_TEXTURE_ASSET_ID,
  WEAPON_RIFLE_TEXTURE_ASSET_ID,
} from "./renderer/bundled-assets.js";
export type {
  BattleRoyaleProjectorConfig,
  ClientFrameView,
  ClientInputFrame,
  FramePlayerUpdateView,
  InitialFrameInput,
  InitialFramePlayerView,
  InputDirection,
  PlayerModelClipRenderData,
  PlayerModelRenderData,
  ServerFrameView,
  SpriteVisualRenderData,
  ZoneView,
} from "./renderer/battle-royale-projector.js";
export type {
  RuntimeClientFrameDecodeResult,
  RuntimeClientFrameView,
  RuntimeClientInputFrame,
} from "./host-protocol-bridge.js";
export {
  BR_AUDIO_BUS_CONTRIBUTION_ID,
  BR_AUDIO_BUS_ID,
  BR_AUDIO_CUES,
  battleRoyaleAudioCueDefinitionForEvent,
  battleRoyaleAudioCueForEvent,
  battleRoyaleAudioCues,
  battleRoyaleSfxBus,
  buildBattleRoyaleAudioBusData,
} from "./audio.js";
export type {
  BattleRoyaleAudioContributionData,
  BattleRoyaleAudioCueId,
  BattleRoyaleAudioEvent,
} from "./audio.js";
export {
  BR_INPUT_MAP_CONTRIBUTION_ID,
  BR_INPUT_MAP_ID,
  battleRoyaleDefaultInputMap,
  buildBattleRoyaleInputMapData,
  resolveBattleRoyaleInputIntent,
} from "./input-map.js";
export type { BattleRoyaleAimContext, BattleRoyaleInputIntent } from "./input-map.js";
export {
  BR_HUD_LAYOUT_CONTRIBUTION_ID,
  BR_HUD_LAYOUT_ID,
  battleRoyaleDefaultHudLayout,
  buildBattleRoyaleHudLayoutData,
} from "./hud-layout.js";
export {
  BattleRoyaleWeaponVisualError,
  resolveBattleRoyaleWeaponVisuals,
} from "./weapon-visuals.js";
export type { BattleRoyaleWeaponVisualsResult } from "./weapon-visuals.js";
export { PLUGIN_ID } from "./constants.js";
export {
  applyBattleRoyaleStarterProject,
  BATTLE_ROYALE_STARTER_CONTENT_TEMPLATE_IDS,
  BATTLE_ROYALE_STARTER_TEMPLATE_ID,
  BATTLE_ROYALE_STARTER_VERSION,
  createBattleRoyaleStarterMap,
  readBattleRoyaleStarterMetadata,
} from "./starter.js";
export type { BattleRoyaleStarterMetadata } from "./starter.js";
export {
  BATTLE_ROYALE_CORE_PACK_ID,
  BATTLE_ROYALE_CORE_PACK_VERSION,
  DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
} from "./content-assets.js";
export {
  BARRIER_KIND,
  DEFAULT_MAX_PLAYERS,
  DECOY_KIND,
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  TRAP_KIND,
  ZONE,
} from "./constants.js";
export {
  BattleRoyaleArtifactSchema,
  assertBattleRoyaleArtifact,
  decodeBattleRoyaleArtifact,
  validateBattleRoyaleArtifact,
} from "./types/artifact.js";
export type { ExportedArtifact, GenerateMapOptions, ValidationResult } from "./types/artifact.js";
export type { RuntimePlugin, RuntimePluginHost } from "./types/runtime-plugin.js";

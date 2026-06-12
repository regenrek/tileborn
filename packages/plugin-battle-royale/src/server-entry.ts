export { validateMap } from "./validate-map.js";
export { buildBattleRoyaleRuntimeState } from "./runtime-state-from-package.js";
export {
  BattleRoyaleModeData,
  decodeBattleRoyaleModeData,
  exportBattleRoyaleModeData,
  // Generic host-facing name: the desktop main process discovers the active
  // mode's `RuntimeModeDataExporter` on the plugin's node entry by this name.
  exportBattleRoyaleModeData as exportModeData,
} from "./mode-data.js";
export { generateMap } from "./generate-map.js";
export {
  // Generic host-facing name: build hosts discover the active mode's
  // player-model roster on the plugin's node entry by this name (M5 S1),
  // exchanging WIRE JSON only.
  resolveBattleRoyalePlayerModelsWire as resolvePlayerModels,
} from "./player-models/roster.js";
export {
  createBattleRoyaleSnapshotEmitter,
  MAX_DELTA_SNAPSHOT_BYTES,
} from "./server/snapshot-emitter.js";
export type {
  BattleRoyaleSnapshotEmitter,
  SnapshotSeed,
} from "./server/snapshot-emitter.js";

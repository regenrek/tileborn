/**
 * Editor-facing map/object authoring contributions for the Battle Royale plugin.
 *
 * This subpath (`@tileborne/plugin-battle-royale/authoring`) owns the BR
 * authoring policy the desktop editor used to house: the object-kind palette
 * presentation, the per-map zone/max-player settings (read/apply/counts), and
 * the declarative settings FIELD form. The editor keeps only the generic
 * palette + settings-form rendering mechanisms, which reference these exports.
 *
 * Player-model concerns live in the sibling `./player-models` entry.
 */
export { BATTLE_ROYALE_AUTHORING_OBJECTS, BATTLE_ROYALE_PALETTE_ACTIONS } from "./palette.js";
export {
  applyBattleRoyaleAuthoringSettings,
  battleRoyaleObjectCounts,
  readBattleRoyaleAuthoringSettings,
  BATTLE_ROYALE_AUTHORING_SETTINGS_FORM,
  type BattleRoyaleAuthoringSettings,
} from "./map-settings.js";

/**
 * Editor-facing map/object authoring contributions for the Battle Royale plugin.
 *
 * This subpath (`@tileborne/plugin-battle-royale/authoring`) owns the BR
 * authoring policy the desktop editor used to house: the object-kind palette
 * presentation and the per-map zone/max-player settings (read/apply/counts).
 * The settings FIELD form is now manifest-discovered data (ADR-0023 section A:
 * the `EditorGameSettingsForm` declaration), so the
 * editor renders it generically; these exports own only the namespace-backed
 * read/apply translation + the migration from the legacy `battleRoyale` key.
 *
 * Player-model concerns live in the sibling `./player-models` entry.
 */
export { BATTLE_ROYALE_AUTHORING_OBJECTS, BATTLE_ROYALE_PALETTE_ACTIONS } from "./palette.js";
export {
  applyBattleRoyaleAuthoringSettings,
  battleRoyaleObjectCounts,
  readBattleRoyaleAuthoringSettings,
  readBattleRoyaleMapSettings,
  type BattleRoyaleAuthoringSettings,
} from "./map-settings.js";

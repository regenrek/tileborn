/** Pure BR authoring/runtime policies shared by editor readiness and runtime. */
export { readBattleRoyaleAuthoringSettings } from './authoring/map-settings.js';
export {
  assessBattleRoyaleWeaponCompatibility,
  isBattleRoyaleWeaponCompatible,
  type BattleRoyaleWeaponCompatibilityCandidate,
  type BattleRoyaleWeaponCompatibilityResult,
} from './weapon-compatibility.js';
export {
  assertBattleRoyaleTeamTopology,
  resolveBattleRoyaleTeamTopology,
  selectBattleRoyaleSpawnTeamSlots,
  type BattleRoyaleAuthoredSpawnTeam,
  type BattleRoyaleMatchMode,
  type BattleRoyaleTeamTopology,
  type BattleRoyaleTeamTopologyIssue,
} from './team-topology.js';

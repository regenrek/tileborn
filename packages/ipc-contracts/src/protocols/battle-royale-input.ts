import { Schema } from 'effect';

/** Eight-way movement input: 0 = east, increasing clockwise. */
export const Direction8 = Schema.Literals([0, 1, 2, 3, 4, 5, 6, 7] as const);
export type Direction8 = typeof Direction8.Type;

export const BattleRoyaleAbility = {
  dash: 'dash',
  shieldBurst: 'shield-burst',
  scanPulse: 'scan-pulse',
  trap: 'trap',
  decoy: 'decoy',
} as const;

export const BATTLE_ROYALE_ABILITY_IDS = [
  BattleRoyaleAbility.dash,
  BattleRoyaleAbility.shieldBurst,
  BattleRoyaleAbility.scanPulse,
  BattleRoyaleAbility.trap,
  BattleRoyaleAbility.decoy,
] as const;

export const BattleRoyaleAbilityId = Schema.Literals(BATTLE_ROYALE_ABILITY_IDS);
export type BattleRoyaleAbilityId = typeof BattleRoyaleAbilityId.Type;

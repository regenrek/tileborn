import { PLUGIN_ID } from './constants.js';

export interface BattleRoyaleWeaponCompatibilityCandidate {
  readonly id: string;
  readonly label: string;
  readonly origin: 'plugin' | 'project';
  readonly sourcePluginId?: string;
  readonly deliveryTag: string;
}

export type BattleRoyaleWeaponCompatibilityCode =
  | 'compatible'
  | 'missing'
  | 'wrong-plugin'
  | 'unsupported-delivery';

export interface BattleRoyaleWeaponCompatibilityResult {
  readonly compatible: boolean;
  readonly code: BattleRoyaleWeaponCompatibilityCode;
  readonly message?: string;
}

/**
 * Canonical Battle Royale starting-weapon capability policy.
 *
 * Project weapons are intentionally mode-extensible, while immutable plugin
 * templates belong to the plugin that contributed them. BR currently executes
 * projectile delivery only. Renderer choices, readiness, and runtime resolution
 * all call this function so an offered weapon can never become a late runtime
 * rejection through a second policy path.
 */
export const assessBattleRoyaleWeaponCompatibility = (
  selectedWeaponId: string,
  candidate: BattleRoyaleWeaponCompatibilityCandidate | undefined,
): BattleRoyaleWeaponCompatibilityResult => {
  if (candidate === undefined) {
    return {
      compatible: false,
      code: 'missing',
      message: 'The selected starting weapon is unavailable. Choose another Battle Royale weapon.',
    };
  }
  if (candidate.origin === 'plugin' && candidate.sourcePluginId !== PLUGIN_ID) {
    return {
      compatible: false,
      code: 'wrong-plugin',
      message: `${candidate.label} belongs to another game mode and cannot be used by Battle Royale.`,
    };
  }
  if (candidate.deliveryTag !== 'ProjectileDelivery') {
    return {
      compatible: false,
      code: 'unsupported-delivery',
      message: `${candidate.label} uses ${candidate.deliveryTag}; Battle Royale requires a projectile weapon.`,
    };
  }
  return { compatible: true, code: 'compatible' };
};

export const isBattleRoyaleWeaponCompatible = (
  candidate: BattleRoyaleWeaponCompatibilityCandidate,
): boolean => assessBattleRoyaleWeaponCompatibility(candidate.id, candidate).compatible;

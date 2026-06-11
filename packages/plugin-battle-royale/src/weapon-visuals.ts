import {
  deriveWeaponVisuals,
  Result,
  type GameObjectType,
  type ResolvedWeaponVisuals,
} from "@tileborne/core";

import { BR_PRIMARY_WEAPON_ID } from "./constants.js";

export class BattleRoyaleWeaponVisualError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleRoyaleWeaponVisualError";
  }
}

export interface BattleRoyaleWeaponVisualsResult {
  /** weaponId -> derived render-ready visuals (equipped + companions). */
  readonly byWeaponId: ReadonlyMap<string, ResolvedWeaponVisuals>;
  readonly primary: ResolvedWeaponVisuals;
}

/**
 * Derive BR's per-weapon visuals from the MERGED game-object catalog
 * (ADR-0028 hard cut): every entity carrying a `weapon-ref` component yields
 * {@link ResolvedWeaponVisuals}. Fails when BR's primary weapon has no weapon
 * entity (the mode cannot render an equipped weapon at all); companion
 * derivation issues for the primary weapon also fail so broken content
 * surfaces at prepare time, not as silently missing effects.
 */
export const resolveBattleRoyaleWeaponVisuals = (
  objectTypes: readonly GameObjectType[],
): Result.Result<BattleRoyaleWeaponVisualsResult, BattleRoyaleWeaponVisualError> => {
  const { visuals, issues } = deriveWeaponVisuals(objectTypes);
  const byWeaponId = new Map<string, ResolvedWeaponVisuals>(
    visuals.map((visual) => [String(visual.weaponId), visual]),
  );
  const primary = byWeaponId.get(BR_PRIMARY_WEAPON_ID);
  if (primary === undefined) {
    return Result.fail(
      new BattleRoyaleWeaponVisualError(
        `no weapon entity claims BR's primary weapon ${BR_PRIMARY_WEAPON_ID}` +
          (issues.length > 0
            ? ` (derivation issues: ${issues.map((issue) => issue.message).join("; ")})`
            : ""),
      ),
    );
  }
  return Result.succeed({ byWeaponId, primary });
};

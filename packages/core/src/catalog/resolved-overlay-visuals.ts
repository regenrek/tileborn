import { Schema } from 'effect';

import { GameObjectTypeId } from '../ids.js';
import type { OverlayVisualComponent } from './components.js';
import type { GameObjectType } from './object-type.js';
import { ResolvedEntityVisual, resolveEntityVisual } from './resolved-weapon-visuals.js';

/**
 * The render-ready projection of ONE runtime-global overlay slot (shield,
 * shadow, hazard, …): the winning claimant entity's resolved `visual-ref`.
 * Derived from the merged catalog by {@link deriveOverlayVisuals} and baked
 * into the runtime artifact at export time — never authored directly.
 */
export class ResolvedOverlayVisual extends Schema.Class<ResolvedOverlayVisual>(
  'ResolvedOverlayVisual',
)({
  /** The overlay slot this visual fills (open tag named by the game mode). */
  slot: Schema.String,
  /** The catalog entity that won the slot (diagnostics / navigation). */
  sourceEntityId: GameObjectTypeId,
  visual: ResolvedEntityVisual,
}) {}

export interface OverlayVisualDerivationIssue {
  readonly objectTypeId: string;
  readonly path: string;
  readonly message: string;
}

export interface DeriveOverlayVisualsResult {
  readonly visuals: readonly ResolvedOverlayVisual[];
  readonly issues: readonly OverlayVisualDerivationIssue[];
}

export interface DeriveOverlayVisualsOptions {
  /**
   * Ids of PROJECT-authored object types (vs plugin-shipped). When a slot has
   * both a project and a plugin claimant, the project entity wins — that is
   * the user-override contract: duplicate the plugin's overlay entity into the
   * project, edit it, and the copy takes the slot. When omitted, all claimants
   * compete at equal precedence.
   */
  readonly projectTypeIds?: ReadonlySet<string>;
}

const overlayVisualOf = (objectType: GameObjectType): OverlayVisualComponent | undefined =>
  objectType.components.find(
    (component): component is OverlayVisualComponent => component._tag === 'overlay-visual',
  );

interface SlotClaimant {
  readonly objectType: GameObjectType;
  readonly fromProject: boolean;
}

/**
 * Pick the winning claimant for one slot: project precedence first, then the
 * lexicographically smallest entity id for determinism. Reports an issue when
 * several claimants compete at the winning precedence level.
 */
const pickSlotWinner = (
  slot: string,
  claimants: readonly SlotClaimant[],
  issues: OverlayVisualDerivationIssue[],
): GameObjectType => {
  const projectClaimants = claimants.filter((claimant) => claimant.fromProject);
  const pool = projectClaimants.length > 0 ? projectClaimants : claimants;
  const sorted = [...pool].sort((left, right) =>
    String(left.objectType.id).localeCompare(String(right.objectType.id)),
  );
  const winner = sorted[0]!.objectType;
  if (sorted.length > 1) {
    issues.push({
      objectTypeId: String(winner.id),
      path: 'overlay-visual.slot',
      message:
        `overlay slot "${slot}" is claimed by ${sorted.length} entities at equal precedence ` +
        `(${sorted.map((claimant) => String(claimant.objectType.id)).join(', ')}); ` +
        `${winner.id} wins deterministically`,
    });
  }
  return winner;
};

/**
 * Derive {@link ResolvedOverlayVisual}s for every overlay slot claimed by an
 * entity carrying an `overlay-visual` component. Pure and worker-safe; takes
 * the MERGED object-type list (plugin catalogs ⊕ project fragment). Slot
 * conflicts resolve by project-over-plugin precedence (see
 * {@link DeriveOverlayVisualsOptions.projectTypeIds}); render-incomplete
 * claimants are reported as issues, never thrown.
 */
export const deriveOverlayVisuals = (
  objectTypes: readonly GameObjectType[],
  options: DeriveOverlayVisualsOptions = {},
): DeriveOverlayVisualsResult => {
  const issues: OverlayVisualDerivationIssue[] = [];
  const claimantsBySlot = new Map<string, SlotClaimant[]>();

  for (const objectType of objectTypes) {
    const overlay = overlayVisualOf(objectType);
    if (overlay === undefined) {
      continue;
    }
    const slot = String(overlay.slot);
    const claimants = claimantsBySlot.get(slot) ?? [];
    claimants.push({
      objectType,
      fromProject: options.projectTypeIds?.has(String(objectType.id)) ?? false,
    });
    claimantsBySlot.set(slot, claimants);
  }

  const visuals: ResolvedOverlayVisual[] = [];
  for (const [slot, claimants] of [...claimantsBySlot.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const winner = pickSlotWinner(slot, claimants, issues);
    const resolved = resolveEntityVisual(winner);
    if (resolved.issue !== undefined) {
      issues.push({ ...resolved.issue, path: `overlay-visual -> ${resolved.issue.path}` });
    }
    if (resolved.visual === undefined) {
      continue;
    }
    visuals.push(
      new ResolvedOverlayVisual({
        slot,
        sourceEntityId: winner.id,
        visual: resolved.visual,
      }),
    );
  }

  return { visuals, issues };
};

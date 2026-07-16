import type { PlayerModelRef } from '@tileborne/core';

import { DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS } from '../content-assets.js';

/**
 * Canonical lightweight identity of a selectable Battle Royale player model.
 *
 * This is the single source of truth for "a player model the player can pick".
 * Both selection surfaces project onto it:
 *  - the editor authoring roster (rich {@link PlayerModelRef}, persisted to the
 *    project manifest) — see {@link toSelectableModel}
 *  - the shipped-client loadout (persisted to localStorage) — see `loadout.ts`
 *
 * Identity-only by construction (id + label only, no renderer/runtime policy).
 */
export type BattleRoyaleSelectableModel = Pick<PlayerModelRef, 'id' | 'label'>;

/** Project a full authored player-model ref down to its selectable identity. */
export const toSelectableModel = (ref: PlayerModelRef): BattleRoyaleSelectableModel => ({
  id: ref.id,
  label: ref.label,
});

/**
 * Shipped-client default roster. Used by the menu loadout when no authored
 * project roster is present; products override with their own models.
 */
export const DEFAULT_BATTLE_ROYALE_MODELS: readonly BattleRoyaleSelectableModel[] = [
  ...DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS.map(toSelectableModel),
];

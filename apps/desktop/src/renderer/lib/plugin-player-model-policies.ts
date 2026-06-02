import { BATTLE_ROYALE_PLAYER_MODEL_POLICY } from '@tileborne/plugin-battle-royale/player-models';
import type { PlayerModelPolicyContribution } from '@/lib/player-model-policy';

/**
 * App-composition registry of plugin-contributed player-model policies. This is
 * the single wiring point that knows which game-mode plugins declare a player
 * model policy; the generic editor/lobby/projector path only ever sees the
 * abstract {@link PlayerModelPolicyContribution} shape.
 *
 * Adding a new game-mode plugin (e.g. a fixed-model RPG) means appending its
 * policy here — no editor changes required.
 */
export const PLUGIN_PLAYER_MODEL_POLICIES: readonly PlayerModelPolicyContribution[] = [
  BATTLE_ROYALE_PLAYER_MODEL_POLICY,
];

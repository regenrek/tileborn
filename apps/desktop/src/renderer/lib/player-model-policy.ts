import type { PlayerModelRef, ProjectManifest, TileborneMap } from '@tileborne/core';

/**
 * Player-model policy resolution, mirroring the catalog-driven palette
 * projection precedent: a game-mode plugin DECLARES whether the
 * playable avatar is a single fixed model or a selectable set, and the generic
 * editor/shell RESOLVES the declared models for the active map. The resolver
 * keys purely on the abstract policy shape — no plugin-specific identity — so a
 * future RPG mode contributes a `mode: 'fixed'` policy and reuses the exact
 * same selection + lobby + projector flow.
 */
export type PlayerModelPolicyMode = 'fixed' | 'selectable';

export interface PlayerModelPolicyContext {
  /** The active map (some modes may scope models per-map). */
  readonly map: TileborneMap;
  /** The active project manifest; per-project rosters / fixed models live here. */
  readonly project?: ProjectManifest | undefined;
}

export interface PlayerModelPolicyContribution {
  readonly pluginId: string;
  readonly mode: PlayerModelPolicyMode;
  /**
   * Resolves the declared models for the given context. For `fixed` policies
   * this should return a single model; for `selectable` it returns the roster.
   */
  readonly resolveModels: (context: PlayerModelPolicyContext) => readonly PlayerModelRef[];
}

export interface ResolvedPlayerModelPolicy {
  readonly pluginId: string;
  readonly mode: PlayerModelPolicyMode;
  readonly models: readonly PlayerModelRef[];
}

/**
 * Resolves the player-model policy contributed by the first enabled plugin that
 * declares one. Pure: callers pass the enabled plugin ids, the registered
 * contributions, and the resolution context.
 */
export const resolvePlayerModelPolicy = (
  enabledPluginIds: Iterable<string>,
  contributions: readonly PlayerModelPolicyContribution[],
  context: PlayerModelPolicyContext,
): ResolvedPlayerModelPolicy | undefined => {
  const enabled = new Set(enabledPluginIds);
  const contribution = contributions.find((entry) => enabled.has(entry.pluginId));
  if (contribution === undefined) {
    return undefined;
  }
  return {
    pluginId: contribution.pluginId,
    mode: contribution.mode,
    models: contribution.resolveModels(context),
  };
};

/** Resolve a model by its selection id within a resolved policy. */
export const findPlayerModelById = (
  policy: ResolvedPlayerModelPolicy | undefined,
  modelId: string | undefined,
): PlayerModelRef | undefined => {
  if (policy === undefined) {
    return undefined;
  }
  if (modelId !== undefined) {
    const match = policy.models.find((model) => model.id === modelId);
    if (match !== undefined) {
      return match;
    }
  }
  return policy.models[0];
};

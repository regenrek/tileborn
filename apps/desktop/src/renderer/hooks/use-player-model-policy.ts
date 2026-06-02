import type { ProjectManifest, TileborneMap } from '@tileborne/core';
import { useMemo } from 'react';

import { usePluginsList } from '@/hooks/queries';
import { PLUGIN_PLAYER_MODEL_POLICIES } from '@/lib/plugin-player-model-policies';
import {
  resolvePlayerModelPolicy,
  type ResolvedPlayerModelPolicy,
} from '@/lib/player-model-policy';

/**
 * Resolves the active player-model policy contributed by the currently enabled
 * game-mode plugins for the given map/project. Returns `undefined` while
 * plugins load or when no enabled plugin declares a policy.
 */
export function usePlayerModelPolicy(
  map: TileborneMap | undefined,
  project: ProjectManifest | undefined,
): ResolvedPlayerModelPolicy | undefined {
  const pluginsQuery = usePluginsList();
  return useMemo(() => {
    if (map === undefined) {
      return undefined;
    }
    const enabledPluginIds = (pluginsQuery.data?.plugins ?? [])
      .filter((plugin) => plugin.enabled)
      .map((plugin) => plugin.id);
    return resolvePlayerModelPolicy(enabledPluginIds, PLUGIN_PLAYER_MODEL_POLICIES, {
      map,
      project,
    });
  }, [pluginsQuery.data?.plugins, map, project]);
}

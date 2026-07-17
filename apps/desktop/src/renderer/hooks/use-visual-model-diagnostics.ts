import { useMemo } from 'react';
import type { ProjectManifest } from '@tileborne/core';

import { useMap, usePluginsList, useProject } from '@/hooks/queries';
import { PLUGIN_PLAYER_MODEL_POLICIES } from '@/lib/plugin-player-model-policies';
import { resolvePlayerModelPolicy } from '@/lib/player-model-policy';
import {
  diagnoseVisualModelAuthoring,
  type VisualModelDiagnostic,
} from '@/lib/visual-model-diagnostics';

export function useVisualModelDiagnostics(
  projectId: string | undefined,
  mapId: string | undefined,
): readonly VisualModelDiagnostic[] {
  const projectQuery = useProject(projectId);
  const mapQuery = useMap(projectId, mapId);
  const pluginsQuery = usePluginsList();
  const project = projectQuery.data?.project as ProjectManifest | undefined;
  const map = mapQuery.data?.map;
  const enabledPluginIds = useMemo(
    () =>
      (pluginsQuery.data?.plugins ?? [])
        .filter((plugin) => plugin.enabled)
        .map((plugin) => plugin.id),
    [pluginsQuery.data?.plugins],
  );

  return useMemo(() => {
    if (
      projectId === undefined ||
      mapId === undefined ||
      map === undefined ||
      pluginsQuery.data === undefined
    ) {
      return [];
    }
    return diagnoseVisualModelAuthoring({
      playerModelPolicy: resolvePlayerModelPolicy(enabledPluginIds, PLUGIN_PLAYER_MODEL_POLICIES, {
        map,
        project,
      }),
    });
  }, [enabledPluginIds, map, mapId, pluginsQuery.data, project, projectId]);
}

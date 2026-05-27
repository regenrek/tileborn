import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { usePluginsList } from '@/hooks/queries';
import type { PluginManifestResponse } from '@/lib/bridge-types';
import { invokeIpc } from '@/lib/ipc';
import {
  collectPluginContributions,
  PLUGIN_SLOTS,
  type PluginContributionView,
} from '@/lib/plugin-slots';
import { queryKeys } from '@/lib/query-client';

export function usePluginCommandContributions(): readonly PluginContributionView[] {
  const pluginsQuery = usePluginsList();
  const enabledPlugins = useMemo(
    () => (pluginsQuery.data?.plugins ?? []).filter((plugin) => plugin.enabled),
    [pluginsQuery.data?.plugins],
  );

  const manifestQueries = useQueries({
    queries: enabledPlugins.map((plugin) => ({
      queryKey: queryKeys.plugins.manifest(plugin.id),
      queryFn: (): Promise<PluginManifestResponse> =>
        invokeIpc(() =>
          window.tileborne.plugins.getManifest({ pluginId: plugin.id }),
        ),
      enabled: enabledPlugins.length > 0,
    })),
  });

  return useMemo(() => {
    const manifests = [];
    for (const [index, query] of manifestQueries.entries()) {
      const plugin = enabledPlugins[index];
      if (plugin && query.data) {
        manifests.push({
          pluginId: plugin.id,
          pluginName: query.data.manifest.displayName ?? plugin.id,
          contributes: query.data.manifest.contributes,
        });
      }
    }

    return collectPluginContributions(manifests, PLUGIN_SLOTS.commandPalette);
  }, [enabledPlugins, manifestQueries]);
}

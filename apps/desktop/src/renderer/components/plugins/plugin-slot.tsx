import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { Card, CardContent, cn, typography } from '@tileborne/ui';

import { usePluginsList } from '@/hooks/queries';
import type { PluginManifestResponse } from '@/lib/bridge-types';
import { invokeIpc } from '@/lib/ipc';
import { collectPluginContributions, PLUGIN_SLOTS, type PluginSlotId } from '@/lib/plugin-slots';
import { queryKeys } from '@/lib/query-client';

interface PluginSlotProps {
  id: PluginSlotId;
  projectId?: string | undefined;
  mapId?: string | undefined;
  className?: string;
}

export function PluginSlot({ id, projectId, mapId, className }: PluginSlotProps) {
  const pluginsQuery = usePluginsList();
  const enabledPlugins = useMemo(
    () => (pluginsQuery.data?.plugins ?? []).filter((plugin) => plugin.enabled),
    [pluginsQuery.data?.plugins],
  );

  const manifestQueries = useQueries({
    queries: enabledPlugins.map((plugin) => ({
      queryKey: queryKeys.plugins.manifest(plugin.id),
      queryFn: (): Promise<PluginManifestResponse> =>
        invokeIpc(() => window.tileborne.plugins.getManifest({ pluginId: plugin.id })),
      enabled: enabledPlugins.length > 0,
    })),
  });

  const contributions = useMemo(() => {
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

    return collectPluginContributions(manifests, id);
  }, [enabledPlugins, id, manifestQueries]);

  void projectId;
  void mapId;

  if (id === PLUGIN_SLOTS.commandPalette) {
    return null;
  }

  if (pluginsQuery.isLoading || manifestQueries.some((query) => query.isLoading)) {
    return (
      <div className={className}>
        <p className={typography.bodyDense}>Loading plugin contributions…</p>
      </div>
    );
  }

  if (contributions.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2">
        {contributions.map((contribution) => (
          <Card
            key={`${contribution.pluginId}:${contribution.contributionId}`}
            className="gap-1 py-2.5"
          >
            <CardContent className="space-y-1 px-3 py-0">
              <p className={cn('break-words', typography.rowTitle)}>{contribution.label}</p>
              <p className={cn('break-words', typography.rowMeta)}>{contribution.pluginName}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

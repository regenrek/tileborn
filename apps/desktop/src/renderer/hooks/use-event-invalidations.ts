import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { AssetPacksListResponse } from '@/lib/bridge-types';
import { queryKeys } from '@/lib/query-client';

export const isMapsListQuery = (queryKey: readonly unknown[]): boolean =>
  queryKey[0] === queryKeys.maps.all[0] && queryKey[2] === 'list';

/** Wire IPC change events to TanStack Query invalidations (c-feiq trigger-only). */
export function useEventInvalidations() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribers = [
      window.tileborne.events.onProjectsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      }),
      window.tileborne.events.onMapsChanged(() => {
        void queryClient.invalidateQueries({
          predicate: (query) => isMapsListQuery(query.queryKey),
        });
      }),
      window.tileborne.events.onAssetsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.assets.all });
      }),
      window.tileborne.events.onAssetsCapabilityRefreshed((payload) => {
        // Merge updated capability into the cached listPacks response so the
        // sidebar/Generate-Map selectors react without a refetch. Falls back to
        // an invalidation if the cache is cold. See ADR-0021 §IPC contract.
        const queryKey = queryKeys.assets.list();
        const cached = queryClient.getQueryData<AssetPacksListResponse>(queryKey);
        if (cached !== undefined) {
          const next: AssetPacksListResponse = {
            ...cached,
            packs: cached.packs.map((pack) =>
              pack.id === payload.packId
                ? { ...pack, capability: payload.capability }
                : pack,
            ),
          };
          queryClient.setQueryData(queryKey, next);
        } else {
          void queryClient.invalidateQueries({ queryKey });
        }
      }),
      window.tileborne.events.onPluginsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      }),
      window.tileborne.events.onJobsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      }),
      window.tileborne.events.onBuildsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.builds.all });
      }),
      window.tileborne.events.onExportsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.exports.all });
      }),
      window.tileborne.events.onPlaytestChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.playtest.all });
      }),
      window.tileborne.events.onDeploymentsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.all });
      }),
      window.tileborne.events.onSupportChanged(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.support.all });
      }),
      window.tileborne.events.onLogsAppended(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.logs.all });
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [queryClient]);
}

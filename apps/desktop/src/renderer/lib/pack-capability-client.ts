import type { PackCapability } from '@tileborne/core';
import { useMemo } from 'react';

import { useAssetPacks } from '@/hooks/queries';

export type { PackCapability };

/**
 * Synchronous selectors over the `tileborne:assets:listPacks` IPC response,
 * which now carries `capability: PackCapability` per pack (ADR-0021 P2).
 *
 * The renderer no longer probes manifests itself; capability is computed by
 * `@tileborne/services-app` at import-finish / boot time and persisted in
 * `lock.json`. These selectors just re-shape the cached query data so
 * components can default palette/Generate-Map filtering against a typed map.
 */

export function usePackCapabilities(): {
  readonly byId: ReadonlyMap<string, PackCapability>;
  readonly isLoading: boolean;
} {
  const assetPacksQuery = useAssetPacks();
  const byId = useMemo(() => {
    const map = new Map<string, PackCapability>();
    const packs = assetPacksQuery.data?.packs;
    if (packs !== undefined) {
      for (const pack of packs) {
        map.set(pack.id, pack.capability);
      }
    }
    return map;
  }, [assetPacksQuery.data]);
  return { byId, isLoading: assetPacksQuery.isLoading };
}

export function pickPaintablePackId(
  installedPacks: readonly { readonly id: string }[],
  capabilities: ReadonlyMap<string, PackCapability>,
  preferredPackId: string | undefined,
): string | undefined {
  if (preferredPackId !== undefined && preferredPackId.length > 0) {
    const cap = capabilities.get(preferredPackId);
    if (cap?.paintable === true) {
      return preferredPackId;
    }
  }
  return installedPacks.find(
    (pack) => capabilities.get(pack.id)?.paintable === true,
  )?.id;
}

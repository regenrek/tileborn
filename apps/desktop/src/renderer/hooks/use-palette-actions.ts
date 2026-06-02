import { useMemo } from 'react';

import { usePluginsList } from '@/hooks/queries';
import { PLUGIN_PALETTE_CONTRIBUTIONS } from '@/lib/plugin-palette-contributions';
import { resolvePaletteActions, type PaletteActionItem } from '@/lib/palette-actions';

/**
 * Palette action items contributed by the currently enabled plugins. Returns
 * an empty list while plugins load or when none contribute, so the Working
 * Palette can omit the "Markers & Tools" group entirely.
 */
export function usePaletteActions(): readonly PaletteActionItem[] {
  const pluginsQuery = usePluginsList();
  return useMemo(() => {
    const enabledPluginIds = (pluginsQuery.data?.plugins ?? [])
      .filter((plugin) => plugin.enabled)
      .map((plugin) => plugin.id);
    return resolvePaletteActions(enabledPluginIds, PLUGIN_PALETTE_CONTRIBUTIONS);
  }, [pluginsQuery.data?.plugins]);
}

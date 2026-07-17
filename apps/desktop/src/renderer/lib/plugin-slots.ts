/** Plugin contribution slot identifiers used by the editor shell. */
export const PLUGIN_SLOTS = {
  sidebarLeft: 'editor.sidebar.left',
  inspectorRight: 'editor.inspector.right',
  commandPalette: 'editor.commandPalette',
  bottomDrawer: 'editor.bottomDrawer',
} as const;

export type PluginSlotId = (typeof PLUGIN_SLOTS)[keyof typeof PLUGIN_SLOTS];

/**
 * Maps shell slot ids to manifest contribution keys under `contributes.editor`.
 *
 * Each manifest contribution key must be owned by exactly ONE shell slot.
 * `panels` is owned by the left sidebar (it's authoring config like map-level
 * settings, not runtime state). The bottom drawer only hosts dedicated runtime
 * surfaces (`drawerPanels`) — never plain `panels`, which previously caused
 * Battle Royale Settings to render in both sidebar and drawer simultaneously.
 */
export const SLOT_CONTRIBUTION_KEYS: Record<PluginSlotId, readonly string[]> = {
  [PLUGIN_SLOTS.sidebarLeft]: ['tabs', 'panels'],
  [PLUGIN_SLOTS.inspectorRight]: ['inspectorPanels', 'inspectors'],
  [PLUGIN_SLOTS.commandPalette]: ['commands'],
  [PLUGIN_SLOTS.bottomDrawer]: ['drawerPanels'],
};

export interface PluginContributionView {
  pluginId: string;
  pluginName: string;
  contributionId: string;
  kind: 'declarative' | 'executable';
  label: string;
  slot: PluginSlotId;
  entry?: string;
  requiresMap: boolean;
}

function readDisplayLabel(display: unknown, fallback: string): string {
  if (
    typeof display === 'object' &&
    display !== null &&
    'label' in display &&
    typeof display.label === 'string'
  ) {
    return display.label;
  }
  return fallback;
}

function readRequiresMap(entry: Record<string, unknown>): boolean {
  if (
    'data' in entry &&
    typeof entry.data === 'object' &&
    entry.data !== null &&
    'action' in entry.data &&
    typeof entry.data.action === 'object' &&
    entry.data.action !== null &&
    'channel' in entry.data.action &&
    entry.data.action.channel === 'tileborne.maps.validate'
  ) {
    return true;
  }
  return 'entry' in entry && typeof entry.entry === 'string' && entry.entry.includes('validate');
}

function collectFromArray(
  entries: unknown,
  pluginId: string,
  pluginName: string,
  slot: PluginSlotId,
  output: PluginContributionView[],
) {
  if (!Array.isArray(entries)) {
    return;
  }
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const contributionId = String(record.id);
    const kind = record.kind === 'executable' ? 'executable' : 'declarative';
    output.push({
      pluginId,
      pluginName,
      contributionId,
      kind,
      label: readDisplayLabel('display' in record ? record.display : undefined, contributionId),
      slot,
      ...(typeof record.entry === 'string' ? { entry: record.entry } : {}),
      requiresMap: readRequiresMap(record),
    });
  }
}

export function collectPluginContributions(
  manifests: ReadonlyArray<{
    pluginId: string;
    pluginName: string;
    contributes: unknown;
  }>,
  slotId: PluginSlotId,
): PluginContributionView[] {
  const keys = SLOT_CONTRIBUTION_KEYS[slotId];
  const results: PluginContributionView[] = [];

  for (const manifest of manifests) {
    if (
      typeof manifest.contributes !== 'object' ||
      manifest.contributes === null ||
      !('editor' in manifest.contributes)
    ) {
      continue;
    }
    const editor = manifest.contributes.editor;
    if (typeof editor !== 'object' || editor === null) {
      continue;
    }
    for (const key of keys) {
      if (!(key in editor)) {
        continue;
      }
      collectFromArray(
        editor[key as keyof typeof editor],
        manifest.pluginId,
        manifest.pluginName,
        slotId,
        results,
      );
    }
  }

  return results;
}

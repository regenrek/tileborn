import type { ComponentType } from 'react';

import type { TileborneMap } from '@tileborne/core';

import { BATTLE_ROYALE_PLUGIN_ID } from '@/lib/playtest-plugin-bridge';

import { BattleRoyaleAuthoringPanel } from './battle-royale-authoring-panel';

/**
 * Props every mode authoring panel receives from the inspector. The inspector
 * mounts the ACTIVE mode's panel by discovery (ADR-0023 section B) — it no
 * longer hardcodes `<BattleRoyaleAuthoringPanel>` behind a `battleRoyaleEnabled`
 * literal-id check.
 */
export interface ModeAuthoringPanelProps {
  readonly projectId: string;
  readonly map: TileborneMap;
}

/**
 * Registry of built-in mode authoring panels keyed by plugin id. The editor is
 * declarative-only (ADR-0004), so a mode's authoring panel React component is
 * bundled and registered here (mirroring the playtest projector registry);
 * WHICH plugin owns the inspector is discovered from the manifest upstream
 * (`discoverGameModes` → `gameModes` IPC). Battle Royale is the first registered
 * panel; a new genre registers another entry — no inspector edit required.
 */
const MODE_AUTHORING_PANELS: ReadonlyMap<string, ComponentType<ModeAuthoringPanelProps>> = new Map([
  [BATTLE_ROYALE_PLUGIN_ID, BattleRoyaleAuthoringPanel],
]);

/** Resolve the authoring panel component for a discovered mode's plugin id. */
export const resolveModeAuthoringPanel = (
  pluginId: string,
): ComponentType<ModeAuthoringPanelProps> | undefined => MODE_AUTHORING_PANELS.get(pluginId);

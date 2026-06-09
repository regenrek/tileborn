// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const battleRoyalePluginId = ['@tileborne-plugins', 'battle-royale'].join('/');
const arenaPluginId = ['@tileborne-plugins', 'example-arena'].join('/');

const hoisted = vi.hoisted(() => ({
  projectSettings: { current: undefined as { readonly activeGameMode?: string } | undefined },
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project-1', mapId: 'map-1' }),
}));

vi.mock('@/hooks/queries', () => ({
  useProject: () => ({
    data: { project: { settings: hoisted.projectSettings.current } },
  }),
  useMap: () => ({
    isLoading: false,
    data: { map: { id: 'map-1', layers: [], objects: [], properties: {} } },
  }),
  // ADR-0023: the inspector mounts the active mode's authoring panel by
  // manifest discovery (the `gameModes` IPC projection), not a literal id check.
  usePluginContributions: () => ({
    data: {
      tools: [],
      gameModes: [
        {
          modeId: battleRoyalePluginId,
          pluginId: battleRoyalePluginId,
          label: 'Battle Royale Settings',
          runtimeSystemId: 'battle-royale-runtime',
          authoringSettingsPanelId: 'battle-royale-settings',
          gameSettingsFormId: 'battle-royale-settings-form',
          gameSettingsForm: {
            scope: 'map',
            invalidMessage: 'Battle Royale settings must be positive numbers.',
            fields: [
              {
                key: 'maxPlayers',
                label: 'Max players',
                min: 1,
                max: undefined,
                step: 1,
                default: 32,
              },
            ],
          },
          hasAuthoringPanel: true,
        },
        {
          modeId: arenaPluginId,
          pluginId: arenaPluginId,
          label: 'Example Arena',
          runtimeSystemId: 'arena-runtime',
          authoringSettingsPanelId: 'arena-settings',
          gameSettingsFormId: 'arena-settings-form',
          gameSettingsForm: {
            scope: 'map',
            invalidMessage: 'Arena settings must be valid numbers within range.',
            fields: [
              {
                key: 'arenaRadius',
                label: 'Arena radius',
                min: 4,
                max: 256,
                step: 1,
                default: 32,
              },
              {
                key: 'enemyCount',
                label: 'Enemy count',
                min: 0,
                max: 64,
                step: 1,
                default: 8,
              },
            ],
          },
          hasAuthoringPanel: true,
        },
      ],
      panels: [],
    },
  }),
}));

vi.mock('@/components/inspector/layers-section', () => ({
  LayersSection: () => <section data-testid="layers-section">Layers</section>,
}));

vi.mock('@/components/inspector/selection-summary', () => ({
  SelectionSummary: ({ selectionCount }: { readonly selectionCount: number }) => (
    <section data-testid="selection-summary">{selectionCount} selected</section>
  ),
}));

vi.mock('@/components/inspector/viewport-overlays-section', () => ({
  ViewportOverlaysSection: () => <section data-testid="viewport-overlays">Overlays</section>,
}));

vi.mock('@/components/plugins/battle-royale-authoring-panel', () => ({
  BattleRoyaleAuthoringPanel: () => (
    <section data-testid="battle-royale-authoring-panel">Battle Royale Settings</section>
  ),
}));

vi.mock('@/components/plugins/mode-authoring-panels', () => ({
  resolveModeAuthoringPanel: (pluginId: string) =>
    pluginId === battleRoyalePluginId
      ? () => <section data-testid="battle-royale-authoring-panel">Battle Royale Settings</section>
      : undefined,
}));

vi.mock('@/components/plugins/generic-mode-settings-panel', () => ({
  GenericModeSettingsPanel: ({ label }: { readonly label: string }) => (
    <section data-testid="generic-mode-settings-panel">{label}</section>
  ),
}));

vi.mock('@/components/plugins/plugin-slot', () => ({
  PluginSlot: () => <section data-testid="plugin-slot">Plugin slot</section>,
}));

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    inspectorCollapsed: false,
    setInspectorCollapsed: vi.fn(),
    selection: new Set(['object-1']),
    activeTool: 'tileBrush',
  };
  type State = typeof state;
  const useEditorUiStore = (selector: (value: State) => unknown) => selector(state);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, { getState: () => state }),
  };
});

import { RightInspector } from '@/components/shell/right-inspector';

describe('RightInspector', () => {
  afterEach(() => {
    hoisted.projectSettings.current = undefined;
    cleanup();
  });

  it('keeps Battle Royale authoring settings visible while an object is selected', () => {
    hoisted.projectSettings.current = { activeGameMode: battleRoyalePluginId };

    render(<RightInspector />);

    expect(screen.getByTestId('selection-summary').textContent).toContain('1 selected');
    expect(screen.getByTestId('battle-royale-authoring-panel')).toBeTruthy();
    expect(screen.getByText('Property editing for 1 selected object is coming soon.')).toBeTruthy();
  });

  it('mounts the selected non-default mode settings panel', () => {
    hoisted.projectSettings.current = { activeGameMode: arenaPluginId };

    render(<RightInspector />);

    expect(screen.queryByTestId('battle-royale-authoring-panel')).toBeNull();
    expect(screen.getByTestId('generic-mode-settings-panel').textContent).toBe('Example Arena');
  });
});

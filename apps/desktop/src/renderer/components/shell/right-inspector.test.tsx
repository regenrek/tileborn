// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const battleRoyalePluginId = ['@tileborne-plugins', 'battle-royale'].join('/');

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project-1', mapId: 'map-1' }),
}));

vi.mock('@/hooks/queries', () => ({
  useMap: () => ({
    isLoading: false,
    data: { map: { id: 'map-1', layers: [], objects: [], properties: {} } },
  }),
  // ADR-0023: the inspector mounts the active mode's authoring panel by
  // manifest discovery (the `gameModes` IPC projection), not a literal id check.
  usePluginContributions: () => ({
    data: {
      panels: [],
      tools: [],
      gameModes: [
        {
          modeId: battleRoyalePluginId,
          pluginId: battleRoyalePluginId,
          label: 'Battle Royale Settings',
          runtimeSystemId: 'battle-royale-runtime',
          authoringSettingsPanelId: 'battle-royale-settings',
          hasAuthoringPanel: true,
        },
      ],
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
    cleanup();
  });

  it('keeps Battle Royale authoring settings visible while an object is selected', () => {
    render(<RightInspector />);

    expect(screen.getByTestId('selection-summary').textContent).toContain('1 selected');
    expect(screen.getByTestId('battle-royale-authoring-panel')).toBeTruthy();
    expect(screen.getByText('Property editing for 1 selected object is coming soon.')).toBeTruthy();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import {
  normalizeWorkspaceTabs,
  useEditorUiStore,
  workspaceTabId,
  type WorkspaceTab,
} from './editor-ui-store';

describe('editor-ui-store workspace tabs', () => {
  beforeEach(() => {
    useEditorUiStore.setState({ openTabs: [] });
  });

  it('normalizes persisted tab ids and removes duplicate workspace tabs', () => {
    const tabs: WorkspaceTab[] = [
      { id: 'legacy-assets-id', kind: 'assets', projectId: 'project-1' },
      { id: 'assets:project-1', kind: 'assets', projectId: 'project-1' },
      { id: 'encoded-overview-id', kind: 'overview', projectId: 'project%3Aencoded' },
      { id: 'overview:project:encoded', kind: 'overview', projectId: 'project:encoded' },
      { id: 'broken-map', kind: 'map', projectId: 'project-1' },
      { id: 'legacy-settings-id', kind: 'settings' },
      { id: 'settings:global', kind: 'settings' },
    ];

    expect(normalizeWorkspaceTabs(tabs)).toEqual([
      { id: 'assets:project-1', kind: 'assets', projectId: 'project-1' },
      { id: 'overview:project:encoded', kind: 'overview', projectId: 'project:encoded' },
      { id: 'settings:global', kind: 'settings' },
    ]);
  });

  it('deduplicates existing tabs before ensuring the active route tab', () => {
    useEditorUiStore.setState({
      openTabs: [
        { id: 'legacy-overview-id', kind: 'overview', projectId: 'project-1' },
        { id: 'overview:project-1', kind: 'overview', projectId: 'project-1' },
      ],
    });

    useEditorUiStore.getState().ensureTab({
      id: workspaceTabId({ kind: 'overview', projectId: 'project-1' }),
      kind: 'overview',
      projectId: 'project-1',
    });

    expect(useEditorUiStore.getState().openTabs).toEqual([
      { id: 'overview:project-1', kind: 'overview', projectId: 'project-1' },
    ]);
  });
});

describe('editor-ui-store viewport overlays', () => {
  beforeEach(() => {
    useEditorUiStore.setState({ showGrid: true });
  });

  it('defaults the editor grid on and does not persist a disabled grid as the next startup default', () => {
    const partialize = useEditorUiStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();

    expect(useEditorUiStore.getState().showGrid).toBe(true);
    useEditorUiStore.getState().setShowGrid(false);

    expect(partialize?.(useEditorUiStore.getState())).not.toHaveProperty('showGrid');
  });
});

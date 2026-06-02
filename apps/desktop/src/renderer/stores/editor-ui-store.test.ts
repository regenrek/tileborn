import { beforeEach, describe, expect, it } from 'vitest';

import type { PlaceableIdType, TileIdType } from '@tileborne/sdk-tileset/schemas';

import {
  normalizeWorkspaceTabs,
  useEditorUiStore,
  workspaceTabId,
  type BrushIntent,
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

describe('editor-ui-store unified active brush', () => {
  const tileBrush: BrushIntent = {
    kind: 'tile',
    tileId: 'tile:00000000-0000-4000-8000-000000000001' as TileIdType,
  };
  const spawnBrush: BrushIntent = {
    kind: 'plugin-object',
    objectKind: 'spawn-point',
    label: 'Spawn point',
  };
  const lootBrush: BrushIntent = {
    kind: 'plugin-object',
    objectKind: 'loot-crate',
    label: 'Loot crate',
  };

  beforeEach(() => {
    useEditorUiStore.setState({ activeTool: 'tileBrush', brushIntent: tileBrush });
  });

  it('selecting a plugin-object brush becomes the single active brush and switches to objectPlace', () => {
    useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');

    const state = useEditorUiStore.getState();
    expect(state.activeTool).toBe('objectPlace');
    expect(state.brushIntent).toEqual(spawnBrush);
  });

  it('switching between plugin-object brushes replaces the active brush (no parallel state)', () => {
    useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');
    useEditorUiStore.getState().selectBrush(lootBrush, 'objectPlace');

    expect(useEditorUiStore.getState().brushIntent).toEqual(lootBrush);
  });

  it('selecting a tile/eraser brush deselects the active plugin-object brush', () => {
    useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');

    useEditorUiStore.getState().selectBrush(tileBrush, 'tileBrush');
    expect(useEditorUiStore.getState().brushIntent).toEqual(tileBrush);
    expect(useEditorUiStore.getState().activeTool).toBe('tileBrush');

    useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');
    useEditorUiStore.getState().selectBrush({ kind: 'eraser' }, 'eraser');
    expect(useEditorUiStore.getState().brushIntent).toEqual({ kind: 'eraser' });
    expect(useEditorUiStore.getState().activeTool).toBe('eraser');
  });

  it('plugin-object brush identity ignores the contributed label/icon', () => {
    useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');
    // A re-contribution with the same objectKind but a different label must not
    // be treated as a different active brush.
    useEditorUiStore
      .getState()
      .setBrushIntent({ kind: 'plugin-object', objectKind: 'spawn-point', label: 'Player start' });
    expect(useEditorUiStore.getState().brushIntent).toEqual(spawnBrush);
  });

  it('the active brush (including plugin-object) is never persisted', () => {
    const partialize = useEditorUiStore.persist.getOptions().partialize;
    useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');
    expect(partialize?.(useEditorUiStore.getState())).not.toHaveProperty('brushIntent');
  });

  describe('selectTool normalizes the active brush (SSOT: one highlight)', () => {
    const placeableBrush: BrushIntent = {
      kind: 'placeable',
      placeableId: 'placeable:00000000-0000-4000-8000-000000000002' as PlaceableIdType,
    };

    it('switching to select clears a plugin-object marker highlight', () => {
      useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');

      useEditorUiStore.getState().selectTool('select');

      const state = useEditorUiStore.getState();
      expect(state.activeTool).toBe('select');
      // No palette chip stays highlighted: the brush collapses to the inert eraser.
      expect(state.brushIntent).toEqual({ kind: 'eraser' });
    });

    it('switching to pan clears a plugin-object marker highlight', () => {
      useEditorUiStore.getState().selectBrush(lootBrush, 'objectPlace');

      useEditorUiStore.getState().selectTool('pan');

      const state = useEditorUiStore.getState();
      expect(state.activeTool).toBe('pan');
      expect(state.brushIntent).toEqual({ kind: 'eraser' });
    });

    it('switching to objectMove clears a placeable highlight', () => {
      useEditorUiStore.getState().selectBrush(placeableBrush, 'objectPlace');

      useEditorUiStore.getState().selectTool('objectMove');

      const state = useEditorUiStore.getState();
      expect(state.activeTool).toBe('objectMove');
      expect(state.brushIntent).toEqual({ kind: 'eraser' });
    });

    it('switching to the eraser tool maps the brush to the eraser intent', () => {
      useEditorUiStore.getState().selectBrush(tileBrush, 'tileBrush');

      useEditorUiStore.getState().selectTool('eraser');

      const state = useEditorUiStore.getState();
      expect(state.activeTool).toBe('eraser');
      expect(state.brushIntent).toEqual({ kind: 'eraser' });
    });

    it('keeps a tile brush when switching to a tool that consumes it', () => {
      useEditorUiStore.getState().selectBrush(tileBrush, 'tileBrush');

      useEditorUiStore.getState().selectTool('rectangleFill');

      const state = useEditorUiStore.getState();
      expect(state.activeTool).toBe('rectangleFill');
      expect(state.brushIntent).toEqual(tileBrush);
    });

    it('keeps a plugin-object marker when switching back to objectPlace', () => {
      useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');
      // Detour through a non-consuming tool would clear it...
      useEditorUiStore.getState().selectBrush(spawnBrush, 'objectPlace');

      useEditorUiStore.getState().selectTool('objectPlace');

      const state = useEditorUiStore.getState();
      expect(state.activeTool).toBe('objectPlace');
      expect(state.brushIntent).toEqual(spawnBrush);
    });
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

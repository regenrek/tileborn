import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';

describe('editor commands bridge', () => {
  beforeEach(() => {
    useEditorCommandsBridge.getState().clearCommands();
  });

  it('stores undo/redo handlers and stack availability', () => {
    const undo = vi.fn();
    const redo = vi.fn();

    useEditorCommandsBridge.getState().setCommands({
      projectId: 'project-1',
      mapId: 'map-1',
      undo,
      redo,
      flushPersist: vi.fn(),
      applyCommand: vi.fn(),
      canUndo: true,
      canRedo: false,
    });

    expect(useEditorCommandsBridge.getState().canUndo).toBe(true);
    expect(useEditorCommandsBridge.getState().canRedo).toBe(false);
    useEditorCommandsBridge.getState().undo?.();
    expect(undo).toHaveBeenCalledOnce();
  });

  it('clears handlers when the editor unmounts', () => {
    useEditorCommandsBridge.getState().setCommands({
      projectId: 'project-1',
      mapId: 'map-1',
      undo: vi.fn(),
      redo: vi.fn(),
      flushPersist: vi.fn(),
      applyCommand: vi.fn(),
      canUndo: true,
      canRedo: true,
    });

    useEditorCommandsBridge.getState().clearCommands();

    expect(useEditorCommandsBridge.getState().undo).toBeNull();
    expect(useEditorCommandsBridge.getState().flushPersist).toBeNull();
    expect(useEditorCommandsBridge.getState().canUndo).toBe(false);
  });

  it('flushes the requested map when multiple editors are mounted', async () => {
    const flushFirst = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const flushSecond = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    useEditorCommandsBridge.getState().setCommands({
      projectId: 'project-1',
      mapId: 'map-a',
      undo: vi.fn(),
      redo: vi.fn(),
      flushPersist: flushFirst,
      applyCommand: vi.fn(),
      canUndo: false,
      canRedo: false,
    });
    useEditorCommandsBridge.getState().setCommands({
      projectId: 'project-1',
      mapId: 'map-b',
      undo: vi.fn(),
      redo: vi.fn(),
      flushPersist: flushSecond,
      applyCommand: vi.fn(),
      canUndo: false,
      canRedo: false,
    });

    await useEditorCommandsBridge.getState().flushPersistFor('project-1', 'map-a');

    expect(flushFirst).toHaveBeenCalledOnce();
    expect(flushSecond).not.toHaveBeenCalled();
  });
});

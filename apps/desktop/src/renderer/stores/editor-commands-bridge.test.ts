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
});

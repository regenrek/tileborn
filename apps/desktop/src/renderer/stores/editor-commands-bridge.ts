import { create } from 'zustand';

import type { EditorCommand } from '@/editor/editor-commands';

interface EditorCommandsSnapshot {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly flushPersist: () => Promise<void>;
  readonly applyCommand: (command: EditorCommand) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface EditorCommandsBridgeState {
  readonly undo: (() => void) | null;
  readonly redo: (() => void) | null;
  readonly flushPersist: (() => Promise<void>) | null;
  readonly applyCommand: ((command: EditorCommand) => void) | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  setCommands: (commands: EditorCommandsSnapshot) => void;
  clearCommands: () => void;
}

export const useEditorCommandsBridge = create<EditorCommandsBridgeState>((set) => ({
  undo: null,
  redo: null,
  flushPersist: null,
  applyCommand: null,
  canUndo: false,
  canRedo: false,
  setCommands: (commands) =>
    set({
      undo: commands.undo,
      redo: commands.redo,
      flushPersist: commands.flushPersist,
      applyCommand: commands.applyCommand,
      canUndo: commands.canUndo,
      canRedo: commands.canRedo,
    }),
  clearCommands: () =>
    set({
      undo: null,
      redo: null,
      flushPersist: null,
      applyCommand: null,
      canUndo: false,
      canRedo: false,
    }),
}));

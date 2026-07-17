import { create } from 'zustand';

import type { EditorCommand } from '@/editor/editor-commands';

interface EditorCommandsSnapshot {
  readonly projectId: string;
  readonly mapId: string;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly flushPersist: () => Promise<void>;
  readonly applyCommand: (command: EditorCommand) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface EditorCommandsBridgeState {
  readonly currentKey: string | null;
  readonly commandEntries: ReadonlyMap<string, EditorCommandsSnapshot>;
  readonly undo: (() => void) | null;
  readonly redo: (() => void) | null;
  readonly flushPersist: (() => Promise<void>) | null;
  readonly applyCommand: ((command: EditorCommand) => void) | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  setCommands: (commands: EditorCommandsSnapshot) => void;
  clearCommands: (scope?: { readonly projectId: string; readonly mapId: string }) => void;
  flushPersistFor: (projectId: string, mapId: string) => Promise<void>;
}

const entryKey = (projectId: string, mapId: string): string => `${projectId}\u0000${mapId}`;

const emptyCurrent = {
  currentKey: null,
  undo: null,
  redo: null,
  flushPersist: null,
  applyCommand: null,
  canUndo: false,
  canRedo: false,
} satisfies Pick<
  EditorCommandsBridgeState,
  'currentKey' | 'undo' | 'redo' | 'flushPersist' | 'applyCommand' | 'canUndo' | 'canRedo'
>;

const currentFrom = (key: string, commands: EditorCommandsSnapshot) => ({
  currentKey: key,
  undo: commands.undo,
  redo: commands.redo,
  flushPersist: commands.flushPersist,
  applyCommand: commands.applyCommand,
  canUndo: commands.canUndo,
  canRedo: commands.canRedo,
});

export const useEditorCommandsBridge = create<EditorCommandsBridgeState>((set) => ({
  currentKey: null,
  commandEntries: new Map(),
  undo: null,
  redo: null,
  flushPersist: null,
  applyCommand: null,
  canUndo: false,
  canRedo: false,
  setCommands: (commands) =>
    set((state) => {
      const key = entryKey(commands.projectId, commands.mapId);
      const commandEntries = new Map(state.commandEntries);
      commandEntries.set(key, commands);
      return { commandEntries, ...currentFrom(key, commands) };
    }),
  clearCommands: (scope) =>
    set((state) => {
      const key = scope === undefined ? state.currentKey : entryKey(scope.projectId, scope.mapId);
      if (key === null) {
        return { commandEntries: new Map(), ...emptyCurrent };
      }
      const commandEntries = new Map(state.commandEntries);
      commandEntries.delete(key);
      if (state.currentKey !== key) {
        return { commandEntries };
      }
      const next = [...commandEntries.entries()].at(-1);
      return next === undefined
        ? { commandEntries, ...emptyCurrent }
        : { commandEntries, ...currentFrom(next[0], next[1]) };
    }),
  flushPersistFor: async (projectId, mapId) => {
    const entry = useEditorCommandsBridge.getState().commandEntries.get(entryKey(projectId, mapId));
    await entry?.flushPersist();
  },
}));

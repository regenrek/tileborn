import { create } from 'zustand';

import {
  PlaytestMultiplayerClient,
  type MultiplayerSessionState,
} from '@/lib/playtest-multiplayer-client';
import {
  createLocalMultiplayerRoom,
  parsePlaytestRoomInput,
  startPlaytestJoinSession,
  type LocalMultiplayerRoomReady,
} from '@/lib/playtest-room-url';
import { readLobbyModelSelection } from '@/lib/lobby-model-selection';
import { notifyError, notifyInfo, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorCommandsBridge } from '@/stores/editor-commands-bridge';
import { useEditorUiStore, type LocalHostSession } from '@/stores/editor-ui-store';

export type PlaytestMultiplayerFlowPhase =
  | 'idle'
  | 'starting-host'
  | 'host-ready'
  | 'joining'
  | 'live'
  | 'error';

interface PlaytestMultiplayerStoreState {
  flowPhase: PlaytestMultiplayerFlowPhase;
  roomReady: LocalMultiplayerRoomReady | null;
  sessionState: MultiplayerSessionState | null;
  welcomeSnapshot: unknown;
  client: PlaytestMultiplayerClient | null;
}

interface PlaytestMultiplayerStoreActions {
  reset: () => void;
  hostLocalMatch: (projectId: string, mapId: string) => Promise<void>;
  joinFromInput: (
    input: string,
    mapId: string,
    mapWidth: number,
    mapHeight: number,
    fallbackBaseUrl?: string,
  ) => Promise<void>;
  joinHostAsPlayer: (mapId: string, mapWidth: number, mapHeight: number) => Promise<void>;
  openSecondClient: (projectId: string, mapId: string) => Promise<void>;
  stopHosting: () => Promise<void>;
  copyText: (label: string, value: string) => Promise<void>;
}

const initialState: PlaytestMultiplayerStoreState = {
  flowPhase: 'idle',
  roomReady: null,
  sessionState: null,
  welcomeSnapshot: null,
  client: null,
};

const ensureClient = (
  mapWidth: number,
  mapHeight: number,
  set: (
    partial:
      | Partial<PlaytestMultiplayerStoreState>
      | ((state: PlaytestMultiplayerStoreState) => Partial<PlaytestMultiplayerStoreState>),
  ) => void,
  get: () => PlaytestMultiplayerStoreState,
): PlaytestMultiplayerClient => {
  const existing = get().client;
  if (existing) {
    return existing;
  }
  const client = new PlaytestMultiplayerClient(
    mapWidth,
    mapHeight,
    (sessionState) => {
      set({ sessionState });
      if (sessionState.phase === 'live') {
        set({ flowPhase: 'live' });
        useEditorUiStore.getState().setPlaytestMode('multiplayer');
        useEditorUiStore.getState().setPlaytestActive(true);
      }
      if (sessionState.phase === 'error') {
        set({ flowPhase: 'error' });
      }
    },
    (welcomeSnapshot) => {
      set({ welcomeSnapshot, flowPhase: 'live' });
      useEditorUiStore.getState().setPlaytestMode('multiplayer');
      useEditorUiStore.getState().setPlaytestActive(true);
    },
  );
  set({ client });
  return client;
};

const connectToRoom = async (
  baseUrl: string,
  mapId: string,
  roomId: string,
  mapWidth: number,
  mapHeight: number,
  set: (
    partial:
      | Partial<PlaytestMultiplayerStoreState>
      | ((state: PlaytestMultiplayerStoreState) => Partial<PlaytestMultiplayerStoreState>),
  ) => void,
  get: () => PlaytestMultiplayerStoreState,
): Promise<void> => {
  set({ flowPhase: 'joining' });
  const joinSession = await startPlaytestJoinSession(baseUrl, mapId, roomId);
  const client = ensureClient(mapWidth, mapHeight, set, get);
  client.connect(joinSession.wsUrl, joinSession.playerId);
};

export const usePlaytestMultiplayerStore = create<
  PlaytestMultiplayerStoreState & PlaytestMultiplayerStoreActions
>()((set, get) => ({
  ...initialState,

  reset: () => {
    get().client?.disconnect();
    set(initialState);
    useEditorUiStore.getState().resetMultiplayerPlaytest();
  },

  hostLocalMatch: async (projectId, mapId) => {
    set({ flowPhase: 'starting-host' });
    useEditorUiStore.getState().setPlaytestHostModalOpen(true);
    try {
      await useEditorCommandsBridge.getState().flushPersist?.();
      const selectedPlayerModelId = readLobbyModelSelection(projectId);
      const prepared = await window.tileborne.runtime.prepareLocalRoomArtifact({
        projectId: projectId as never,
        mapId: mapId as never,
        ...(selectedPlayerModelId === undefined ? {} : { selectedPlayerModelId }),
      });
      const host = await window.tileborne.runtime.startLocalHost({});
      useEditorUiStore.getState().setLocalHostSession(host);
      const room = await createLocalMultiplayerRoom(host.baseUrl, mapId, {
        maxPlayers: 8,
        runtimeArtifact: prepared.runtimeArtifact,
      });
      const merged: LocalHostSession = { ...host, ...room };
      useEditorUiStore.getState().setLocalHostSession(merged);
      set({ roomReady: room, flowPhase: 'host-ready' });
      notifySuccess(`Room ${room.roomId} ready`);
    } catch (error) {
      set({ flowPhase: 'error', roomReady: null });
      await window.tileborne.runtime.stopLocalHost({}).catch(() => undefined);
      useEditorUiStore.getState().resetMultiplayerPlaytest();
      notifyError(error instanceof Error ? error.message : 'Failed to host local match');
      throw error;
    }
  },

  joinFromInput: async (input, mapId, mapWidth, mapHeight, fallbackBaseUrl) => {
    const parsed = parsePlaytestRoomInput(input, fallbackBaseUrl);
    if (!parsed) {
      notifyError('Enter a valid room URL or tileborne://playtest/<roomId> deep link');
      return;
    }
    useEditorUiStore.getState().setPlaytestJoinModalOpen(false);
    try {
      await connectToRoom(parsed.baseUrl, mapId, parsed.roomId, mapWidth, mapHeight, set, get);
    } catch (error) {
      set({ flowPhase: 'error' });
      notifyError(error instanceof Error ? error.message : 'Failed to join room');
      throw error;
    }
  },

  joinHostAsPlayer: async (mapId, mapWidth, mapHeight) => {
    const room = get().roomReady;
    if (!room) {
      return;
    }
    useEditorUiStore.getState().setPlaytestHostModalOpen(false);
    await connectToRoom(room.baseUrl, mapId, room.roomId, mapWidth, mapHeight, set, get);
  },

  openSecondClient: async (projectId, mapId) => {
    const room = get().roomReady;
    if (!room) {
      return;
    }
    await window.tileborne.system.openPlaytestJoinWindow({
      projectId: projectId as never,
      mapId: mapId as never,
      baseUrl: room.baseUrl,
      roomId: room.roomId,
    });
    notifySuccess('Opened second client window');
  },

  stopHosting: async () => {
    get().client?.disconnect();
    set({ ...initialState, client: null });
    try {
      await window.tileborne.runtime.stopLocalHost({});
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Failed to stop local host');
    }
    useEditorUiStore.getState().resetMultiplayerPlaytest();
    notifyInfo('Local hosting stopped');
  },

  copyText: async (label, value) => {
    try {
      await navigator.clipboard.writeText(value);
      notifySuccess(`${label} copied`);
    } catch {
      notifyError(`Failed to copy ${label.toLowerCase()}`);
    }
  },
}));

export const disposePlaytestMultiplayerSession = (): void => {
  usePlaytestMultiplayerStore.getState().client?.disconnect();
  usePlaytestMultiplayerStore.setState(initialState);
};

if (typeof window !== 'undefined') {
  window.__tileborne_e2e = {
    ...window.__tileborne_e2e,
    getMultiplayerSessionState: () => usePlaytestMultiplayerStore.getState().sessionState,
  };
}

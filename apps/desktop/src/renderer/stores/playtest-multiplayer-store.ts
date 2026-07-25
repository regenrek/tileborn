import { create } from 'zustand';
import type { RoomLobbySummary } from '@tileborne/game-client';

import {
  PlaytestMultiplayerClient,
  type MultiplayerSessionState,
} from '@/lib/playtest-multiplayer-client';
import { resolvePlaytestPlugin } from '@/lib/playtest-plugin-bridge';
import {
  createLocalMultiplayerRoom,
  getLocalMultiplayerLobby,
  getLocalMultiplayerResults,
  parsePlaytestRoomInput,
  setLocalMultiplayerReady,
  startPlaytestJoinSession,
  type LocalMultiplayerRoomReady,
  type LocalMultiplayerParticipantSession,
  type LocalMultiplayerRoomResults,
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
  | 'lobby'
  | 'countdown'
  | 'live'
  | 'finished'
  | 'error';

interface PlaytestMultiplayerStoreState {
  flowPhase: PlaytestMultiplayerFlowPhase;
  roomReady: LocalMultiplayerRoomReady | null;
  sessionState: MultiplayerSessionState | null;
  welcomeSnapshot: unknown;
  client: PlaytestMultiplayerClient | null;
  participantSession: LocalMultiplayerParticipantSession | null;
  lobbyState: RoomLobbySummary | null;
  roomResults: LocalMultiplayerRoomResults | null;
  isReadyPending: boolean;
  lobbyError: string | null;
}

interface PlaytestMultiplayerStoreActions {
  reset: () => void;
  hostLocalMatch: (projectId: string, mapId: string) => Promise<void>;
  joinFromInput: (
    input: string,
    rendererCapabilityId: string | undefined,
    mapId: string,
    mapWidth: number,
    mapHeight: number,
    fallbackBaseUrl?: string,
  ) => Promise<void>;
  joinHostAsPlayer: (
    rendererCapabilityId: string | undefined,
    mapId: string,
    mapWidth: number,
    mapHeight: number,
  ) => Promise<void>;
  openSecondClient: (projectId: string, mapId: string) => Promise<void>;
  setLocalReady: (ready: boolean) => Promise<void>;
  leaveSession: () => void;
  stopHosting: () => Promise<void>;
  copyText: (label: string, value: string) => Promise<void>;
}

const initialState: PlaytestMultiplayerStoreState = {
  flowPhase: 'idle',
  roomReady: null,
  sessionState: null,
  welcomeSnapshot: null,
  client: null,
  participantSession: null,
  lobbyState: null,
  roomResults: null,
  isReadyPending: false,
  lobbyError: null,
};

type StoreSet = (
  partial:
    | Partial<PlaytestMultiplayerStoreState>
    | ((state: PlaytestMultiplayerStoreState) => Partial<PlaytestMultiplayerStoreState>),
) => void;

const LOBBY_POLL_INTERVAL_MS = 250;
let lobbyPollTimer: ReturnType<typeof setTimeout> | null = null;
let lobbyPollAbort: AbortController | null = null;
let lobbyPollGeneration = 0;

const stopLobbyPolling = (): void => {
  lobbyPollGeneration += 1;
  if (lobbyPollTimer !== null) {
    clearTimeout(lobbyPollTimer);
    lobbyPollTimer = null;
  }
  lobbyPollAbort?.abort();
  lobbyPollAbort = null;
};

const flowPhaseForLobby = (lobby: RoomLobbySummary): PlaytestMultiplayerFlowPhase => {
  if (lobby.phase === 'active') {
    return 'live';
  }
  if (lobby.phase === 'finished' || lobby.phase === 'archived') {
    return 'finished';
  }
  return lobby.phase;
};

const sameParticipant = (
  left: LocalMultiplayerParticipantSession | null,
  right: LocalMultiplayerParticipantSession,
): boolean =>
  left?.baseUrl === right.baseUrl &&
  left?.roomId === right.roomId &&
  left?.playerId === right.playerId;

const startLobbyPolling = (
  session: LocalMultiplayerParticipantSession,
  set: StoreSet,
  get: () => PlaytestMultiplayerStoreState,
): void => {
  stopLobbyPolling();
  const generation = lobbyPollGeneration;

  const poll = async (): Promise<void> => {
    lobbyPollTimer = null;
    if (generation !== lobbyPollGeneration || !sameParticipant(get().participantSession, session)) {
      return;
    }

    const controller = new AbortController();
    lobbyPollAbort = controller;
    let shouldContinue = true;
    try {
      const lobby = await getLocalMultiplayerLobby(
        session.baseUrl,
        session.roomId,
        controller.signal,
      );
      if (generation !== lobbyPollGeneration) {
        return;
      }
      set({
        lobbyState: lobby,
        flowPhase: flowPhaseForLobby(lobby),
        lobbyError: null,
      });

      if (lobby.phase === 'finished' || lobby.phase === 'archived') {
        const results = await getLocalMultiplayerResults(
          session.baseUrl,
          session.roomId,
          controller.signal,
        );
        if (generation !== lobbyPollGeneration) {
          return;
        }
        set({ roomResults: results });
        shouldContinue = results === null;
      }
    } catch (error) {
      if (!controller.signal.aborted && generation === lobbyPollGeneration) {
        set({
          lobbyError:
            error instanceof Error ? error.message : 'Failed to refresh multiplayer lobby',
        });
      }
    } finally {
      if (lobbyPollAbort === controller) {
        lobbyPollAbort = null;
      }
      if (
        shouldContinue &&
        generation === lobbyPollGeneration &&
        sameParticipant(get().participantSession, session)
      ) {
        lobbyPollTimer = setTimeout(() => void poll(), LOBBY_POLL_INTERVAL_MS);
      }
    }
  };

  void poll();
};

const ensureClient = (
  rendererCapabilityId: string,
  mapWidth: number,
  mapHeight: number,
  set: StoreSet,
  get: () => PlaytestMultiplayerStoreState,
): PlaytestMultiplayerClient => {
  const existing = get().client;
  if (existing) {
    return existing;
  }
  // ADR-0023 section B: the multiplayer client runs the ACTIVE game mode's
  // discovered playtest runtime — resolved here by the caller-provided mode
  // plugin id, never a hardcoded plugin literal.
  const plugin = resolvePlaytestPlugin(rendererCapabilityId);
  const client = new PlaytestMultiplayerClient(
    mapWidth,
    mapHeight,
    (sessionState) => {
      set({ sessionState });
      if (sessionState.phase === 'error') {
        set({ flowPhase: 'error' });
      }
    },
    (welcomeSnapshot) => {
      set({ welcomeSnapshot });
    },
    plugin,
  );
  set({ client });
  return client;
};

const connectToRoom = async (
  baseUrl: string,
  rendererCapabilityId: string,
  mapId: string,
  roomId: string,
  mapWidth: number,
  mapHeight: number,
  set: StoreSet,
  get: () => PlaytestMultiplayerStoreState,
): Promise<void> => {
  stopLobbyPolling();
  set({ flowPhase: 'joining' });
  void mapId;
  const joinSession = await startPlaytestJoinSession(baseUrl, roomId);
  const participantSession: LocalMultiplayerParticipantSession = {
    ...joinSession,
    baseUrl: baseUrl.replace(/\/$/, ''),
    roomId,
  };
  set({
    participantSession,
    lobbyState: null,
    roomResults: null,
    lobbyError: null,
  });
  useEditorUiStore.getState().setPlaytestMode('multiplayer');
  useEditorUiStore.getState().setPlaytestActive(true);
  const client = ensureClient(rendererCapabilityId, mapWidth, mapHeight, set, get);
  client.connect(participantSession);
  startLobbyPolling(participantSession, set, get);
};

const connectWithParticipantSession = async (
  session: LocalMultiplayerParticipantSession,
  rendererCapabilityId: string,
  mapId: string,
  mapWidth: number,
  mapHeight: number,
  set: StoreSet,
  get: () => PlaytestMultiplayerStoreState,
): Promise<void> => {
  stopLobbyPolling();
  set({ flowPhase: 'joining' });
  void mapId;
  const participantSession: LocalMultiplayerParticipantSession = {
    ...session,
    baseUrl: session.baseUrl.replace(/\/$/, ''),
  };
  set({
    participantSession,
    lobbyState: null,
    roomResults: null,
    lobbyError: null,
  });
  useEditorUiStore.getState().setPlaytestMode('multiplayer');
  useEditorUiStore.getState().setPlaytestActive(true);
  const client = ensureClient(rendererCapabilityId, mapWidth, mapHeight, set, get);
  client.connect(participantSession);
  startLobbyPolling(participantSession, set, get);
};

export const usePlaytestMultiplayerStore = create<
  PlaytestMultiplayerStoreState & PlaytestMultiplayerStoreActions
>()((set, get) => ({
  ...initialState,

  reset: () => {
    stopLobbyPolling();
    get().client?.disconnect();
    set(initialState);
    useEditorUiStore.getState().resetMultiplayerPlaytest();
  },

  hostLocalMatch: async (projectId, mapId) => {
    stopLobbyPolling();
    set({ flowPhase: 'starting-host' });
    useEditorUiStore.getState().setPlaytestHostModalOpen(true);
    try {
      await useEditorCommandsBridge.getState().flushPersistFor(projectId, mapId);
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
        mapPackage: prepared.mapPackage,
        playerModelSelections: prepared.playerModelSelections,
      });
      const merged: LocalHostSession = { ...host, ...room };
      useEditorUiStore.getState().setLocalHostSession(merged);
      set({ roomReady: room, flowPhase: 'host-ready' });
      notifySuccess(`Room ${room.roomId} ready`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to host local match';
      set({ flowPhase: 'error', roomReady: null, lobbyError: message });
      await window.tileborne.runtime.stopLocalHost({}).catch(() => undefined);
      useEditorUiStore.getState().resetMultiplayerPlaytest();
      notifyError(message);
      throw error;
    }
  },

  joinFromInput: async (
    input,
    rendererCapabilityId,
    mapId,
    mapWidth,
    mapHeight,
    fallbackBaseUrl,
  ) => {
    if (rendererCapabilityId === undefined) {
      notifyError('The active game mode does not declare capabilities.renderer');
      return;
    }
    const parsed = parsePlaytestRoomInput(input, fallbackBaseUrl);
    if (!parsed) {
      notifyError('Enter a valid room URL or tileborne://playtest/<roomId> deep link');
      return;
    }
    useEditorUiStore.getState().setPlaytestJoinModalOpen(false);
    try {
      await connectToRoom(
        parsed.baseUrl,
        rendererCapabilityId,
        mapId,
        parsed.roomId,
        mapWidth,
        mapHeight,
        set,
        get,
      );
    } catch (error) {
      set({ flowPhase: 'error' });
      notifyError(error instanceof Error ? error.message : 'Failed to join room');
      throw error;
    }
  },

  joinHostAsPlayer: async (rendererCapabilityId, mapId, mapWidth, mapHeight) => {
    const room = get().roomReady;
    if (!room) {
      return;
    }
    if (rendererCapabilityId === undefined) {
      notifyError('The active game mode does not declare capabilities.renderer');
      return;
    }
    useEditorUiStore.getState().setPlaytestHostModalOpen(false);
    await connectToRoom(
      room.baseUrl,
      rendererCapabilityId,
      mapId,
      room.roomId,
      mapWidth,
      mapHeight,
      set,
      get,
    );
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

  setLocalReady: async (ready) => {
    const session = get().participantSession;
    const lobby = get().lobbyState;
    if (
      session === null ||
      lobby === null ||
      (lobby.phase !== 'lobby' && lobby.phase !== 'countdown')
    ) {
      return;
    }
    set({ isReadyPending: true, lobbyError: null });
    try {
      const nextLobby = await setLocalMultiplayerReady(session, ready);
      if (!sameParticipant(get().participantSession, session)) {
        return;
      }
      set({
        lobbyState: nextLobby,
        flowPhase: flowPhaseForLobby(nextLobby),
      });
    } catch (error) {
      if (sameParticipant(get().participantSession, session)) {
        const message = error instanceof Error ? error.message : 'Failed to update readiness';
        set({ lobbyError: message });
        notifyError(message);
      }
      throw error;
    } finally {
      if (sameParticipant(get().participantSession, session)) {
        set({ isReadyPending: false });
      }
    }
  },

  leaveSession: () => {
    stopLobbyPolling();
    get().client?.disconnect();
    set(initialState);
    useEditorUiStore.getState().resetMultiplayerPlaytest();
    notifyInfo('Left multiplayer room');
  },

  stopHosting: async () => {
    stopLobbyPolling();
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
  stopLobbyPolling();
  usePlaytestMultiplayerStore.getState().client?.disconnect();
  usePlaytestMultiplayerStore.setState(initialState);
};

if (typeof window !== 'undefined') {
  window.__tileborne_e2e = {
    ...window.__tileborne_e2e,
    getMultiplayerSessionState: () => usePlaytestMultiplayerStore.getState().sessionState,
    getMultiplayerStoreState: () => {
      const state = usePlaytestMultiplayerStore.getState();
      return {
        flowPhase: state.flowPhase,
        hasRoomReady: state.roomReady !== null,
        isReadyPending: state.isReadyPending,
        lobbyError: state.lobbyError,
        lobbyState: state.lobbyState,
        participantSession: state.participantSession,
        roomResults: state.roomResults,
      };
    },
    joinMultiplayerSession: (session, options) =>
      connectWithParticipantSession(
        session,
        options.rendererCapabilityId,
        options.mapId,
        options.mapWidth,
        options.mapHeight,
        usePlaytestMultiplayerStore.setState,
        usePlaytestMultiplayerStore.getState,
      ),
  };
}

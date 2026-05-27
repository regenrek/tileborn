// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}));

vi.stubGlobal('localStorage', localStorageMock);

vi.mock('@/stores/editor-ui-store', () => {
  const state = {
    playtestHostModalOpen: false,
    playtestJoinModalOpen: false,
    localHostSession: null as unknown,
    playtestMode: 'none',
    playtestActive: false,
    setPlaytestHostModalOpen: vi.fn((open: boolean) => {
      state.playtestHostModalOpen = open;
    }),
    setPlaytestJoinModalOpen: vi.fn((open: boolean) => {
      state.playtestJoinModalOpen = open;
    }),
    setLocalHostSession: vi.fn((session: unknown) => {
      state.localHostSession = session;
    }),
    setPlaytestMode: vi.fn((mode: string) => {
      state.playtestMode = mode;
    }),
    setPlaytestActive: vi.fn((active: boolean) => {
      state.playtestActive = active;
    }),
    resetMultiplayerPlaytest: vi.fn(() => {
      state.playtestMode = 'none';
      state.playtestActive = false;
      state.localHostSession = null;
      state.playtestHostModalOpen = false;
      state.playtestJoinModalOpen = false;
    }),
  };
  return {
    useEditorUiStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

import { PlaytestHostDialog, PlaytestJoinDialog } from '@/components/playtest-multiplayer-dialogs';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import {
  disposePlaytestMultiplayerSession,
  usePlaytestMultiplayerStore,
} from '@/stores/playtest-multiplayer-store';

const roomReady = {
  baseUrl: 'http://127.0.0.1:8787',
  roomId: 'room-test',
  roomUrl: 'http://127.0.0.1:8787/rooms/room-test',
  wsUrl: 'ws://127.0.0.1:8787/rooms/room-test/connect',
  deeplink: 'tileborne://playtest/room-test',
};

describe('playtest multiplayer modal flow', () => {
  beforeEach(() => {
    usePlaytestMultiplayerStore.setState({
      flowPhase: 'idle',
      roomReady: null,
      sessionState: null,
      welcomeSnapshot: null,
      client: null,
    });
    vi.restoreAllMocks();
    Object.assign(window, {
      tileborne: {
        runtime: {
          startLocalHost: vi.fn().mockResolvedValue({
            baseUrl: 'http://127.0.0.1:8787',
            signingKey: 'local-handoff-signing-key-32-bytes-x',
          }),
          stopLocalHost: vi.fn().mockResolvedValue({}),
        },
        system: {
          openPlaytestJoinWindow: vi.fn().mockResolvedValue({ opened: true }),
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ roomId: 'room-test', wsUrl: 'http://127.0.0.1:8787/rooms/room-test/connect' }),
      }),
    );
  });

  it('transitions host modal from starting to ready with wsUrl', async () => {
    const onCopy = vi.fn();
    const { rerender } = render(
      <PlaytestHostDialog
        open
        onOpenChange={vi.fn()}
        room={null}
        isStarting
        onCopy={onCopy}
        onOpenSecondClient={vi.fn()}
        onJoinAsHost={vi.fn()}
        onStopHosting={vi.fn()}
      />,
    );

    expect(screen.getByText(/Starting local game host/i)).toBeTruthy();

    rerender(
      <PlaytestHostDialog
        open
        onOpenChange={vi.fn()}
        room={roomReady}
        isStarting={false}
        onCopy={onCopy}
        onOpenSecondClient={vi.fn()}
        onJoinAsHost={vi.fn()}
        onStopHosting={vi.fn()}
      />,
    );

    expect((screen.getByTestId('playtest-host-ws-url') as HTMLInputElement).value).toBe(
      roomReady.wsUrl,
    );
  });

  it('runs hostLocalMatch store action through mocked IPC and fetch', async () => {
    await usePlaytestMultiplayerStore.getState().hostLocalMatch('map:test');
    await waitFor(() => {
      expect(usePlaytestMultiplayerStore.getState().flowPhase).toBe('host-ready');
    });
    expect(window.tileborne.runtime.startLocalHost).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/rooms/create',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(usePlaytestMultiplayerStore.getState().roomReady?.wsUrl).toBe(roomReady.wsUrl);
  });

  it('submits join dialog input to join handler', () => {
    const onJoin = vi.fn();

    render(
      <PlaytestJoinDialog
        open
        onOpenChange={vi.fn()}
        fallbackBaseUrl="http://127.0.0.1:8787"
        onJoin={onJoin}
      />,
    );

    fireEvent.change(screen.getByTestId('playtest-join-input'), {
      target: { value: roomReady.roomUrl },
    });
    fireEvent.click(screen.getByTestId('playtest-join-submit'));

    expect(onJoin).toHaveBeenCalledWith(roomReady.roomUrl);
  });

  it('stopHosting clears local host via IPC', async () => {
    usePlaytestMultiplayerStore.setState({ roomReady, flowPhase: 'host-ready' });

    await usePlaytestMultiplayerStore.getState().stopHosting();

    expect(window.tileborne.runtime.stopLocalHost).toHaveBeenCalled();
    expect(usePlaytestMultiplayerStore.getState().flowPhase).toBe('idle');
    expect(usePlaytestMultiplayerStore.getState().roomReady).toBeNull();
  });

  it('route disposal does not stop the app-wide local host', () => {
    useEditorUiStore.getState().setLocalHostSession({
      ...roomReady,
      signingKey: 'local-handoff-signing-key-32-bytes-x',
    });

    disposePlaytestMultiplayerSession();

    expect(window.tileborne.runtime.stopLocalHost).not.toHaveBeenCalled();
    expect(usePlaytestMultiplayerStore.getState().flowPhase).toBe('idle');
  });
});

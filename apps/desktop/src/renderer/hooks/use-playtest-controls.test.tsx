// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type PropsWithChildren } from 'react';

import { resetPlaytestStopCoordinatorForTests, usePlaytestControls } from './use-playtest-controls';

const editorStateMock = vi.hoisted(() => ({
  current: {
    playtestSessionId: 'session-1',
    setPlaytestActive: vi.fn(),
    setPlaytestSessionId: vi.fn(),
    setPlaytestActivePlugins: vi.fn(),
    setPlaytestMode: vi.fn(),
  },
}));

vi.mock('@/lib/lobby-model-selection', () => ({
  readLobbyModelSelection: vi.fn(() => undefined),
}));

vi.mock('@/stores/editor-commands-bridge', () => ({
  useEditorCommandsBridge: {
    getState: () => ({
      flushPersistFor: vi.fn(() => Promise.resolve()),
    }),
  },
}));

vi.mock('@/stores/editor-ui-store', () => {
  const useEditorUiStore = (selector: (value: typeof editorStateMock.current) => unknown) =>
    selector(editorStateMock.current);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, {
      getState: () => editorStateMock.current,
    }),
  };
});

vi.mock('@/stores/app-notifications-store', () => ({
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
}));

const owner = {
  sessionId: 'session-1',
  projectId: 'project-1',
  mapId: 'map-1',
};

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

function DrawerStopButton() {
  const { stop } = usePlaytestControls();
  return (
    <button type="button" onClick={() => void stop(owner).catch(() => undefined)}>
      Drawer stop
    </button>
  );
}

function ViewportCleanupStopper() {
  const { stop } = usePlaytestControls();
  useEffect(
    () => () => {
      void stop(owner).catch(() => undefined);
    },
    [stop],
  );
  return null;
}

describe('usePlaytestControls stop coordinator', () => {
  beforeEach(() => {
    resetPlaytestStopCoordinatorForTests();
    editorStateMock.current = {
      playtestSessionId: 'session-1',
      setPlaytestActive: vi.fn(),
      setPlaytestSessionId: vi.fn(),
      setPlaytestActivePlugins: vi.fn(),
      setPlaytestMode: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    resetPlaytestStopCoordinatorForTests();
  });

  it('joins a drawer-initiated owner stop when viewport cleanup unmounts while it is pending', async () => {
    const runningSessions = new Set(['session-1']);
    const activeRuntimes = new Set(['session-1']);
    const staleErrors: string[] = [];
    let resolveStop!: () => void;
    const stopSettled = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const registeredStopRequests: typeof owner[] = [];
    const stop = vi.fn(async (input: typeof owner) => {
      registeredStopRequests.push(input);
      if (!activeRuntimes.has(input.sessionId)) {
        staleErrors.push(`inactive runtime ${input.sessionId}`);
        throw new Error(`inactive runtime ${input.sessionId}`);
      }
      await stopSettled;
      activeRuntimes.delete(input.sessionId);
      runningSessions.delete(input.sessionId);
      return {
        session: {
          ...input,
          id: input.sessionId,
          status: 'Stopped' as const,
          activePlugins: [],
        },
      };
    });
    Object.assign(window, {
      tileborne: {
        playtest: {
          start: vi.fn(),
          stop,
          list: vi.fn(async () => ({
            sessions: [...runningSessions].map((id) => ({ id, status: 'Running' as const })),
          })),
        },
      },
    });

    const { unmount } = render(
      <>
        <DrawerStopButton />
        <ViewportCleanupStopper />
      </>,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Drawer stop' }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStop();
      await stopSettled;
    });

    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
      expect(registeredStopRequests).toEqual([owner]);
      expect(staleErrors).toEqual([]);
      expect([...runningSessions]).toEqual([]);
      expect([...activeRuntimes]).toEqual([]);
    });
  });
});

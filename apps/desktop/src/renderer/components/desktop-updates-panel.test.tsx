// @vitest-environment jsdom

import type { DesktopUpdateState } from '@tileborne/ipc-contracts';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TileborneDesktopUpdatesBridge } from '../../shared/desktop-updates-bridge';
import { documentLifecycle, type DocumentRegistration } from '@/lib/document-lifecycle';
import { resetDesktopUpdateStoreForTests } from '@/hooks/use-desktop-updates';

import { DesktopUpdatesPanel } from './desktop-updates-panel';

const state = (patch: Partial<DesktopUpdateState> = {}): DesktopUpdateState => ({
  state: 'idle',
  currentVersion: '1.0.0',
  ...patch,
});

const registration = (overrides: Partial<DocumentRegistration> = {}): DocumentRegistration => ({
  id: 'map:project-1:map-1',
  label: 'Starter Arena',
  kind: 'map',
  save: vi.fn().mockResolvedValue(undefined),
  discard: vi.fn(),
  ...overrides,
});

const installUpdatesBridge = (
  initial: DesktopUpdateState,
  overrides: Partial<TileborneDesktopUpdatesBridge> = {},
) => {
  const handlers = new Set<(next: DesktopUpdateState) => void>();
  const bridge: TileborneDesktopUpdatesBridge = {
    getState: vi.fn(async () => initial),
    check: vi.fn(async () => state({ state: 'up-to-date' })),
    restart: vi.fn(async () => initial),
    onStateChanged: vi.fn((handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }),
    ...overrides,
  };
  Object.defineProperty(window, 'tileborneDesktopUpdates', {
    configurable: true,
    value: bridge,
  });
  return {
    bridge,
    publish: (next: DesktopUpdateState) => {
      for (const handler of handlers) handler(next);
    },
  };
};

describe('DesktopUpdatesPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    documentLifecycle.resetForTests();
    resetDesktopUpdateStoreForTests();
    Reflect.deleteProperty(window, 'tileborneDesktopUpdates');
  });

  it('checks through the narrow no-argument update bridge', async () => {
    const { bridge } = installUpdatesBridge(state());

    render(<DesktopUpdatesPanel />);

    expect(await screen.findByText('Ready to check')).not.toBeNull();
    expect(screen.getByText('Last checked Never')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    await waitFor(() => expect(bridge.check).toHaveBeenCalledOnce());
    expect(bridge.check).toHaveBeenCalledWith();
    expect(screen.getByText('Up to date')).not.toBeNull();
  });

  it('retries through the narrow update bridge for retryable update errors', async () => {
    const { bridge } = installUpdatesBridge(
      state({
        state: 'error',
        diagnostic: {
          code: 'updater-error',
          message: 'The update service is temporarily unavailable.',
        },
      }),
    );

    render(<DesktopUpdatesPanel />);

    expect(await screen.findByText('Needs attention')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(bridge.check).toHaveBeenCalledOnce());
    expect(bridge.check).toHaveBeenCalledWith();
  });

  it.each([
    {
      code: 'invalid-version' as const,
      message: 'Update version must be stable SemVer.',
      guidance:
        'Install a stable SemVer Tileborne release, then check updates again from that build.',
    },
    {
      code: 'policy-mismatch' as const,
      message: 'Update candidate does not match policy.',
      guidance:
        'Use a release signed for the Tileborne macOS arm64 channel. Do not install this candidate.',
    },
    {
      code: 'restart-cancelled' as const,
      message: 'No staged update is ready to apply.',
      guidance:
        'Quit and reopen Tileborne to reset the update state, then check for updates again.',
    },
  ])(
    'shows recovery guidance without retry/check actions for non-retryable $code errors',
    async ({ code, message, guidance }) => {
      const { bridge } = installUpdatesBridge(
        state({
          state: 'error',
          diagnostic: {
            code,
            message,
          },
        }),
      );

      render(<DesktopUpdatesPanel />);

      expect(await screen.findByText(message)).not.toBeNull();
      expect(screen.getByText('Recovery required')).not.toBeNull();
      expect(screen.getByText(guidance)).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
      expect(bridge.check).not.toHaveBeenCalled();
    },
  );

  it('does not consume the staged update when dirty-document restart is cancelled', async () => {
    const { bridge } = installUpdatesBridge(state({ state: 'ready', targetVersion: '1.0.1' }));
    documentLifecycle.register(registration());
    documentLifecycle.markDirty('map:project-1:map-1');

    render(<DesktopUpdatesPanel confirm={() => false} />);

    expect(await screen.findByText('Ready to restart')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restart' }));

    await waitFor(() => expect(bridge.restart).not.toHaveBeenCalled());
    expect(documentLifecycle.get('map:project-1:map-1')?.status).toBe('dirty');
    expect(screen.getByText('Ready to restart')).not.toBeNull();
  });

  it('subscribes to ready update notifications and exposes Later', async () => {
    const { publish } = installUpdatesBridge(state());

    render(<DesktopUpdatesPanel />);

    await waitFor(() => expect(screen.getByText('Ready to check')).not.toBeNull());
    publish(state({ state: 'ready', targetVersion: '1.0.2' }));

    expect(await screen.findByRole('button', { name: 'Restart' })).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByText('Ready to restart')).not.toBeNull();
  });

  it('keeps a newer update event when the initial snapshot resolves stale', async () => {
    let resolveInitialSnapshot!: (next: DesktopUpdateState) => void;
    const initialSnapshot = new Promise<DesktopUpdateState>((resolve) => {
      resolveInitialSnapshot = resolve;
    });
    const { bridge, publish } = installUpdatesBridge(state(), {
      getState: vi.fn(() => initialSnapshot),
    });

    render(<DesktopUpdatesPanel />);

    await waitFor(() => expect(bridge.onStateChanged).toHaveBeenCalledOnce());
    publish(state({ state: 'ready', targetVersion: '1.0.2' }));

    expect(await screen.findByText('Ready to restart')).not.toBeNull();
    await act(async () => {
      resolveInitialSnapshot(state());
      await initialSnapshot;
    });

    expect(screen.getByText('Ready to restart')).not.toBeNull();
    expect(screen.queryByText('Ready to check')).toBeNull();
  });

  it('renders the last checked timestamp when present', async () => {
    installUpdatesBridge(state({ state: 'up-to-date', lastCheckedAt: '2026-07-26T14:30:00.000Z' }));

    render(<DesktopUpdatesPanel />);

    expect(await screen.findByText('Last checked 2026-07-26 14:30 UTC')).not.toBeNull();
  });
});

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StartupBoundary } from '@/components/startup/startup-boundary';
import type { StartupStatusSnapshot } from '../../../shared/startup-status';

const snapshot = (state: StartupStatusSnapshot['state']): StartupStatusSnapshot => ({
  state,
  tasks: [],
  errors: [],
  updatedAt: new Date(0).toISOString(),
});

const installStartupBridge = (initial: StartupStatusSnapshot) => {
  const handlers = new Set<(next: StartupStatusSnapshot) => void>();
  Object.defineProperty(window, 'tileborneStartup', {
    configurable: true,
    value: {
      getStatus: vi.fn(async () => initial),
      onStatusChanged: vi.fn((handler: (next: StartupStatusSnapshot) => void) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      }),
    },
  });
  return {
    publish: (next: StartupStatusSnapshot) => {
      for (const handler of handlers) {
        handler(next);
      }
    },
  };
};

describe('StartupBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'tileborneStartup');
    Reflect.deleteProperty(window, '__tileborneStartupBoundaryDebug');
  });

  it('does not tear down the app after a transient later starting snapshot', async () => {
    const startup = installStartupBridge(snapshot('ready'));

    render(
      <StartupBoundary>
        <div data-testid="router-child">Map editor route</div>
      </StartupBoundary>,
    );

    expect((await screen.findByTestId('router-child')).textContent).toBe('Map editor route');

    await act(async () => {
      startup.publish(snapshot('starting'));
    });

    expect(screen.getByTestId('router-child').textContent).toBe('Map editor route');
    expect(screen.queryByText('Starting Tileborne')).toBeNull();
  });
});

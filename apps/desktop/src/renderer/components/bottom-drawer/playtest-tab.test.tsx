// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  sessions: [] as {
    readonly id: string;
    readonly projectId: string;
    readonly mapId: string;
    readonly status: 'Running' | 'Stopped';
    readonly activePlugins?: readonly string[];
    readonly runtimeMetrics?: {
      readonly tickCount: number;
      readonly playerCount: number;
      readonly lastPluginEvent: string;
      readonly lastTickAtMs: number;
    };
  }[],
  editor: {
    playtestActive: true,
    playtestSessionId: 'playtest:550e8400-e29b-41d4-a716-446655440000',
    playtestActivePlugins: ['@tileborne-plugins/test-runtime'],
  },
}));

vi.mock('@/hooks/queries', () => ({
  usePlaytestSessions: () => ({
    isLoading: false,
    data: { sessions: mocks.sessions },
  }),
}));

vi.mock('@/hooks/use-playtest-controls', () => ({
  usePlaytestControls: () => ({
    stop: mocks.stop,
    isStopping: false,
  }),
}));

vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: typeof mocks.editor) => unknown) => selector(mocks.editor),
}));

import { PlaytestTab } from './playtest-tab';

describe('PlaytestTab', () => {
  beforeEach(() => {
    mocks.stop.mockReset();
    mocks.sessions = [];
    mocks.editor = {
      playtestActive: true,
      playtestSessionId: 'playtest:550e8400-e29b-41d4-a716-446655440000',
      playtestActivePlugins: ['@tileborne-plugins/test-runtime'],
    };
  });

  afterEach(cleanup);

  it('disables the fallback stop button until canonical owner data is loaded', () => {
    render(<PlaytestTab />);

    const stopButton = screen.getByRole('button', { name: /stop playtest/i });
    expect(stopButton).toHaveProperty('disabled', true);
    fireEvent.click(stopButton);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('stops listed drawer sessions with the full owner tuple', () => {
    mocks.sessions = [
      {
        id: 'playtest:550e8400-e29b-41d4-a716-446655440000',
        projectId: 'project:550e8400-e29b-41d4-a716-446655440000',
        mapId: 'map:550e8400-e29b-41d4-a716-446655440000',
        status: 'Running',
        activePlugins: ['@tileborne-plugins/test-runtime'],
        runtimeMetrics: {
          tickCount: 3,
          playerCount: 1,
          lastPluginEvent: 'tick',
          lastTickAtMs: 1,
        },
      },
    ];
    render(<PlaytestTab />);

    fireEvent.click(screen.getByRole('button', { name: /stop playtest/i }));
    expect(mocks.stop).toHaveBeenCalledWith({
      sessionId: 'playtest:550e8400-e29b-41d4-a716-446655440000',
      projectId: 'project:550e8400-e29b-41d4-a716-446655440000',
      mapId: 'map:550e8400-e29b-41d4-a716-446655440000',
    });
  });
});

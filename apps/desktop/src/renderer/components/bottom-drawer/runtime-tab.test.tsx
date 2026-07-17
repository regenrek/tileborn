// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  debug: undefined as unknown,
  navigate: vi.fn(),
  requestSource: vi.fn(),
  control: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/behavior-source-navigation', () => ({
  requestBehaviorSourceNavigation: mocks.requestSource,
}));
vi.mock('@/stores/editor-ui-store', () => ({
  useEditorUiStore: (selector: (state: unknown) => unknown) =>
    selector({
      playtestActive: true,
      playtestSessionId: 'playtest:550e8400-e29b-41d4-a716-446655440000',
      playtestActivePlugins: [],
    }),
}));
vi.mock('@/hooks/mutations', () => ({
  useControlPlaytestBehaviorDebug: () => ({ mutateAsync: mocks.control, isPending: false }),
}));
vi.mock('@/hooks/queries', () => ({
  usePlaytestSessions: () => ({
    isLoading: false,
    data: {
      sessions: [
        {
          id: 'playtest:550e8400-e29b-41d4-a716-446655440000',
          projectId: 'project:550e8400-e29b-41d4-a716-446655440000',
          activePlugins: [],
          runtimeMetrics: {
            tickCount: 3,
            playerCount: 1,
            lastPluginEvent: 'tick',
            lastTickAtMs: 1,
          },
        },
      ],
    },
  }),
  usePlaytestBehaviorDebug: () => ({ data: mocks.debug, isError: false }),
}));

import { RuntimeTab } from './runtime-tab';

const trace = (sequence: number, instanceId: string, eventId: string) => ({
  sequence,
  tick: sequence,
  behaviorId: 'behavior:550e8400-e29b-41d4-a716-446655440000',
  instanceId,
  sourceKind: 'visual',
  eventId,
  event: { sequence },
  stateBefore: { count: sequence - 1 },
  commands: [{ kind: 'state.set', payload: { count: sequence } }],
  state: { count: sequence },
  steps: [{ kind: 'action', nodeId: `node-${sequence}`, actionId: 'state.set' }],
  source: {
    sourceKind: 'visual',
    filePath: 'behaviors/counter.behavior.json',
    nodeId: `node-${sequence}`,
  },
});

const snapshot = (lastReload?: unknown) => ({
  snapshot: {
    sessionId: 'playtest:550e8400-e29b-41d4-a716-446655440000',
    status: 'paused',
    tick: 3,
    traces: [
      trace(1, 'instance-a', 'first-a'),
      trace(2, 'instance-b', 'only-b'),
      trace(3, 'instance-a', 'latest-a'),
    ],
    diagnostics: [],
    states: [],
    ...(lastReload === undefined ? {} : { lastReload }),
  },
});

describe('RuntimeTab behavior inspector', () => {
  beforeEach(() => {
    mocks.debug = snapshot();
    mocks.navigate.mockReset();
    mocks.requestSource.mockReset();
    mocks.control.mockReset();
  });
  afterEach(cleanup);

  it('keeps interleaved traces selectable as a bounded per-instance timeline', () => {
    render(<RuntimeTab />);
    expect(screen.getByText('Retained timeline · 2/256')).toBeTruthy();
    expect(screen.getByText('latest-a')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Inspect tick 1 first-a' }));
    expect(screen.getByText('first-a')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Behavior instance' }), {
      target: { value: 'instance-b' },
    });
    expect(screen.getByText('Retained timeline · 1/256')).toBeTruthy();
    expect(screen.getByText('only-b')).toBeTruthy();
  });

  it.each([
    [
      'TypeScript',
      { fileName: 'behaviors/counter.ts', line: 7, column: 11 },
      {
        sourcePath: 'behaviors/counter.ts',
        line: 7,
        column: 11,
      },
    ],
    [
      'visual',
      { fileName: 'behaviors/counter.behavior.json', nodeId: 'node-bad' },
      {
        sourcePath: 'behaviors/counter.behavior.json',
        nodeId: 'node-bad',
      },
    ],
  ])('routes %s compile diagnostics to their exact source position', (_kind, details, expected) => {
    mocks.debug = snapshot({
      behaviorId: 'behavior:550e8400-e29b-41d4-a716-446655440000',
      status: 'rejected-using-last-known-good',
      diagnostic: {
        code: 'TBBUILD2002',
        severity: 'error',
        message: 'Compile failed',
        suggestion: 'Fix it',
        details,
      },
    });
    render(<RuntimeTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    expect(mocks.requestSource).toHaveBeenCalledWith({
      projectId: 'project:550e8400-e29b-41d4-a716-446655440000',
      behaviorId: 'behavior:550e8400-e29b-41d4-a716-446655440000',
      ...expected,
    });
  });
});

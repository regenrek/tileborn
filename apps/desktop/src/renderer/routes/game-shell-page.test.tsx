// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shellState = vi.hoisted(() => ({
  searchPath: undefined as string | undefined,
  document: {
    schemaVersion: 1,
    pluginId: 'tileborne.battle-royale',
    screens: [
      {
        id: 'title',
        stableId: 'title',
        version: 1,
        kind: 'title',
        title: 'Tileborne',
        subtitle: 'Press start',
        enabled: true,
        layout: 'center',
        backgroundAssetId: 'asset:bg',
        actions: [
          { id: 'title.start', label: 'Start', type: 'navigate', targetScreenId: 'main-menu' },
        ],
      },
      {
        id: 'main-menu',
        stableId: 'main-menu',
        version: 1,
        kind: 'main-menu',
        title: 'Main Menu',
        subtitle: 'Choose mode',
        enabled: true,
        layout: 'stack',
        fontAssetId: 'asset:font',
        actions: [],
      },
      {
        id: 'results',
        stableId: 'results',
        version: 1,
        kind: 'results',
        title: 'Results',
        subtitle: 'Match complete',
        enabled: true,
        layout: 'stack',
        actions: [],
      },
    ],
    screenOrder: ['title', 'main-menu', 'results'],
    assets: [] as unknown[],
    tokens: {
      fontFamily: 'Inter',
      textColor: '#f8fafc',
      accentColor: '#38bdf8',
      panelColor: '#111827',
      focusColor: '#facc15',
      spacing: 'comfortable',
      motion: 'standard',
    },
    entryScreenId: 'title',
  },
}));

const applyCalls = vi.hoisted(() => [] as unknown[]);
const saveCalls = vi.hoisted(() => [] as unknown[]);

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project:shell' }),
  useSearch: () => ({
    ...(shellState.searchPath === undefined ? {} : { path: shellState.searchPath }),
  }),
}));

vi.mock('@/hooks/queries', () => ({
  useProjectGameShell: () => ({
    data: {
      document: shellState.document,
      projection: {
        ...shellState.document,
        registeredEvents: [],
        diagnostics: [
          {
            code: 'invalid-route',
            path: 'shell.screens.title.actions.title.start.targetScreenId',
            message: 'Action "Start" navigates to a missing screen.',
          },
          {
            code: 'missing-asset',
            path: 'shell.screens.title.backgroundAssetId',
            message: 'Screen "Tileborne" references a missing background asset.',
          },
          {
            code: 'missing-font',
            path: 'shell.screens.main-menu.fontAssetId',
            message: 'Screen "Main Menu" references a missing font asset.',
          },
          {
            code: 'invalid-route',
            path: 'shell.entryScreenId',
            message: 'Shell entry screen "missing" does not exist.',
          },
          {
            code: 'unreachable-required-screen',
            path: 'shell.screens.results',
            message: 'Required shell screen "Results" is not reachable from the entry screen.',
          },
        ],
      },
    },
  }),
  useAssetPacks: () => ({
    data: {
      packs: [
        {
          id: 'pack:ui',
          name: 'Shell UI',
          version: '1.0.0',
          licenseSpdxId: 'CC0-1.0',
          integrityHash: 'sha256:ui',
          assetCount: 2,
          capability: {},
        },
      ],
    },
  }),
  useAssetPackAssets: () => ({
    data: {
      assets: [
        { id: 'asset:bg', path: 'assets/ui/title.png', mime: 'image/png' },
        { id: 'asset:font', path: 'assets/ui/title.woff2', mime: 'font/woff2' },
      ],
    },
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useApplyProjectGameShellCommand: () => ({
    data: undefined,
    mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
      applyCalls.push(input);
      options?.onSuccess?.();
    },
  }),
  useSaveProjectGameShell: () => ({
    mutate: (input: unknown) => saveCalls.push(input),
  }),
}));

import { GameShellPage } from './game-shell-page';

describe('GameShellPage', () => {
  beforeEach(() => {
    applyCalls.length = 0;
    saveCalls.length = 0;
    shellState.searchPath = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('edits shell text, assets, actions, order, plugin defaults, and save through typed controls', async () => {
    render(<GameShellPage />);

    fireEvent.change(screen.getByTestId('game-shell-title'), { target: { value: 'Arena Night' } });
    expect(applyCalls.at(-1)).toMatchObject({
      projectId: 'project:shell',
      command: { type: 'set-screen-text', screenId: 'title', title: 'Arena Night' },
    });

    fireEvent.change(screen.getByTestId('game-shell-background'), {
      target: { value: 'asset:bg' },
    });
    await waitFor(() => expect(applyCalls).toHaveLength(3));
    expect(applyCalls.at(-2)).toMatchObject({
      command: { type: 'register-asset', asset: { assetId: 'asset:bg', kind: 'background' } },
    });
    expect(applyCalls.at(-1)).toMatchObject({
      command: {
        type: 'set-screen-asset',
        screenId: 'title',
        slot: 'background',
        assetId: 'asset:bg',
      },
    });

    fireEvent.change(screen.getByTestId('game-shell-action-label'), {
      target: { value: 'Options' },
    });
    fireEvent.change(screen.getByTestId('game-shell-action-type'), {
      target: { value: 'emit-event' },
    });
    fireEvent.click(screen.getByTestId('game-shell-add-action'));
    expect(applyCalls.at(-1)).toMatchObject({
      command: {
        type: 'upsert-action',
        screenId: 'title',
        action: {
          id: 'title.options',
          label: 'Options',
          type: 'emit-event',
          event: 'shell.action.invoked',
        },
      },
    });

    fireEvent.click(screen.getByLabelText('Move Main Menu up'));
    expect(applyCalls.at(-1)).toMatchObject({
      command: { type: 'set-screen-order', screenOrder: ['main-menu', 'title', 'results'] },
    });

    fireEvent.click(screen.getByTestId('game-shell-plugin-defaults'));
    expect(applyCalls.at(-1)).toMatchObject({
      command: { type: 'apply-plugin-defaults', pluginId: 'tileborne.battle-royale' },
    });

    fireEvent.click(screen.getByTestId('game-shell-save'));
    expect(saveCalls).toHaveLength(1);
    expect(screen.getByTestId('game-shell-preview').textContent).toContain('Tileborne');
    expect(screen.getByTestId('game-shell-diagnostics').textContent).toContain(
      'missing background asset',
    );
  });

  it.each([
    ['shell.screens.title.actions.title.start.targetScreenId', 'game-shell-action-row'],
    ['shell.screens.title.backgroundAssetId', 'game-shell-background'],
    ['shell.screens.main-menu.fontAssetId', 'game-shell-font'],
    ['shell.entryScreenId', 'game-shell-entry-screen'],
    ['shell.screens.results', 'game-shell-screen'],
  ])('focuses the exact Game Shell control for readiness path %s', async (path, testId) => {
    shellState.searchPath = path;

    render(<GameShellPage />);

    await waitFor(() => {
      const focused = screen
        .getAllByTestId(testId)
        .find((element) => element.getAttribute('data-shell-path') === path);
      expect(focused).toBeDefined();
      if (focused === undefined) throw new Error(`Missing focused element for ${path}`);
      expect(focused.getAttribute('data-shell-path')).toBe(path);
      expect(focused.getAttribute('data-focused')).toBe('true');
    });
  });
});

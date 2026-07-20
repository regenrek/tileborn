import { describe, expect, it } from 'vitest';

import {
  applyGameShellAuthoringCommand,
  buildRuntimeGameShellProjection,
  decodeGameShellDefaultsDefinition,
  decodeProjectGameShellDocument,
  decodeRuntimeGameShellProjection,
  defaultProjectGameShellState,
  dispatchRuntimeShellBehaviorAction,
  dispatchRuntimeShellAction,
  gameShellStateFromDocument,
  projectGameShellDocumentFromState,
  projectGameShellDocumentWithOverrides,
  resolveProjectGameShellDocument,
} from './index.js';

describe('game shell authoring contract', () => {
  it('provides versioned required screens with stable ids and plugin defaults', () => {
    const state = defaultProjectGameShellState('tileborne.battle-royale');
    const document = projectGameShellDocumentFromState(state);

    expect(document.schemaVersion).toBe(1);
    expect(document.pluginId).toBe('tileborne.battle-royale');
    expect(document.screens.map((screen) => screen.stableId)).toEqual([
      'title',
      'main-menu',
      'loading',
      'pause',
      'settings',
      'results',
    ]);
    expect(decodeProjectGameShellDocument(JSON.parse(JSON.stringify(document)))).toBeDefined();
  });

  it('applies project overrides without JSON editing and keeps screen versions stable', () => {
    const state = applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
      type: 'set-screen-text',
      screenId: 'title',
      title: 'Arena Night',
      subtitle: 'Press any key',
    });
    const themed = applyGameShellAuthoringCommand(state, {
      type: 'set-design-tokens',
      tokens: { accentColor: '#22c55e', spacing: 'spacious' },
    });
    const reordered = applyGameShellAuthoringCommand(themed, {
      type: 'set-screen-order',
      screenOrder: ['title', 'settings', 'main-menu', 'loading', 'pause', 'results'],
    });

    expect(reordered.screensById.title?.title).toBe('Arena Night');
    expect(reordered.screensById.title?.version).toBe(2);
    expect(reordered.tokens).toMatchObject({ accentColor: '#22c55e', spacing: 'spacious' });
    expect(reordered.screenOrder.slice(0, 3)).toEqual(['title', 'settings', 'main-menu']);
  });

  it('resolves plugin defaults with persisted project override commands as an explicit overlay', () => {
    const base = defaultProjectGameShellState('plugin:arena');
    const defaults = {
      pluginId: 'plugin:arena',
      screens: Object.values({
        ...base.screensById,
        title: { ...base.screensById.title!, title: 'Arena Defaults' },
      }),
      screenOrder: base.screenOrder,
      tokens: base.tokens,
      entryScreenId: base.entryScreenId,
    };
    const document = projectGameShellDocumentWithOverrides(base, [
      {
        type: 'set-screen-text',
        screenId: 'title',
        title: 'Project Title',
        subtitle: 'Project Subtitle',
      },
    ]);

    const resolved = resolveProjectGameShellDocument(document, defaults);

    expect(resolved.screens.find((screen) => screen.id === 'title')).toMatchObject({
      title: 'Project Title',
      subtitle: 'Project Subtitle',
    });
    expect(resolved.projectOverrides).toHaveLength(1);
  });

  it('blocks invalid routes, missing assets/fonts, and unreachable required screens', () => {
    let state = defaultProjectGameShellState();
    state = applyGameShellAuthoringCommand(state, {
      type: 'upsert-action',
      screenId: 'title',
      action: {
        id: 'title.bad',
        label: 'Broken route',
        type: 'navigate',
        targetScreenId: 'missing-screen',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'title',
      slot: 'background',
      assetId: 'asset:bg',
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'register-asset',
      asset: {
        assetId: 'asset:not-font',
        packId: 'pack:ui',
        packVersion: '1.0.0',
        path: 'assets/backgrounds/title.png',
        mime: 'image/png',
        kind: 'font',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'settings',
      slot: 'font',
      assetId: 'asset:not-font',
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-enabled',
      screenId: 'results',
      enabled: false,
    });

    const diagnostics = buildRuntimeGameShellProjection(state).diagnostics.map(
      (issue) => issue.code,
    );

    expect(diagnostics).toContain('invalid-route');
    expect(diagnostics).toContain('missing-asset');
    expect(diagnostics).toContain('missing-font');
    expect(diagnostics).toContain('disabled-required-screen');
  });

  it('does not require phase-owned loading, pause, and results screens to be authored navigation targets', () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    expect(projection.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unreachable-required-screen',
          path: expect.stringMatching(/loading|pause|results/),
        }),
      ]),
    );
  });

  it('rejects durable documents with duplicate stable ids and missing asset refs', () => {
    const document = projectGameShellDocumentFromState(defaultProjectGameShellState());

    expect(
      decodeProjectGameShellDocument({
        ...JSON.parse(JSON.stringify(document)),
        screens: [
          { ...document.screens[0], id: 'title' },
          { ...document.screens[1], id: 'title' },
        ],
      }),
    ).toBeUndefined();

    expect(
      decodeProjectGameShellDocument({
        ...JSON.parse(JSON.stringify(document)),
        screens: [{ ...document.screens[0], backgroundAssetId: 'asset:missing' }],
      }),
    ).toBeUndefined();
  });

  it('accepts canonical runtime shell projections at the exported decoder boundary', () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    expect(decodeRuntimeGameShellProjection(JSON.parse(JSON.stringify(projection)))).toBeDefined();
  });

  it('rejects runtime shell projections with duplicate asset ids masking conflicting asset refs', () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    expect(
      decodeRuntimeGameShellProjection({
        ...projection,
        assets: [
          {
            assetId: 'asset:dup',
            packId: 'pack:ui',
            packVersion: '1.0.0',
            path: 'assets/backgrounds/title.png',
            mime: 'image/png',
            kind: 'background',
          },
          {
            assetId: 'asset:dup',
            packId: 'pack:ui',
            packVersion: '1.0.0',
            path: 'assets/backgrounds/alternate.png',
            mime: 'image/png',
            kind: 'background',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('rejects runtime shell projections with duplicate registered events masking missing required events', () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    expect(
      decodeRuntimeGameShellProjection({
        ...projection,
        registeredEvents: projection.registeredEvents.map((event) =>
          event === 'shell.navigation.requested' ? 'shell.title.entered' : event,
        ),
      }),
    ).toBeUndefined();
  });

  it('rejects runtime shell projections with duplicate ordered screens masking missing required screens', () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());

    expect(
      decodeRuntimeGameShellProjection({
        ...projection,
        screenOrder: projection.screenOrder.map((screenId) =>
          screenId === 'results' ? 'title' : screenId,
        ),
      }),
    ).toBeUndefined();
  });

  it('validates plugin shell defaults at the runtime boundary', () => {
    const defaults = projectGameShellDocumentFromState(
      defaultProjectGameShellState('plugin:arena'),
    );
    expect(
      decodeGameShellDefaultsDefinition('plugin:arena', {
        screens: defaults.screens,
        screenOrder: defaults.screenOrder,
        assets: defaults.assets,
        tokens: defaults.tokens,
        entryScreenId: defaults.entryScreenId,
      }),
    ).toMatchObject({
      pluginId: 'plugin:arena',
      entryScreenId: 'title',
      screenOrder: expect.arrayContaining(['title', 'results']),
    });

    expect(
      decodeGameShellDefaultsDefinition('plugin:arena', {
        screens: defaults.screens,
        screenOrder: [...defaults.screenOrder, 'missing-screen'],
        assets: defaults.assets,
        tokens: defaults.tokens,
        entryScreenId: defaults.entryScreenId,
      }),
    ).toBeUndefined();

    expect(
      decodeGameShellDefaultsDefinition('plugin:arena', {
        screens: defaults.screens,
        screenOrder: defaults.screenOrder,
        assets: defaults.assets,
        tokens: defaults.tokens,
        entryScreenId: 'missing-screen',
      }),
    ).toBeUndefined();

    expect(
      decodeGameShellDefaultsDefinition('plugin:arena', {
        screens: [{ ...defaults.screens[0], backgroundAssetId: 'asset:missing' }],
        screenOrder: ['title'],
        assets: [],
        tokens: defaults.tokens,
        entryScreenId: 'title',
      }),
    ).toBeUndefined();
  });

  it('emits registered shell events while returning declarative navigation requests', () => {
    const projection = buildRuntimeGameShellProjection(
      gameShellStateFromDocument(projectGameShellDocumentFromState(defaultProjectGameShellState())),
    );
    const emitted: unknown[] = [];
    const request = dispatchRuntimeShellAction(projection, 'title.start', {
      emitShellEvent: (event, payload) => emitted.push([event, payload]),
    });

    expect(request).toEqual({ type: 'navigate', targetScreenId: 'main-menu' });
    expect(emitted).toEqual([
      [
        'shell.action.invoked',
        { screenId: 'title', actionId: 'title.start', targetScreenId: 'main-menu' },
      ],
      [
        'shell.navigation.requested',
        { screenId: 'title', actionId: 'title.start', targetScreenId: 'main-menu' },
      ],
    ]);
  });

  it('bridges shell dispatches into behavior scheduler events without owning navigation', () => {
    const projection = buildRuntimeGameShellProjection(
      gameShellStateFromDocument(projectGameShellDocumentFromState(defaultProjectGameShellState())),
    );
    const emitted: unknown[] = [];
    const request = dispatchRuntimeShellBehaviorAction(projection, 'title.start', {
      emitBehaviorEvent: (entryId, payload) => emitted.push([entryId, payload]),
    });

    expect(request).toEqual({ type: 'navigate', targetScreenId: 'main-menu' });
    expect(emitted).toEqual([
      [
        'shell.event',
        {
          event: 'shell.action.invoked',
          screenId: 'title',
          actionId: 'title.start',
          targetScreenId: 'main-menu',
        },
      ],
      [
        'shell.event',
        {
          event: 'shell.navigation.requested',
          screenId: 'title',
          actionId: 'title.start',
          targetScreenId: 'main-menu',
        },
      ],
    ]);
  });
});

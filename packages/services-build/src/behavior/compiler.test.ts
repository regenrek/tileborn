import path from 'node:path';

import {
  BehaviorDefinition,
  BehaviorRegistryManifest,
  CORE_BEHAVIOR_REGISTRY,
  type BehaviorId,
} from '@tileborne/core';
import {
  DeterministicBehaviorScheduler,
  loadBehaviorModuleNamespace,
  type LoadedBehaviorModule,
} from '@tileborne/runtime';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BehaviorCompilerSession,
  compileTypeScriptBehavior,
  compileVisualBehavior,
  resolveGameSdkEntryPath,
  type CompiledBehaviorModule,
} from './compiler.js';

const VISUAL_ID = 'behavior:11111111-1111-4111-8111-111111111111' as BehaviorId;
const TYPESCRIPT_ID = 'behavior:22222222-2222-4222-8222-222222222222' as BehaviorId;
const NODE_1 = 'behavior-node:11111111-1111-4111-8111-111111111111';
const NODE_2 = 'behavior-node:22222222-2222-4222-8222-222222222222';
const projectRoot = path.resolve('/virtual/tileborne-project');
const entryFile = path.join(projectRoot, 'src/open-exit.ts');

const registry = Schema.decodeUnknownSync(BehaviorRegistryManifest)({
  schemaVersion: 1,
  entries: [
    {
      id: 'world.player-entered-zone',
      kind: 'event',
      label: 'Player entered zone',
      category: 'World',
      description: 'Zone trigger',
      capability: 'world.zones',
      inputs: [],
      outputs: [
        { key: 'playerId', label: 'Player', valueKind: 'string', required: true },
        { key: 'zoneId', label: 'Zone', valueKind: 'string', required: true },
      ],
    },
    {
      id: 'inventory.has-item',
      kind: 'condition',
      label: 'Has item',
      category: 'Inventory',
      description: 'Inventory query',
      capability: 'inventory.core',
      inputs: [
        { key: 'playerId', label: 'Player', valueKind: 'string', required: true },
        { key: 'itemId', label: 'Item', valueKind: 'string', required: true },
      ],
      outputs: [],
    },
    {
      id: 'state.set',
      kind: 'action',
      label: 'Set state',
      category: 'State',
      description: 'State mutation',
      capability: 'state.core',
      inputs: [
        { key: 'key', label: 'Key', valueKind: 'string', required: true },
        { key: 'value', label: 'Value', valueKind: 'json', required: true },
      ],
      outputs: [],
    },
    {
      id: 'world.open-door',
      kind: 'action',
      label: 'Open door',
      category: 'World',
      description: 'Door action',
      capability: 'world.doors',
      inputs: [{ key: 'doorId', label: 'Door', valueKind: 'string', required: true }],
      outputs: [],
    },
  ],
});

const visualDefinition = Schema.decodeUnknownSync(BehaviorDefinition)({
  schemaVersion: 1,
  id: VISUAL_ID,
  label: 'Open extraction door',
  state: [{ key: 'opened', label: 'Opened', initialValue: false }],
  when: {
    entryId: 'world.player-entered-zone',
    arguments: { zoneId: { _tag: 'literal', value: 'extraction' } },
  },
  if: {
    _tag: 'condition',
    nodeId: NODE_1,
    invocation: {
      entryId: 'inventory.has-item',
      arguments: {
        playerId: { _tag: 'event-field', path: 'playerId' },
        itemId: { _tag: 'literal', value: 'golden-key' },
      },
    },
  },
  do: [
    {
      _tag: 'action',
      nodeId: NODE_1,
      invocation: {
        entryId: 'state.set',
        arguments: {
          key: { _tag: 'literal', value: 'opened' },
          value: { _tag: 'literal', value: true },
        },
      },
    },
    {
      _tag: 'action',
      nodeId: NODE_2,
      invocation: {
        entryId: 'world.open-door',
        arguments: { doorId: { _tag: 'literal', value: 'object:exit-door' } },
      },
    },
  ],
});

const typescriptSource = `
import { defineBehavior } from '@tileborne/game-sdk';
export default defineBehavior({
  id: 'example.open-exit',
  state: { opened: false },
  on: {
    'world.player-entered-zone': ({ event, state, query, actions }) => {
      if (event.zoneId !== 'extraction') return;
      if (!query['inventory.has-item'](event.playerId, 'golden-key')) return;
      return [state.set('opened', true), actions['world.open-door']('object:exit-door')];
    },
  },
});
`;

const importArtifact = async (artifact: CompiledBehaviorModule): Promise<LoadedBehaviorModule> => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(artifact.code).toString('base64')}`;
  const namespace = (await import(moduleUrl)) as Readonly<Record<string, unknown>>;
  const loaded = loadBehaviorModuleNamespace({ artifact, code: artifact.code, namespace });
  if (!loaded.ok) throw new Error(loaded.diagnostic.message);
  return loaded.loaded;
};

describe('behavior compiler', () => {
  it('locates the game SDK from an Electron main bundle directory without module metadata', () => {
    const electronBundleDirectory = path.resolve(process.cwd(), '../../apps/desktop/.vite/build');
    expect(resolveGameSdkEntryPath(electronBundleDirectory)).toMatch(
      /packages\/game-sdk\/(?:dist\/index\.js|src\/index\.ts)$/,
    );
  });

  it('executes the core local-state condition without an external query capability', async () => {
    const definition = Schema.decodeUnknownSync(BehaviorDefinition)({
      schemaVersion: 1,
      id: VISUAL_ID,
      label: 'Increment once',
      state: [{ key: 'count', label: 'Count', initialValue: 1 }],
      when: { entryId: 'lifecycle.started', arguments: {} },
      if: {
        _tag: 'condition',
        nodeId: NODE_1,
        invocation: {
          entryId: 'state.equals',
          arguments: {
            key: { _tag: 'literal', value: 'count' },
            value: { _tag: 'literal', value: 1 },
          },
        },
      },
      do: [
        {
          _tag: 'action',
          nodeId: NODE_2,
          invocation: {
            entryId: 'state.set',
            arguments: {
              key: { _tag: 'literal', value: 'count' },
              value: { _tag: 'literal', value: 2 },
            },
          },
        },
      ],
    });
    const compiled = compileVisualBehavior({
      definition,
      definitionPath: 'behaviors/increment.behavior.json',
      registry: CORE_BEHAVIOR_REGISTRY,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const scheduler = new DeterministicBehaviorScheduler();
    scheduler.register(await importArtifact(compiled.artifact));
    expect((await scheduler.dispatch('lifecycle.started', {}))[0]?.state).toEqual({ count: 2 });
  });

  it('bundles native TypeScript with restricted resolution, stable hashes, and source maps', async () => {
    const first = await compileTypeScriptBehavior({
      behaviorId: TYPESCRIPT_ID,
      projectRoot,
      entryFile,
      files: [{ fileName: entryFile, sourceText: typescriptSource }],
    });
    const second = await compileTypeScriptBehavior({
      behaviorId: TYPESCRIPT_ID,
      projectRoot,
      entryFile,
      files: [{ fileName: entryFile, sourceText: typescriptSource }],
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.artifact.hash).toBe(second.artifact.hash);
    expect(first.artifact.code).not.toContain("from '@tileborne/game-sdk'");
    expect(JSON.parse(first.artifact.sourceMap)).toMatchObject({ version: 3 });

    const blocked = await compileTypeScriptBehavior({
      behaviorId: TYPESCRIPT_ID,
      projectRoot,
      entryFile,
      files: [
        {
          fileName: entryFile,
          sourceText: "import fs from 'node:fs'; export default fs;",
        },
      ],
    });
    expect(blocked).toMatchObject({ ok: false, diagnostics: [{ code: 'TBSDK1001' }] });
    if (!blocked.ok) {
      expect(blocked.diagnostics[0]).toMatchObject({
        behaviorId: TYPESCRIPT_ID,
        sourceKind: 'typescript',
        fileName: entryFile,
      });
    }

    const constructorEscape = await compileTypeScriptBehavior({
      behaviorId: TYPESCRIPT_ID,
      projectRoot,
      entryFile,
      files: [
        {
          fileName: entryFile,
          sourceText: `export default (() => {}).constructor('return globalThis')();`,
        },
      ],
    });
    expect(constructorEscape).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'TBSDK1003' }],
    });

    for (const sourceText of [
      `export default Reflect.get(() => {}, 'constructor')('return globalThis')();`,
      `export default Object.getOwnPropertyDescriptor(() => {}, 'constructor')?.value('return process')();`,
      `const R = Reflect; export default R.get(() => {}, 'constructor')('return globalThis')();`,
      `const { get } = Reflect; export default get(() => {}, 'constructor')('return globalThis')();`,
      `const O = Object; export default O.getOwnPropertyDescriptor(() => {}, 'constructor')?.value('return process')();`,
      `export default (() => {})[['con', 'structor'].join('')]('return globalThis')();`,
      `const p = Reflect.getPrototypeOf(() => {})!; const k = String('constructor'); export default p[k]('return globalThis')();`,
      `const p = Object.getPrototypeOf(() => {}); const k = ['con', 'structor'].join(''); export default p[k]('return globalThis')();`,
    ]) {
      const reflectiveEscape = await compileTypeScriptBehavior({
        behaviorId: TYPESCRIPT_ID,
        projectRoot,
        entryFile,
        files: [{ fileName: entryFile, sourceText }],
      });
      expect(reflectiveEscape, sourceText).toMatchObject({ ok: false });
      if (reflectiveEscape.ok) continue;
      expect(reflectiveEscape.diagnostics, sourceText).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'TBSDK1003' })]),
      );
      expect(reflectiveEscape.diagnostics.every(({ code }) => code === 'TBSDK1003')).toBe(true);
    }
  });

  it('keeps the last-known-good compiled artifact when a visual edit becomes invalid', () => {
    const session = new BehaviorCompilerSession();
    const valid = session.compileVisual({
      definition: visualDefinition,
      definitionPath: 'behaviors/open-exit.behavior.json',
      registry,
    });
    expect(valid.ok).toBe(true);
    const invalid = session.compileVisual({
      definition: visualDefinition,
      definitionPath: 'behaviors/open-exit.behavior.json',
      registry: new BehaviorRegistryManifest({ schemaVersion: 1, entries: [] }),
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.diagnostics[0]).toMatchObject({ code: 'TBBUILD2101' });
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TBBUILD2101',
          behaviorId: VISUAL_ID,
          sourceKind: 'visual',
          nodeId: NODE_2,
          message: expect.stringContaining('world.open-door'),
        }),
      ]),
    );
    expect(invalid.lastKnownGood?.hash).toBe(valid.ok ? valid.artifact.hash : undefined);
  });

  it('produces golden-equivalent action, state, and event traces for visual and TypeScript sources', async () => {
    const visual = compileVisualBehavior({
      definition: visualDefinition,
      definitionPath: 'behaviors/open-exit.behavior.json',
      registry,
    });
    const typescript = await compileTypeScriptBehavior({
      behaviorId: TYPESCRIPT_ID,
      projectRoot,
      entryFile,
      files: [{ fileName: entryFile, sourceText: typescriptSource }],
    });
    expect(visual.ok).toBe(true);
    expect(typescript.ok).toBe(true);
    if (!visual.ok || !typescript.ok) return;

    const run = async (artifact: CompiledBehaviorModule) => {
      const scheduler = new DeterministicBehaviorScheduler({
        queries: {
          'inventory.has-item': (...arguments_: ReadonlyArray<unknown>) =>
            arguments_[0] === 'player-1' && arguments_[1] === 'golden-key',
        },
      });
      scheduler.register(await importArtifact(artifact));
      const traces = await scheduler.dispatch('world.player-entered-zone', {
        playerId: 'player-1',
        zoneId: 'extraction',
      });
      return traces.map(({ eventId, event, commands, state }) => ({
        eventId,
        event,
        commands,
        state,
      }));
    };

    expect(await run(visual.artifact)).toEqual(await run(typescript.artifact));
    expect(await run(visual.artifact)).toMatchInlineSnapshot(`
      [
        {
          "commands": [
            {
              "kind": "state.set",
              "payload": {
                "key": "opened",
                "value": true,
              },
            },
            {
              "kind": "world.open-door",
              "payload": {
                "arguments": [
                  "object:exit-door",
                ],
              },
            },
          ],
          "event": {
            "playerId": "player-1",
            "zoneId": "extraction",
          },
          "eventId": "world.player-entered-zone",
          "state": {
            "opened": true,
          },
        },
      ]
    `);
  });
});

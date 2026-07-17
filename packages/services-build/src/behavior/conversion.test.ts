import path from 'node:path';

import { BehaviorDefinition, BehaviorRegistryManifest, type BehaviorId } from '@tileborne/core';
import {
  DeterministicBehaviorScheduler,
  loadBehaviorModuleNamespace,
  type LoadedBehaviorModule,
} from '@tileborne/runtime';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  compileTypeScriptBehavior,
  compileVisualBehavior,
  type CompiledBehaviorModule,
} from './compiler.js';
import { generateTypeScriptBehaviorSource } from './conversion.js';

const ID = 'behavior:77777777-7777-4777-8777-777777777777' as BehaviorId;
const projectRoot = path.resolve('/virtual/conversion-project');
const entryFile = path.join(projectRoot, 'behaviors/sources/converted.ts');
const nodeId = (suffix: string) => `behavior-node:${suffix}`;

const registry = Schema.decodeUnknownSync(BehaviorRegistryManifest)({
  schemaVersion: 1,
  entries: [
    {
      id: 'world.entered',
      kind: 'event',
      label: 'Entered',
      category: 'World',
      description: 'Entered a zone',
      capability: 'world.zones',
      inputs: [],
      outputs: [],
    },
    {
      id: 'inventory.has',
      kind: 'condition',
      label: 'Has',
      category: 'Inventory',
      description: 'Has an asset',
      capability: 'inventory.core',
      inputs: [
        { key: 'playerId', label: 'Player', valueKind: 'string', required: true },
        { key: 'asset', label: 'Asset', valueKind: 'asset-reference', required: true },
      ],
      outputs: [],
    },
    {
      id: 'state.equals',
      kind: 'condition',
      label: 'Equals',
      category: 'State',
      description: 'State equals',
      capability: 'state.core',
      inputs: [
        { key: 'key', label: 'Key', valueKind: 'string', required: true },
        { key: 'value', label: 'Value', valueKind: 'json', required: true },
      ],
      outputs: [],
    },
    {
      id: 'state.set',
      kind: 'action',
      label: 'Set',
      category: 'State',
      description: 'Set state',
      capability: 'state.core',
      inputs: [
        { key: 'key', label: 'Key', valueKind: 'string', required: true },
        { key: 'value', label: 'Value', valueKind: 'json', required: true },
      ],
      outputs: [],
    },
    {
      id: 'world.open',
      kind: 'action',
      label: 'Open',
      category: 'World',
      description: 'Open a door',
      capability: 'world.doors',
      inputs: [{ key: 'doorId', label: 'Door', valueKind: 'string', required: true }],
      outputs: [],
    },
  ],
});

const definition = Schema.decodeUnknownSync(BehaviorDefinition)({
  schemaVersion: 1,
  id: ID,
  label: 'Converted door',
  state: [{ key: 'opened', label: 'Opened', initialValue: false }],
  when: { entryId: 'world.entered', arguments: { zoneId: { _tag: 'literal', value: 'vault' } } },
  if: {
    _tag: 'all',
    nodeId: nodeId('10000000-0000-4000-8000-000000000000'),
    conditions: [
      {
        _tag: 'condition',
        nodeId: nodeId('20000000-0000-4000-8000-000000000000'),
        invocation: {
          entryId: 'inventory.has',
          arguments: {
            playerId: { _tag: 'event-field', path: 'playerId' },
            asset: {
              _tag: 'reference',
              reference: { _tag: 'asset', assetId: 'asset:30000000-0000-4000-8000-000000000000' },
            },
          },
        },
      },
      {
        _tag: 'not',
        nodeId: nodeId('40000000-0000-4000-8000-000000000000'),
        condition: {
          _tag: 'condition',
          nodeId: nodeId('50000000-0000-4000-8000-000000000000'),
          invocation: {
            entryId: 'state.equals',
            arguments: {
              key: { _tag: 'literal', value: 'opened' },
              value: { _tag: 'literal', value: true },
            },
          },
        },
      },
    ],
  },
  do: [
    {
      _tag: 'action',
      nodeId: nodeId('60000000-0000-4000-8000-000000000000'),
      invocation: {
        entryId: 'state.set',
        arguments: {
          key: { _tag: 'literal', value: 'opened' },
          value: { _tag: 'literal', value: true },
        },
      },
    },
    {
      _tag: 'branch',
      nodeId: nodeId('70000000-0000-4000-8000-000000000000'),
      condition: {
        _tag: 'condition',
        nodeId: nodeId('80000000-0000-4000-8000-000000000000'),
        invocation: {
          entryId: 'state.equals',
          arguments: {
            key: { _tag: 'literal', value: 'opened' },
            value: { _tag: 'literal', value: false },
          },
        },
      },
      then: [
        {
          _tag: 'action',
          nodeId: nodeId('90000000-0000-4000-8000-000000000000'),
          invocation: {
            entryId: 'world.open',
            arguments: { doorId: { _tag: 'literal', value: 'vault-door' } },
          },
        },
      ],
      else: [],
    },
  ],
});

const importArtifact = async (artifact: CompiledBehaviorModule): Promise<LoadedBehaviorModule> => {
  const url = `data:text/javascript;base64,${Buffer.from(artifact.code).toString('base64')}`;
  const namespace = (await import(url)) as Readonly<Record<string, unknown>>;
  const loaded = loadBehaviorModuleNamespace({ artifact, code: artifact.code, namespace });
  if (!loaded.ok) throw new Error(loaded.diagnostic.message);
  return loaded.loaded;
};

describe('visual to TypeScript conversion', () => {
  it('emits stable readable SDK source and preserves the canonical behavior id', () => {
    const source = generateTypeScriptBehaviorSource({
      definition,
      registry,
      requiredCapabilities: ['world.zones', 'inventory.core', 'world.zones'],
    });
    expect(
      generateTypeScriptBehaviorSource({
        definition,
        registry,
        requiredCapabilities: ['world.zones', 'inventory.core', 'world.zones'],
      }),
    ).toBe(source);
    expect(source).toContain(
      `import { defineBehavior, refs as gameRefs } from '@tileborne/game-sdk';`,
    );
    expect(source).toContain(`id: "${ID}"`);
    expect(source).toContain(
      `asset1: gameRefs.asset("asset:30000000-0000-4000-8000-000000000000")`,
    );
    expect(source).toContain(`context.query["inventory.has"](`);
    expect(source).toContain(`context.state.set("opened", true)`);
    expect(source).toContain(`...(Object.is(`);
    expect(source.match(/"world\.zones"/gu)).toHaveLength(1);
  });

  it('compiles and produces the same deterministic trace as its visual source', async () => {
    const source = generateTypeScriptBehaviorSource({
      definition,
      registry,
      requiredCapabilities: [],
    });
    const visual = compileVisualBehavior({
      definition,
      definitionPath: 'behaviors/sources/door.behavior.json',
      registry,
    });
    const typescript = await compileTypeScriptBehavior({
      behaviorId: ID,
      projectRoot,
      entryFile,
      files: [{ fileName: entryFile, sourceText: source }],
    });
    expect(visual.ok).toBe(true);
    expect(typescript.ok).toBe(true);
    if (!visual.ok || !typescript.ok) return;
    const run = async (artifact: CompiledBehaviorModule) => {
      const scheduler = new DeterministicBehaviorScheduler({
        queries: { 'inventory.has': () => true },
      });
      scheduler.register(await importArtifact(artifact));
      return scheduler.dispatch('world.entered', { playerId: 'player-1', zoneId: 'vault' });
    };
    const visualTrace = await run(visual.artifact);
    const typescriptTrace = await run(typescript.artifact);
    expect(typescriptTrace.map(({ commands, state }) => ({ commands, state }))).toEqual(
      visualTrace.map(({ commands, state }) => ({ commands, state })),
    );
  });

  it('rejects stale registry entries instead of emitting source that cannot run', () => {
    expect(() =>
      generateTypeScriptBehaviorSource({
        definition,
        registry: Schema.decodeUnknownSync(BehaviorRegistryManifest)({
          schemaVersion: 1,
          entries: [],
        }),
        requiredCapabilities: [],
      }),
    ).toThrow('invalid event entry');
  });
});

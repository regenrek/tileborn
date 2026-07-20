import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BEHAVIOR_DEFINITION_SCHEMA_VERSION,
  BEHAVIOR_PACKAGE_SCHEMA_VERSION,
  BehaviorDefinition,
  BehaviorManifest,
  BehaviorRegistryManifest,
  CORE_BEHAVIOR_REGISTRY,
  CORE_BEHAVIOR_TEMPLATES,
  RuntimeBehaviorPackage,
  UnsupportedBehaviorSchemaVersionError,
  decodePersistedBehaviorDefinitionJson,
} from './index.js';

const UUID = '12345678-1234-4234-8234-123456789abc';
const OTHER_UUID = 'aaaaaaaa-1234-4234-8234-123456789abc';

const definitionJson = {
  schemaVersion: BEHAVIOR_DEFINITION_SCHEMA_VERSION,
  id: `behavior:${UUID}`,
  label: 'Open extraction door',
  state: [{ key: 'opened', label: 'Opened', initialValue: false }],
  when: {
    entryId: 'world.player-entered-zone',
    arguments: {
      zone: {
        _tag: 'reference',
        reference: { _tag: 'entity', objectId: `object:${UUID}` },
      },
    },
  },
  if: {
    _tag: 'all',
    nodeId: `behavior-node:${UUID}`,
    conditions: [
      {
        _tag: 'condition',
        nodeId: `behavior-node:${OTHER_UUID}`,
        invocation: {
          entryId: 'inventory.has-item',
          arguments: { item: { _tag: 'literal', value: 'golden-key' } },
        },
      },
    ],
  },
  do: [
    {
      _tag: 'branch',
      nodeId: `behavior-node:${UUID}`,
      condition: {
        _tag: 'not',
        nodeId: `behavior-node:${OTHER_UUID}`,
        condition: {
          _tag: 'condition',
          nodeId: `behavior-node:${UUID}`,
          invocation: {
            entryId: 'state.is-true',
            arguments: { key: { _tag: 'state', key: 'opened' } },
          },
        },
      },
      then: [
        {
          _tag: 'action',
          nodeId: `behavior-node:${OTHER_UUID}`,
          invocation: {
            entryId: 'world.open-door',
            arguments: {
              door: {
                _tag: 'reference',
                reference: { _tag: 'entity', objectId: `object:${OTHER_UUID}` },
              },
            },
          },
        },
      ],
    },
  ],
};

describe('behavior contracts', () => {
  it('round-trips nested visual WHEN/IF/DO resources through the canonical decoder', () => {
    const decoded = decodePersistedBehaviorDefinitionJson(definitionJson);
    const encoded = Schema.encodeSync(BehaviorDefinition)(decoded);
    expect(
      Schema.encodeSync(BehaviorDefinition)(decodePersistedBehaviorDefinitionJson(encoded)),
    ).toEqual(encoded);
  });

  it('fails future versions until an explicit migration is added', () => {
    expect(() =>
      decodePersistedBehaviorDefinitionJson({ ...definitionJson, schemaVersion: 2 }),
    ).toThrow(UnsupportedBehaviorSchemaVersionError);
  });

  it('makes visual and TypeScript manifests mutually exclusive source variants', () => {
    const visual = Schema.decodeUnknownSync(BehaviorManifest)({
      schemaVersion: 1,
      id: `behavior:${UUID}`,
      label: 'Visual',
      source: { _tag: 'visual', definitionPath: 'behaviors/open-door.behavior.json' },
      requiredCapabilities: ['world.doors'],
    });
    const typescript = Schema.decodeUnknownSync(BehaviorManifest)({
      schemaVersion: 1,
      id: `behavior:${OTHER_UUID}`,
      label: 'Code',
      source: {
        _tag: 'typescript',
        sourcePath: 'src/behaviors/open-door.ts',
        exportName: 'default',
      },
      requiredCapabilities: ['world.doors'],
    });

    expect(visual.source._tag).toBe('visual');
    expect(typescript.source._tag).toBe('typescript');
    expect(() =>
      Schema.decodeUnknownSync(BehaviorManifest)({
        ...Schema.encodeSync(BehaviorManifest)(visual),
        source: { _tag: 'hybrid', sourcePath: 'x.ts', definitionPath: 'x.json' },
      }),
    ).toThrow();
  });

  it('round-trips registry metadata and runtime package payloads', () => {
    const registry = Schema.decodeUnknownSync(BehaviorRegistryManifest)({
      schemaVersion: 1,
      entries: [
        {
          id: 'world.player-entered-zone',
          kind: 'event',
          label: 'Player entered zone',
          category: 'World',
          description: 'Canonical gameplay event exposed to behavior authoring.',
          capability: 'world.zones',
          inputs: [],
          outputs: [
            {
              key: 'player',
              label: 'Player',
              valueKind: 'entity-reference',
              required: true,
            },
          ],
        },
      ],
    });
    expect(
      Schema.decodeUnknownSync(BehaviorRegistryManifest)(
        Schema.encodeSync(BehaviorRegistryManifest)(registry),
      ),
    ).toEqual(registry);

    const definition = decodePersistedBehaviorDefinitionJson(definitionJson);
    const payload = Schema.decodeUnknownSync(RuntimeBehaviorPackage)({
      schemaVersion: BEHAVIOR_PACKAGE_SCHEMA_VERSION,
      manifests: [
        {
          schemaVersion: 1,
          id: `behavior:${UUID}`,
          label: definition.label,
          source: { _tag: 'visual', definitionPath: 'behaviors/open-door.behavior.json' },
          requiredCapabilities: ['world.doors'],
        },
      ],
      visualDefinitions: [Schema.encodeSync(BehaviorDefinition)(definition)],
      modules: [
        {
          behaviorId: `behavior:${UUID}`,
          sourceKind: 'visual',
          modulePath: 'behaviors/modules/open-door.mjs',
          hash: `sha256:${'a'.repeat(64)}`,
        },
      ],
    });
    expect(
      Schema.decodeUnknownSync(RuntimeBehaviorPackage)(
        Schema.encodeSync(RuntimeBehaviorPackage)(payload),
      ),
    ).toEqual(payload);
  });

  it('exposes game-shell events and actions through the core behavior registry', () => {
    expect(CORE_BEHAVIOR_REGISTRY.entries.map((entry) => String(entry.id))).toEqual(
      expect.arrayContaining(['shell.event', 'shell.invoke-action', 'shell.emit-event']),
    );
    expect(
      CORE_BEHAVIOR_TEMPLATES.some((template) => String(template.id) === 'shell.on-shell-event'),
    ).toBe(true);
  });
});

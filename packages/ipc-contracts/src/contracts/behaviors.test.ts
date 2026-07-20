import {
  CORE_BEHAVIOR_REGISTRY,
  CORE_BEHAVIOR_TEMPLATES,
  makeBehaviorId,
  makeProjectId,
  type Uuid,
} from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BehaviorsCreateVisualRequest,
  BehaviorsConvertToTypeScriptRequest,
  BehaviorsReferencesRequest,
  BehaviorsResolveReferencesRequest,
  BehaviorsReferencesResponse,
  BehaviorsRegistryResponse,
  BehaviorsSaveVisualRequest,
  BehaviorsSaveTypeScriptRequest,
} from './behaviors.js';
import { MainIpcRegistry } from './main-registry.js';

const uuid = (tail: string): Uuid => `00000000-0000-4000-8000-${tail.padStart(12, '0')}` as Uuid;

describe('behavior authoring IPC contracts', () => {
  it('publishes the complete CRUD and registry channel family', () => {
    expect(MainIpcRegistry.contracts.map(({ channel }) => channel)).toEqual(
      expect.arrayContaining([
        'tileborne:behaviors:open',
        'tileborne:behaviors:createVisual',
        'tileborne:behaviors:saveVisual',
        'tileborne:behaviors:convertToTypeScript',
        'tileborne:behaviors:saveTypeScript',
        'tileborne:behaviors:remove',
        'tileborne:behaviors:registry',
        'tileborne:behaviors:references',
        'tileborne:behaviors:resolveReferences',
      ]),
    );
  });

  it('round-trips the declarative registry and rejects malformed visual saves', () => {
    const response = Schema.decodeUnknownSync(BehaviorsRegistryResponse)({
      registry: CORE_BEHAVIOR_REGISTRY,
      templates: CORE_BEHAVIOR_TEMPLATES,
      entryOwners: Object.fromEntries(CORE_BEHAVIOR_REGISTRY.entries.map(({ id }) => [id, 'core'])),
      templateOwners: Object.fromEntries(CORE_BEHAVIOR_TEMPLATES.map(({ id }) => [id, 'core'])),
    });
    expect(response.templates.map(({ id }) => id)).toEqual([
      'core.on-start',
      'core.repeating-timer',
      'shell.on-shell-event',
    ]);
    expect(response.templates.find(({ id }) => id === 'shell.on-shell-event')).toMatchObject({
      category: 'Game Shell',
      requiredCapabilities: ['shell.navigation'],
      when: { entryId: 'shell.event', arguments: {} },
    });
    expect('references' in response).toBe(false);
    const references = Schema.decodeUnknownSync(BehaviorsReferencesResponse)({
      kind: 'asset',
      query: '',
      offset: 0,
      limit: 32,
      total: 0,
      options: [],
    });
    expect(references.options).toEqual([]);
    expect(() =>
      Schema.decodeUnknownSync(BehaviorsReferencesRequest)({
        projectId: makeProjectId(uuid('1')),
        kind: 'asset',
        limit: 65,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(BehaviorsResolveReferencesRequest)({
        projectId: makeProjectId(uuid('1')),
        references: Array.from({ length: 65 }, () => ({
          _tag: 'behavior',
          behaviorId: makeBehaviorId(uuid('2')),
        })),
      }),
    ).toThrow();
    const projectId = makeProjectId(uuid('1'));
    const create = Schema.decodeUnknownSync(BehaviorsCreateVisualRequest)({
      projectId,
      label: 'Start',
      definition: {
        state: [],
        when: { entryId: 'lifecycle.started', arguments: {} },
        do: [],
      },
    });
    expect(create.definition.when.entryId).toBe('lifecycle.started');
    expect(
      Schema.decodeUnknownSync(BehaviorsConvertToTypeScriptRequest)({
        projectId,
        behaviorId: makeBehaviorId(uuid('2')),
        expectedRevision: 1,
      }).expectedRevision,
    ).toBe(1);
    expect(
      Schema.decodeUnknownSync(BehaviorsSaveTypeScriptRequest)({
        projectId,
        behaviorId: makeBehaviorId(uuid('2')),
        expectedRevision: 1,
        label: 'Script',
        source: 'export default {};',
        exportName: 'default',
      }).exportName,
    ).toBe('default');
    expect(() =>
      Schema.decodeUnknownSync(BehaviorsSaveVisualRequest)({
        projectId,
        behaviorId: makeBehaviorId(uuid('2')),
        expectedRevision: -1,
        label: 'Broken',
        definition: {},
      }),
    ).toThrow();
  });
});

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeGameObjectTypeId,
  makeItemDefinitionId,
  makeLootTableId,
  makeProjectId,
} from '@tileborne/core';

import {
  CatalogContracts,
  CatalogExportContract,
  CatalogImportContract,
  CatalogIpcRegistry,
  CatalogRemoveTypeContract,
  CatalogResolveContract,
  CatalogUpsertTypeContract,
  CatalogValidateContract,
} from './catalog.ts';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const projectId = makeProjectId(UUID);
const objectTypeId = makeGameObjectTypeId(UUID);
const lootTableId = makeLootTableId(UUID);
const itemId = makeItemDefinitionId(UUID);

const pluginGameObjectType = {
  id: objectTypeId,
  schemaVersion: 1,
  label: 'spawn point',
  family: 'gameplay',
  category: 'markers',
  layerHint: 'objects',
  components: [{ _tag: 'spawn-point', data: {} }],
  instanceDefaults: {},
};

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe('catalog IPC contracts', () => {
  it('registers all catalog channels with the expected naming', () => {
    expect(CatalogContracts).toHaveLength(9);
    expect(Object.keys(CatalogIpcRegistry.byChannel).sort()).toEqual([
      'tileborne:catalog:duplicateDefinition',
      'tileborne:catalog:export',
      'tileborne:catalog:import',
      'tileborne:catalog:removeDefinition',
      'tileborne:catalog:removeType',
      'tileborne:catalog:resolve',
      'tileborne:catalog:upsertDefinition',
      'tileborne:catalog:upsertType',
      'tileborne:catalog:validate',
    ]);
  });

  it('flags only the import contract as requiresApproval', () => {
    expect(CatalogImportContract.meta?.requiresApproval).toBe(true);
    expect(CatalogResolveContract.meta?.requiresApproval).toBeUndefined();
    expect(CatalogValidateContract.meta?.requiresApproval).toBeUndefined();
    expect(CatalogExportContract.meta?.requiresApproval).toBeUndefined();
  });

  it('round-trips the resolve projection reusing core catalog schemas', () => {
    roundTrip(CatalogResolveContract.request, { projectId });
    roundTrip(CatalogResolveContract.response, {
      objectTypes: [
        {
          objectType: pluginGameObjectType,
          origin: 'plugin',
          sourcePluginId: '@tileborne/plugin-x',
        },
        { objectType: pluginGameObjectType, origin: 'project' },
      ],
      lootTables: [{ id: lootTableId, label: 'common', entries: [] }],
      items: [{ id: itemId, label: 'potion', category: 'consumable', data: {} }],
      weapons: [],
      definitionProvenance: {},
    });
  });

  it('rejects an unknown catalog entry origin at the boundary', () => {
    expect(() =>
      Schema.decodeUnknownSync(CatalogResolveContract.response)({
        objectTypes: [{ objectType: pluginGameObjectType, origin: 'engine' }],
        lootTables: [],
        items: [],
        weapons: [],
        definitionProvenance: {},
      }),
    ).toThrow();
  });

  it('round-trips the validation report with structured issues', () => {
    roundTrip(CatalogValidateContract.request, { projectId });
    roundTrip(CatalogValidateContract.response, {
      report: {
        ok: false,
        issues: [
          {
            kind: 'duplicate-type',
            objectTypeId,
            message: `duplicate object type id: ${objectTypeId}`,
          },
          {
            kind: 'unknown-reference',
            refKind: 'loot-source.lootTableId',
            missingId: lootTableId,
            message: 'references unknown loot table',
          },
          { kind: 'coherence', message: 'duplicate component "loot-source"' },
        ],
      },
    });
  });

  it('round-trips import/export with raw catalog json payloads', () => {
    roundTrip(CatalogImportContract.request, {
      projectId,
      catalogJson: { id: 'catalog:bad', objectTypes: [] },
    });
    roundTrip(CatalogImportContract.response, {
      imported: false,
      report: { ok: false, issues: [{ kind: 'coherence', message: 'invalid pack' }] },
    });
    roundTrip(CatalogExportContract.request, { projectId });
    roundTrip(CatalogExportContract.response, {
      catalogJson: { id: 'catalog:project', schemaVersion: 1, objectTypes: [] },
    });
  });

  it('round-trips upsertType/removeType for the entity editor authoring loop', () => {
    roundTrip(CatalogUpsertTypeContract.request, {
      projectId,
      objectTypeJson: pluginGameObjectType,
    });
    roundTrip(CatalogUpsertTypeContract.response, {
      saved: true,
      report: { ok: true, issues: [] },
    });
    roundTrip(CatalogRemoveTypeContract.request, { projectId, objectTypeId });
    roundTrip(CatalogRemoveTypeContract.response, { removed: true });
  });
});

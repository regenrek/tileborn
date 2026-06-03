import {
  GameObjectCatalog,
  GameObjectType,
  ItemDefinition,
  LootSourceComponent,
  LootTable,
  type PluginId,
  makeCatalogId,
  makeGameObjectTypeId,
  makeItemDefinitionId,
  makeLootTableId,
  type Uuid,
} from '@tileborne/core';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  buildResolveProjection,
  buildValidationReport,
  type CatalogContributionSource,
} from './catalog-projection.js';

const UUID = (suffix: string): Uuid =>
  `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;

const PLUGIN_ID = '@tileborne/plugin-test' as unknown as PluginId;

const objectType = (
  uuid: string,
  components: GameObjectType['components'] = [],
): GameObjectType =>
  new GameObjectType({
    id: makeGameObjectTypeId(UUID(uuid)),
    schemaVersion: 1,
    label: `type-${uuid}`,
    family: 'obstacle' as GameObjectType['family'],
    category: Option.none(),
    layerHint: Option.none(),
    components,
    instanceDefaults: {},
  });

const catalog = (
  uuid: string,
  objectTypes: readonly GameObjectType[],
  lootTables?: readonly LootTable[],
  items?: readonly ItemDefinition[],
): GameObjectCatalog =>
  new GameObjectCatalog({
    id: makeCatalogId(UUID(uuid)),
    schemaVersion: 1,
    objectTypes: [...objectTypes],
    lootTables: lootTables === undefined ? Option.none() : Option.some([...lootTables]),
    items: items === undefined ? Option.none() : Option.some([...items]),
  });

describe('buildResolveProjection', () => {
  it('merges plugin + project catalogs and tags entry origins', () => {
    const lootTable = new LootTable({ id: makeLootTableId(UUID('1')), label: 'common', entries: [] });
    const item = new ItemDefinition({
      id: makeItemDefinitionId(UUID('2')),
      label: 'potion',
      category: Option.none(),
      data: {},
    });
    const sources: readonly CatalogContributionSource[] = [
      {
        contributionId: 'plugin#cat',
        catalog: catalog('a', [objectType('10')], [lootTable], [item]),
        origin: 'plugin',
        sourcePluginId: PLUGIN_ID,
      },
      {
        contributionId: 'project-catalog-fragment',
        catalog: catalog('b', [objectType('11')]),
        origin: 'project',
      },
    ];

    const projection = buildResolveProjection(sources);

    expect(projection.objectTypes).toHaveLength(2);
    const byId = new Map(projection.objectTypes.map((entry) => [entry.objectType.id, entry]));
    expect(byId.get(makeGameObjectTypeId(UUID('10')))).toMatchObject({
      origin: 'plugin',
      sourcePluginId: PLUGIN_ID,
    });
    const projectEntry = byId.get(makeGameObjectTypeId(UUID('11')));
    expect(projectEntry?.origin).toBe('project');
    expect(projectEntry?.sourcePluginId).toBeUndefined();
    expect(projection.lootTables.map((table) => table.id)).toEqual([lootTable.id]);
    expect(projection.items.map((entry) => entry.id)).toEqual([item.id]);
  });

  it('degrades to a first-wins view when the merge fails on a duplicate id', () => {
    const duplicate = '20';
    const sources: readonly CatalogContributionSource[] = [
      {
        contributionId: 'plugin#cat',
        catalog: catalog('a', [objectType(duplicate)]),
        origin: 'plugin',
        sourcePluginId: PLUGIN_ID,
      },
      {
        contributionId: 'project-catalog-fragment',
        catalog: catalog('b', [objectType(duplicate)]),
        origin: 'project',
      },
    ];

    const projection = buildResolveProjection(sources);

    expect(projection.objectTypes).toHaveLength(1);
    expect(projection.objectTypes[0]?.origin).toBe('plugin');
  });
});

describe('buildValidationReport', () => {
  it('passes a coherent plugin + project catalog', () => {
    const sources: readonly CatalogContributionSource[] = [
      {
        contributionId: 'plugin#cat',
        catalog: catalog('a', [objectType('30')]),
        origin: 'plugin',
        sourcePluginId: PLUGIN_ID,
      },
      {
        contributionId: 'project-catalog-fragment',
        catalog: catalog('b', [objectType('31')]),
        origin: 'project',
      },
    ];

    expect(buildValidationReport(sources)).toEqual({ ok: true, issues: [] });
  });

  it('surfaces duplicate-type and unknown-reference issues', () => {
    const duplicate = '40';
    const danglingLoot = makeLootTableId(UUID('99'));
    const sources: readonly CatalogContributionSource[] = [
      {
        contributionId: 'plugin#cat',
        catalog: catalog('a', [objectType(duplicate)]),
        origin: 'plugin',
        sourcePluginId: PLUGIN_ID,
      },
      {
        contributionId: 'project-catalog-fragment',
        catalog: catalog('b', [
          objectType(duplicate),
          objectType('41', [
            new LootSourceComponent({
              lootTableId: Option.some(danglingLoot),
              interactionMode: 'tap',
              grants: {},
            }),
          ]),
        ]),
        origin: 'project',
      },
    ];

    const report = buildValidationReport(sources);

    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.kind === 'duplicate-type')).toBe(true);
    const unknownRef = report.issues.find((issue) => issue.kind === 'unknown-reference');
    expect(unknownRef?.refKind).toBe('loot-source.lootTableId');
    expect(unknownRef?.missingId).toBe(danglingLoot);
  });
});

import {
  GameObjectCatalog,
  GameObjectType,
  ItemDefinition,
  LootSourceComponent,
  LootTable,
  type PluginId,
  WeaponRefComponent,
  makeCatalogId,
  makeGameObjectTypeId,
  makeItemDefinitionId,
  makeLootTableId,
  makeWeaponDefinitionId,
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

const objectType = (uuid: string, components: GameObjectType['components'] = []): GameObjectType =>
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
    const lootTable = new LootTable({
      id: makeLootTableId(UUID('1')),
      label: 'common',
      entries: [],
    });
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

  it('resolves weapon-ref weaponIds against the injected weapon registry (ADR-0028)', () => {
    const weaponId = makeWeaponDefinitionId(UUID('50'));
    const sources: readonly CatalogContributionSource[] = [
      {
        contributionId: 'plugin#cat',
        catalog: catalog('a', [objectType('51', [new WeaponRefComponent({ weaponId })])]),
        origin: 'plugin',
        sourcePluginId: PLUGIN_ID,
      },
    ];

    expect(buildValidationReport(sources, { weaponIds: new Set([String(weaponId)]) })).toEqual({
      ok: true,
      issues: [],
    });
    const failing = buildValidationReport(sources, { weaponIds: new Set() });
    expect(failing.ok).toBe(false);
    // Skipped entirely when the caller has no weapon knowledge.
    expect(buildValidationReport(sources)).toEqual({ ok: true, issues: [] });
  });

  it('emits structured, navigable weapon-ref issues (weaponId + companions)', () => {
    const weaponId = makeWeaponDefinitionId(UUID('60'));
    const knownCompanion = makeGameObjectTypeId(UUID('62'));
    const missingCompanion = makeGameObjectTypeId(UUID('63'));
    const weaponEntity = objectType('61', [
      new WeaponRefComponent({
        weaponId,
        projectileEntityId: knownCompanion,
        muzzleFlashEntityId: missingCompanion,
      }),
    ]);
    const sources: readonly CatalogContributionSource[] = [
      {
        contributionId: 'project-catalog-fragment',
        catalog: catalog('b', [weaponEntity, objectType('62')]),
        origin: 'project',
      },
    ];

    const report = buildValidationReport(sources, { weaponIds: new Set() });

    expect(report.ok).toBe(false);
    const weaponIssue = report.issues.find((issue) => issue.refKind === 'weapon-ref.weaponId');
    expect(weaponIssue).toMatchObject({
      kind: 'unknown-reference',
      objectTypeId: weaponEntity.id,
      missingId: String(weaponId),
    });
    const companionIssue = report.issues.find(
      (issue) => issue.refKind === 'weapon-ref.muzzleFlashEntityId',
    );
    expect(companionIssue).toMatchObject({
      kind: 'unknown-reference',
      objectTypeId: weaponEntity.id,
      missingId: String(missingCompanion),
    });
    // The resolving companion stays clean.
    expect(report.issues.some((issue) => issue.refKind === 'weapon-ref.projectileEntityId')).toBe(
      false,
    );
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

  it('reports creator-actionable invalid item references and weights in loot tables', () => {
    const missingItem = makeItemDefinitionId(UUID('91'));
    const table = new LootTable({
      id: makeLootTableId(UUID('92')),
      label: 'Broken drops',
      entries: [{ itemId: missingItem, tier: 'rare', weight: 0 }],
    });
    const report = buildValidationReport([
      {
        contributionId: 'project-catalog-fragment',
        catalog: catalog('c', [], [table]),
        origin: 'project',
      },
    ]);

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unknown-reference',
          refKind: 'item',
          missingId: String(missingItem),
        }),
        expect.objectContaining({
          kind: 'coherence',
          message: expect.stringContaining('positive drop weight'),
        }),
      ]),
    );
  });
});

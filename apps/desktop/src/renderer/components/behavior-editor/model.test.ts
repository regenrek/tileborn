// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BehaviorDefinition,
  BehaviorInvocation,
  ReferenceBehaviorValue,
  AssetBehaviorReference,
  CatalogBehaviorReference,
  EntityBehaviorReference,
  NestedBehaviorReference,
  BehaviorRegistryEntry,
  BehaviorRegistryManifest,
  BehaviorTemplate,
  BehaviorTemplateInvocation,
  CORE_BEHAVIOR_REGISTRY,
  CORE_BEHAVIOR_TEMPLATES,
  makeBehaviorId,
  makeBehaviorNodeId,
  makeAssetId,
  makeGameObjectTypeId,
  makeObjectId,
  type Uuid,
} from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { createEditorHistory, reduceEditorHistory } from './history';
import {
  decodeVisualBehaviorDraft,
  behaviorReferencesForDraft,
  fromBehaviorDefinition,
  instantiateBehaviorTemplate,
  requiredCapabilitiesForDraft,
  shouldShowBehaviorEditorLoading,
  toBehaviorDefinition,
  validateBehaviorDraft,
} from './model';

const uuid = (tail: string): Uuid => `00000000-0000-4000-8000-${tail.padStart(12, '0')}` as Uuid;

describe('visual behavior editor model', () => {
  it('keeps a mutation-owned snapshot visible during background query refetch', () => {
    expect(shouldShowBehaviorEditorLoading(true, false, true)).toBe(false);
    expect(shouldShowBehaviorEditorLoading(true, false, false)).toBe(true);
    expect(shouldShowBehaviorEditorLoading(false, true, true)).toBe(true);
  });

  const fixture = async (name: 'plugin-battle-royale' | 'plugin-example-arena') =>
    JSON.parse(
      await readFile(
        path.resolve(process.cwd(), `../../packages/${name}/tileborne-plugin.json`),
        'utf8',
      ),
    ) as {
      readonly contributes: {
        readonly behaviorEntries: unknown;
        readonly behaviorTemplates: unknown;
      };
    };

  it('instantiates declarative templates into the same canonical definition', () => {
    const draft = instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[1]!, CORE_BEHAVIOR_REGISTRY);
    const definition = toBehaviorDefinition(makeBehaviorId(uuid('1')), draft);
    expect(definition).toBeInstanceOf(BehaviorDefinition);
    expect(definition.when.entryId).toBe('lifecycle.started');
    expect(definition.do[0]).toMatchObject({
      _tag: 'action',
      invocation: { entryId: 'timer.every', arguments: { ticks: { value: 60 } } },
    });
    expect(validateBehaviorDraft(draft, CORE_BEHAVIOR_REGISTRY)).toEqual([]);
  });

  it('validates nested branches, duplicate identities, block kinds and typed arguments', () => {
    const draft = instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, CORE_BEHAVIOR_REGISTRY);
    const duplicateId = makeBehaviorNodeId(uuid('2'));
    const invalid = {
      ...draft,
      do: [
        {
          _tag: 'branch' as const,
          nodeId: duplicateId,
          condition: { _tag: 'all' as const, nodeId: duplicateId, conditions: [] },
          then: [
            {
              _tag: 'action' as const,
              nodeId: makeBehaviorNodeId(uuid('3')),
              invocation: draft.when,
            },
          ],
          else: [],
        },
      ],
    };
    expect(
      validateBehaviorDraft(invalid, CORE_BEHAVIOR_REGISTRY).map(({ message }) => message),
    ).toEqual(
      expect.arrayContaining([
        'Duplicate block identity',
        'ALL needs at least one condition',
        'Behavior started is not a action block',
      ]),
    );
  });

  it('discovers capabilities from plugin blocks without a genre switch', () => {
    const pluginEntry = new BehaviorRegistryEntry({
      ...CORE_BEHAVIOR_REGISTRY.entries.find(({ id }) => id === 'state.set')!,
      id: 'example-arena.spawn-enemy' as never,
      capability: 'example-arena.combat' as never,
      label: 'Spawn enemy',
    });
    const registry = new BehaviorRegistryManifest({
      schemaVersion: 1,
      entries: [...CORE_BEHAVIOR_REGISTRY.entries, pluginEntry],
    });
    const template = new BehaviorTemplate({
      id: 'example-arena.wave' as never,
      label: 'Wave',
      description: 'Neutral fixture',
      category: 'Arena',
      requiredCapabilities: ['example-arena.combat' as never],
      when: new BehaviorTemplateInvocation({
        entryId: 'lifecycle.started' as never,
        arguments: {},
      }),
      do: [
        new BehaviorTemplateInvocation({
          entryId: pluginEntry.id,
          arguments: { key: 'enemy', value: 1 },
        }),
      ],
    });
    const draft = instantiateBehaviorTemplate(template, registry);
    expect(requiredCapabilitiesForDraft(draft, registry)).toEqual([
      'example-arena.combat',
      'lifecycle.core',
    ]);
  });

  it('authors and reopens the real Battle Royale and neutral Arena templates with typed catalog references', async () => {
    const [battleRoyale, arena] = await Promise.all([
      fixture('plugin-battle-royale'),
      fixture('plugin-example-arena'),
    ]);
    const entries = Schema.decodeUnknownSync(Schema.Array(BehaviorRegistryEntry))([
      ...CORE_BEHAVIOR_REGISTRY.entries,
      ...Schema.decodeUnknownSync(Schema.Array(BehaviorRegistryEntry))(
        battleRoyale.contributes.behaviorEntries,
      ),
      ...Schema.decodeUnknownSync(Schema.Array(BehaviorRegistryEntry))(
        arena.contributes.behaviorEntries,
      ),
    ]);
    const templates = Schema.decodeUnknownSync(Schema.Array(BehaviorTemplate))([
      ...Schema.decodeUnknownSync(Schema.Array(BehaviorTemplate))(
        battleRoyale.contributes.behaviorTemplates,
      ),
      ...Schema.decodeUnknownSync(Schema.Array(BehaviorTemplate))(
        arena.contributes.behaviorTemplates,
      ),
    ]);
    const registry = new BehaviorRegistryManifest({ schemaVersion: 1, entries });
    const objectTypeId = makeGameObjectTypeId(uuid('99'));
    const catalog = new CatalogBehaviorReference({ objectTypeId });
    const firstEntity = new EntityBehaviorReference({ objectId: makeObjectId(uuid('97')) });
    for (const template of templates) {
      const draft = instantiateBehaviorTemplate(template, registry, {
        catalog: [catalog],
        entity: [firstEntity],
      });
      expect(
        validateBehaviorDraft(draft, registry, { catalog: new Set([String(objectTypeId)]) }),
      ).toEqual([]);
      const saved = toBehaviorDefinition(
        makeBehaviorId(uuid(String(templates.indexOf(template) + 20))),
        draft,
      );
      const reopened = fromBehaviorDefinition(saved, draft.requiredCapabilities);
      expect(reopened).toEqual(draft);
      if (String(template.id) === 'battle-royale.final-player-reward') {
        expect(draft.when.arguments.player).toBeUndefined();
      }
      expect(draft.do[0]).toMatchObject({
        invocation: { arguments: { objectType: { _tag: 'reference' } } },
      });
    }
  });

  it('decodes recovery snapshots and rejects malformed drafts before state replacement', () => {
    const draft = instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, CORE_BEHAVIOR_REGISTRY);
    expect(decodeVisualBehaviorDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(() => decodeVisualBehaviorDraft({ ...draft, do: [{ surprise: true }] })).toThrow();
  });

  it('hydrates, validates, saves, and reopens selected references for all four kinds', () => {
    const references = Array.from({ length: 129 }, (_, index) => {
      const id = uuid(String(401 + index));
      switch (index % 4) {
        case 0:
          return new EntityBehaviorReference({ objectId: makeObjectId(id) });
        case 1:
          return new AssetBehaviorReference({ assetId: makeAssetId(id) });
        case 2:
          return new CatalogBehaviorReference({ objectTypeId: makeGameObjectTypeId(id) });
        default:
          return new NestedBehaviorReference({ behaviorId: makeBehaviorId(id) });
      }
    });
    const kinds = [
      'entity-reference',
      'asset-reference',
      'catalog-reference',
      'behavior-reference',
    ] as const;
    const entries = references.map(
      (reference, index) =>
        new BehaviorRegistryEntry({
          id: `test.reference-${index}` as never,
          kind: 'action',
          label: `Reference ${index}`,
          category: 'Test',
          description: 'Reference hydration fixture',
          capability: 'test.references' as never,
          inputs: [
            { key: 'target', label: 'Target', valueKind: kinds[index % 4]!, required: true },
          ],
          outputs: [],
        }),
    );
    const registry = new BehaviorRegistryManifest({
      schemaVersion: 1,
      entries: [...CORE_BEHAVIOR_REGISTRY.entries, ...entries],
    });
    const base = instantiateBehaviorTemplate(CORE_BEHAVIOR_TEMPLATES[0]!, registry);
    const draft = {
      ...base,
      do: entries.map((entry, index) => ({
        _tag: 'action' as const,
        nodeId: makeBehaviorNodeId(uuid(String(1_000 + index))),
        invocation: new BehaviorInvocation({
          entryId: entry.id,
          arguments: { target: new ReferenceBehaviorValue({ reference: references[index]! }) },
        }),
      })),
    };

    expect(behaviorReferencesForDraft(draft)).toEqual(references);
    expect(
      validateBehaviorDraft(draft, registry, {
        entity: new Set(
          references.flatMap((reference) =>
            reference._tag === 'entity' ? [String(reference.objectId)] : [],
          ),
        ),
        asset: new Set(
          references.flatMap((reference) =>
            reference._tag === 'asset' ? [String(reference.assetId)] : [],
          ),
        ),
        catalog: new Set(
          references.flatMap((reference) =>
            reference._tag === 'catalog' ? [String(reference.objectTypeId)] : [],
          ),
        ),
        behavior: new Set(
          references.flatMap((reference) =>
            reference._tag === 'behavior' ? [String(reference.behaviorId)] : [],
          ),
        ),
      }),
    ).toEqual([]);
    expect(
      validateBehaviorDraft(draft, registry, {
        entity: new Set(),
        asset: new Set(),
        catalog: new Set(),
        behavior: new Set(),
      }).filter(({ message }) => message.includes('points to a missing')),
    ).toHaveLength(129);

    const saved = toBehaviorDefinition(makeBehaviorId(uuid('405')), draft);
    const reopened = fromBehaviorDefinition(saved, draft.requiredCapabilities);
    expect(behaviorReferencesForDraft(reopened)).toEqual(references);
    expect(reopened).toEqual(draft);
  });

  it('keeps a bounded undo/redo history and clears redo on a new edit', () => {
    let history = createEditorHistory('a');
    history = reduceEditorHistory(history, { type: 'commit', value: 'b' });
    history = reduceEditorHistory(history, { type: 'undo' });
    expect(history.present).toBe('a');
    history = reduceEditorHistory(history, { type: 'redo' });
    expect(history.present).toBe('b');
    history = reduceEditorHistory(history, { type: 'undo' });
    history = reduceEditorHistory(history, { type: 'commit', value: 'c' });
    expect(history.future).toEqual([]);
  });
});

import { GameObjectCatalog, PluginId } from '@tileborne/core';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodeWeaponCatalog } from './weapon-catalog-registry.js';
import {
  decodeProjectContentDocument,
  PluginTemplateProvenance,
  ProjectContentDocument,
  resolveEffectiveProjectContent,
  runtimeProjectContentFromDocument,
} from './project-content.js';

const UUID = '0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f60';
const WEAPON_ID = `weapon:${UUID}`;

const catalog = (id = `catalog:${UUID}`) =>
  Schema.decodeUnknownSync(GameObjectCatalog)({
    id,
    schemaVersion: 1,
    objectTypes: [],
    lootTables: [],
    items: [],
  });

const weapons = (id = WEAPON_ID) => {
  const decoded = decodeWeaponCatalog('fixture', {
    schemaVersion: 1,
    weapons: [
      {
        weapon: { id, damage: 25, cooldownTicks: 6, magazineSize: 12, reloadTicks: 30 },
        delivery: {
          _tag: 'ProjectileDelivery',
          damage: 25,
          speed: 4,
          ttlTicks: 60,
          radius: 0.5,
          falloff: { _tag: 'NoFalloff' },
          knockback: 0,
        },
        appliesStatus: undefined,
      },
    ],
  });
  if (Result.isFailure(decoded)) throw new Error(decoded.failure.message);
  return decoded.success;
};

describe('ProjectContentDocument', () => {
  it('migrates a legacy GameObjectCatalog without creating a second catalog owner', () => {
    const result = decodeProjectContentDocument(
      Schema.encodeUnknownSync(GameObjectCatalog)(catalog()),
    );
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.catalog.id).toBe(`catalog:${UUID}`);
      expect(result.success.weapons.weapons).toEqual([]);
      expect(result.success.schemaVersion).toBe(1);
    }
  });

  it('keeps immutable template provenance in the versioned persisted document', () => {
    const document = new ProjectContentDocument({
      schemaVersion: 1,
      catalog: catalog(),
      weapons: weapons(),
      weaponLabels: { [WEAPON_ID]: 'Pulse rifle' },
      provenance: {
        [WEAPON_ID]: new PluginTemplateProvenance({
          pluginId: Schema.decodeUnknownSync(PluginId)('@tileborne/plugin-battle-royale'),
          templateId: 'weapon:assault-rifle',
        }),
      },
    });
    const roundTrip = Schema.decodeUnknownSync(ProjectContentDocument)(
      Schema.encodeUnknownSync(ProjectContentDocument)(document),
    );
    expect(roundTrip.provenance[WEAPON_ID]?._tag).toBe('plugin-template');
    expect(roundTrip.weaponLabels[WEAPON_ID]).toBe('Pulse rifle');
  });

  it('rejects current documents with incomplete provenance and packages complete runtime provenance', () => {
    const incomplete = new ProjectContentDocument({
      schemaVersion: 1,
      catalog: catalog(),
      weapons: weapons(),
      weaponLabels: {},
      provenance: {},
    });
    const decoded = decodeProjectContentDocument(
      Schema.encodeUnknownSync(ProjectContentDocument)(incomplete),
    );
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure.message).toContain('missing provenance');
    }

    const complete = new ProjectContentDocument({
      ...incomplete,
      provenance: {
        [WEAPON_ID]: new PluginTemplateProvenance({
          pluginId: Schema.decodeUnknownSync(PluginId)('@tileborne/plugin-battle-royale'),
          templateId: 'weapon:template',
        }),
      },
    });
    const runtime = runtimeProjectContentFromDocument(complete);
    expect(runtime.weapons).toHaveLength(1);
    expect(runtime.provenance[WEAPON_ID]?._tag).toBe('plugin-template');
  });

  it('resolves plugin and project weapons once and rejects project shadowing', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne/plugin-battle-royale');
    const project = new ProjectContentDocument({
      schemaVersion: 1,
      catalog: catalog(),
      weapons: weapons(`weapon:0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f61`),
      weaponLabels: {},
      provenance: {},
    });
    const source = {
      pluginId,
      gameObjectCatalogs: [],
      weaponCatalogs: [{ contributionId: 'weapons', catalog: weapons() }],
    };
    const resolved = resolveEffectiveProjectContent([source], project);
    expect(Result.isSuccess(resolved)).toBe(true);
    if (Result.isSuccess(resolved)) {
      expect(resolved.success.weapons.map((entry) => entry.origin)).toEqual(['plugin', 'project']);
      expect(resolved.success.weaponIds.size).toBe(2);
    }

    const collision = new ProjectContentDocument({
      ...project,
      weapons: weapons(),
    });
    expect(Result.isFailure(resolveEffectiveProjectContent([source], collision))).toBe(true);
  });
});

import { readFile } from 'node:fs/promises';

import { CORE_BEHAVIOR_REGISTRY, PluginId } from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { resolveBehaviorAuthoringRegistry } from './behavior-registry.js';
import { PluginContributions } from './contributions.js';

const manifestAt = async (relativePath: string) => {
  const raw = JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8')) as {
    readonly id: string;
    readonly contributes: {
      readonly behaviorEntries?: unknown;
      readonly behaviorTemplates?: unknown;
    };
  };
  return {
    id: Schema.decodeUnknownSync(PluginId)(raw.id),
    contributes: Schema.decodeUnknownSync(PluginContributions)({
      panels: undefined,
      tools: undefined,
      assetPacks: undefined,
      tilesetPacks: undefined,
      behaviorEntries: raw.contributes.behaviorEntries,
      behaviorTemplates: raw.contributes.behaviorTemplates,
      editor: undefined,
      runtime: undefined,
      server: undefined,
    }),
  };
};

describe('resolveBehaviorAuthoringRegistry', () => {
  it('materializes core, Battle Royale, and a neutral second genre without orchestration switches', async () => {
    const [battleRoyale, arena] = await Promise.all([
      manifestAt('../../plugin-battle-royale/tileborne-plugin.json'),
      manifestAt('../../plugin-example-arena/tileborne-plugin.json'),
    ]);
    const effective = resolveBehaviorAuthoringRegistry([
      { pluginId: battleRoyale.id, contributions: battleRoyale.contributes },
      { pluginId: arena.id, contributions: arena.contributes },
    ]);

    expect(effective.registry.entries.map(({ id }) => String(id))).toEqual([
      ...CORE_BEHAVIOR_REGISTRY.entries.map(({ id }) => String(id)),
      'battle-royale.alive-count-at-most',
      'battle-royale.player-eliminated',
      'battle-royale.spawn-loot',
      'example-arena.enemy-defeated',
      'example-arena.spawn-enemy',
    ]);
    expect(effective.templates.map(({ id }) => String(id))).toEqual([
      'core.on-start',
      'core.repeating-timer',
      'battle-royale.final-player-reward',
      'example-arena.next-wave',
    ]);
    expect(effective.entryOwners['battle-royale.spawn-loot']).toBe(battleRoyale.id);
    expect(effective.entryOwners['example-arena.spawn-enemy']).toBe(arena.id);
    expect(effective.capabilities.map(String)).toEqual([
      'lifecycle.core',
      'time.deterministic',
      'state.core',
      'battle-royale.match',
      'battle-royale.loot',
      'example-arena.combat',
    ]);
    expect(effective.capabilityOwners['state.core']).toBe('core');
    expect(effective.capabilityOwners['battle-royale.match']).toBe(battleRoyale.id);
    expect(effective.capabilityOwners['example-arena.combat']).toBe(arena.id);
  });

  it('fails closed on duplicate ids', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/test');
    const duplicate = {
      ...CORE_BEHAVIOR_REGISTRY.entries[0]!,
    };
    expect(() =>
      resolveBehaviorAuthoringRegistry([
        {
          pluginId,
          contributions: {
            behaviorEntries: [duplicate],
          } as never,
        },
      ]),
    ).toThrow(/duplicate behavior registry entry/);
  });

  it('fails closed when a plugin claims another owner capability', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/test');
    expect(() =>
      resolveBehaviorAuthoringRegistry([
        {
          pluginId,
          contributions: {
            behaviorEntries: [{
              ...CORE_BEHAVIOR_REGISTRY.entries[0]!,
              id: 'test.started-alias',
            }],
          } as never,
        },
      ]),
    ).toThrow(/capability lifecycle\.core.*already owned by core/);
  });

  it('fails closed when a template omits an invoked capability', () => {
    const pluginId = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/test');
    expect(() =>
      resolveBehaviorAuthoringRegistry([
        {
          pluginId,
          contributions: {
            behaviorEntries: [{
              id: 'test.triggered',
              kind: 'event',
              label: 'Triggered',
              category: 'Test',
              description: 'Test event.',
              capability: 'test.events',
              inputs: [],
              outputs: [],
            }],
            behaviorTemplates: [{
              id: 'test.invalid-template',
              label: 'Invalid template',
              description: 'Missing its event capability.',
              category: 'Test',
              requiredCapabilities: [],
              when: { entryId: 'test.triggered', arguments: {} },
              do: [],
            }],
          } as never,
        },
      ]),
    ).toThrow(/does not require capability test\.events/);
  });
});

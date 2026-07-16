import { makeGameObjectTypeId, makeProjectId } from '@tileborne/core';
import {
  MainEventRegistry,
  MainIpcRegistry,
  toEventHandlerName,
} from '@tileborne/ipc-contracts/bridge';
import { Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { TileborneIpcTransport } from '../../shared/ipc-transport';

import { buildTileborneRendererBridge } from './tileborne-bridge';

const methodNameForChannel = (
  channel: string,
): { readonly domain: string; readonly method: string } => {
  const match = /^tileborne:([a-z][a-z0-9-]*):([a-z][a-zA-Z0-9-]*)$/.exec(channel);
  if (!match) {
    throw new Error(`Unexpected test channel: ${channel}`);
  }
  const [first = '', ...rest] = match[1]!.split('-');
  return {
    domain: `${first}${rest.map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join('')}`,
    method: match[2]!,
  };
};

const PROJECT_ID = makeProjectId('550e8400-e29b-41d4-a716-446655440000');
const OBJECT_TYPE_ID = makeGameObjectTypeId('550e8400-e29b-41d4-a716-446655440001');

describe('renderer-realm tileborne bridge', () => {
  it('exposes one promise method per IPC channel on the typed window.tileborne surface', () => {
    const invoke = vi.fn(async () => undefined);
    const transport: TileborneIpcTransport = {
      invoke,
      subscribe: () => () => undefined,
    };
    const bridge = buildTileborneRendererBridge(transport);

    for (const contract of MainIpcRegistry.contracts) {
      const { domain, method } = methodNameForChannel(contract.channel);
      const domainBridge = bridge[domain as keyof typeof bridge] as Record<
        string,
        ((payload: unknown) => Promise<unknown>) | undefined
      >;
      expect(domainBridge[method]).toBeTypeOf('function');
    }
  });

  it('decodes IPC responses into real schema instances in the renderer realm', async () => {
    const invoke = vi.fn(async () => ({
      objectTypes: [
        {
          objectType: {
            id: OBJECT_TYPE_ID,
            schemaVersion: 1,
            label: 'Projectile Bolt',
            family: 'projectile',
            components: [
              {
                _tag: 'visual-ref',
                width: 48,
                height: 48,
              },
            ],
            instanceDefaults: {},
          },
          origin: 'project',
        },
      ],
      lootTables: [],
      items: [],
      weapons: [],
      definitionProvenance: {},
    }));
    const transport: TileborneIpcTransport = {
      invoke,
      subscribe: () => () => undefined,
    };
    const bridge = buildTileborneRendererBridge(transport);

    const response = await bridge.catalog.resolve({ projectId: PROJECT_ID });
    const visualRef = response.objectTypes[0]?.objectType.components[0];

    expect(invoke).toHaveBeenCalledWith('tileborne:catalog:resolve', { projectId: PROJECT_ID });
    expect(visualRef?._tag).toBe('visual-ref');
    if (visualRef?._tag === 'visual-ref') {
      expect(Option.isNone(visualRef.placeableId)).toBe(true);
      expect(Option.isNone(visualRef.assetId)).toBe(true);
      expect(visualRef.anchors).toEqual({});
    }
  });

  it('preserves project and plugin-template provenance across the main/preload bridge', async () => {
    const projectItemId = 'item:550e8400-e29b-41d4-a716-446655440010';
    const pluginWeaponId = 'weapon:550e8400-e29b-41d4-a716-446655440011';
    const pluginLootTableId = 'loot-table:550e8400-e29b-41d4-a716-446655440012';
    const invoke = vi.fn(async () => ({
      objectTypes: [],
      lootTables: [],
      items: [],
      weapons: [],
      definitionProvenance: {
        [projectItemId]: { _tag: 'project' },
        [pluginWeaponId]: {
          _tag: 'plugin-template',
          pluginId: '@tileborne/plugin-battle-royale',
          templateId: pluginWeaponId,
        },
        [pluginLootTableId]: {
          _tag: 'plugin-template',
          pluginId: '@tileborne/plugin-battle-royale',
          templateId: pluginLootTableId,
        },
      },
    }));
    const bridge = buildTileborneRendererBridge({
      invoke,
      subscribe: () => () => undefined,
    });

    const response = await bridge.catalog.resolve({ projectId: PROJECT_ID });

    expect(response.definitionProvenance).toEqual({
      [projectItemId]: { _tag: 'project' },
      [pluginWeaponId]: {
        _tag: 'plugin-template',
        pluginId: '@tileborne/plugin-battle-royale',
        templateId: pluginWeaponId,
      },
      [pluginLootTableId]: {
        _tag: 'plugin-template',
        pluginId: '@tileborne/plugin-battle-royale',
        templateId: pluginLootTableId,
      },
    });
  });

  it('exposes one event subscriber per main event channel', () => {
    const subscribedChannels: string[] = [];
    const transport: TileborneIpcTransport = {
      invoke: async () => undefined,
      subscribe: (channel) => {
        subscribedChannels.push(channel);
        return () => undefined;
      },
    };
    const bridge = buildTileborneRendererBridge(transport);

    for (const event of MainEventRegistry.events) {
      const handlerName = toEventHandlerName(event.channel);
      const subscribe = bridge.events[handlerName as keyof typeof bridge.events] as
        | ((handler: (payload: unknown) => void) => () => void)
        | undefined;
      expect(subscribe).toBeTypeOf('function');
      subscribe?.(() => undefined);
    }

    expect(subscribedChannels).toEqual(MainEventRegistry.events.map((event) => event.channel));
  });

  it('rejects IPC error payloads so renderer invokeIpc keeps seeing failures', async () => {
    const transport: TileborneIpcTransport = {
      invoke: async () => ({
        _tag: 'IpcValidationError',
        channel: 'tileborne:projects:get',
        message: 'Invalid IPC request',
        issues: ['bad request'],
      }),
      subscribe: () => () => undefined,
    };
    const bridge = buildTileborneRendererBridge(transport);

    await expect(bridge.projects.get({ projectId: PROJECT_ID })).rejects.toMatchObject({
      _tag: 'IpcValidationError',
      message: 'Invalid IPC request',
    });
  });
});

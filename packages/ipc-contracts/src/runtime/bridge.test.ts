import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { MainEventRegistry } from '../events.js';
import { TriggerEventPayload } from '../contracts/trigger.js';
import { IpcDecodeError } from '../errors.js';
import { buildEventBridge, toEventHandlerName } from './bridge.js';
import { createEventSubscriber } from './events.js';
import type { IpcClientTransport, IpcServerTransport } from './transport.js';

class InMemoryEventTransport {
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  readonly client: IpcClientTransport = {
    invoke: () => {
      throw new Error('invoke not implemented');
    },
    subscribe: (channel, onPayload) => {
      const listeners = this.listeners.get(channel) ?? new Set<(payload: unknown) => void>();
      listeners.add(onPayload);
      this.listeners.set(channel, listeners);
      return () => {
        listeners.delete(onPayload);
        if (listeners.size === 0) {
          this.listeners.delete(channel);
        }
      };
    },
  };

  readonly server: IpcServerTransport = {
    handle: () => () => undefined,
    emit: (channel, payload) => {
      for (const listener of this.listeners.get(channel) ?? []) {
        listener(payload);
      }
    },
  };
}

describe('buildEventBridge', () => {
  it('forwards decoded trigger-only payloads to bridge handlers', () => {
    const transport = new InMemoryEventTransport();
    const subscriber = createEventSubscriber(MainEventRegistry, transport.client);
    const bridge = buildEventBridge(subscriber);
    const received: Array<unknown> = [];

    const unsubscribe = bridge.onLogsAppended((payload) => {
      received.push(payload);
    });

    transport.server.emit('tileborne:logs:appended', {});

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({});
    expect(received[0]).not.toBeUndefined();
    expect(Schema.encodeSync(TriggerEventPayload)(received[0])).toEqual({});

    unsubscribe();
  });

  it('does not call bridge handlers when event payload decode fails', () => {
    const transport = new InMemoryEventTransport();
    const subscriber = createEventSubscriber(MainEventRegistry, transport.client);
    const bridge = buildEventBridge(subscriber);
    let handlerCalls = 0;

    bridge.onLogsAppended(() => {
      handlerCalls += 1;
    });

    expect(() => {
      transport.server.emit('tileborne:logs:appended', null);
    }).toThrow(IpcDecodeError);
    expect(handlerCalls).toBe(0);
  });
});

describe('toEventHandlerName', () => {
  // Future-proof: bridge naming must derive from the channel string, not enumerate
  // verbs. New event channels (e.g. `tileborne:projects:archived`,
  // `tileborne:runtime-deploy:changed`) must surface on the bridge automatically.
  // Type-level twin lives in `codegen-shape.ts` (`EventHandlerName<Channel>`).
  it.each([
    ['tileborne:logs:appended', 'onLogsAppended'],
    ['tileborne:projects:changed', 'onProjectsChanged'],
    ['tileborne:projects:archived', 'onProjectsArchived'],
    ['tileborne:runtime-deploy:changed', 'onRuntimeDeployChanged'],
    ['tileborne:assets:imported', 'onAssetsImported'],
    ['tileborne:plugins:enabled', 'onPluginsEnabled'],
  ])('maps %s to %s', (channel, handlerName) => {
    expect(toEventHandlerName(channel)).toBe(handlerName);
  });

  it('rejects channels that do not match the tileborne:<domain>:<verb> shape', () => {
    expect(() => toEventHandlerName('tileborne:logs')).toThrow(/Unknown IPC event channel/);
    expect(() => toEventHandlerName('not-an-event:foo:bar')).toThrow(/Unknown IPC event channel/);
  });
});

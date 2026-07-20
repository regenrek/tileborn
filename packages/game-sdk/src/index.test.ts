import { describe, expect, expectTypeOf, it } from 'vitest';

import { createBehaviorTestHarness, defineBehavior, eventId, events, refs } from './index.js';

declare module './types.js' {
  interface GameEventRegistry {
    'world.player-entered-zone': { readonly playerId: string; readonly zoneId: string };
  }

  interface GameActionRegistry {
    'world.open-door': (doorId: string) => void;
  }

  interface GameQueryRegistry {
    'inventory.has-item': (playerId: string, itemId: string) => boolean;
  }

  interface GameCapabilityRegistry {
    'world.doors': true;
  }
}

const openExit = defineBehavior({
  id: 'example.open-exit',
  state: { opened: false, visits: 0 },
  refs: { exit: refs.entity<'door'>('object:exit') },
  requiredCapabilities: ['world.doors', 'state.core'],
  on: {
    'world.player-entered-zone': ({ event, state, refs: behaviorRefs, query, actions, clock }) => {
      expectTypeOf(event.playerId).toEqualTypeOf<string>();
      expectTypeOf(state.get('opened')).toEqualTypeOf<boolean>();
      expectTypeOf(state.get('visits')).toEqualTypeOf<number>();
      expectTypeOf(behaviorRefs.exit).toEqualTypeOf<ReturnType<typeof refs.entity<'door'>>>();
      expectTypeOf(query['inventory.has-item']).toEqualTypeOf<
        (playerId: string, itemId: string) => boolean
      >();

      if (!query['inventory.has-item'](event.playerId, 'golden-key')) return;
      return [
        state.set('opened', true),
        state.set('visits', state.get('visits') + 1),
        actions['world.open-door'](behaviorRefs.exit.objectId),
        { kind: 'test.tick', payload: { tick: clock.tick } },
      ];
    },
  },
});

describe('game SDK', () => {
  it('accepts canonical project behavior UUID ids for visual-to-TypeScript conversion', () => {
    const behavior = defineBehavior({
      id: 'behavior:77777777-7777-4777-8777-777777777777',
      state: {},
    });
    expect(behavior.id).toBe('behavior:77777777-7777-4777-8777-777777777777');
  });

  it('preserves native TypeScript inference for state, events, refs, queries, and actions', () => {
    expect(openExit.id).toBe('example.open-exit');
    expect(openExit.sourceKind).toBe('typescript');
    expectTypeOf(openExit.id).toEqualTypeOf<'example.open-exit'>();
    expect(events.lifecycle.started).toBe('lifecycle.started');
    expect(events.runtime.tick).toBe('runtime.tick');
    expect(events.timer.fired).toBe('timer.fired');
    expect(events.shell.event).toBe('shell.event');
    expect(eventId('world.player-entered-zone')).toBe('world.player-entered-zone');
  });

  it('types built-in shell events and actions through the SDK registry', () => {
    const shellBehavior = defineBehavior({
      id: 'example.shell-listener',
      state: { last: '' },
      requiredCapabilities: ['shell.navigation'],
      on: {
        'shell.event': ({ event, state, actions, capabilities }) => {
          expectTypeOf(event.screenId).toEqualTypeOf<string>();
          expectTypeOf(event.actionId).toEqualTypeOf<string | undefined>();
          capabilities.require('shell.navigation');
          return [
            state.set('last', event.event),
            actions['shell.emit-event']({
              event: 'shell.action.invoked',
              screenId: event.screenId,
              actionId: event.actionId,
            }),
            actions['shell.invoke-action']({ actionId: 'title.start' }),
          ];
        },
      },
    });

    expect(shellBehavior.requiredCapabilities).toEqual(['shell.navigation']);
  });

  it('executes handlers through the deterministic test harness and records commands', async () => {
    const harness = createBehaviorTestHarness(openExit, {
      tick: 120,
      capabilities: ['world.doors', 'state.core'],
      queries: {
        'inventory.has-item': (playerId, itemId) =>
          playerId === 'player-1' && itemId === 'golden-key',
      },
    });

    const result = await harness.dispatch('world.player-entered-zone', {
      playerId: 'player-1',
      zoneId: 'extraction',
    });

    expect(result.state).toEqual({ opened: true, visits: 1 });
    expect(result.commands).toEqual([
      { kind: 'state.set', payload: { key: 'opened', value: true } },
      { kind: 'state.set', payload: { key: 'visits', value: 1 } },
      { kind: 'world.open-door', payload: { arguments: ['object:exit'] } },
      { kind: 'test.tick', payload: { tick: 120 } },
    ]);
  });

  it('uses repeatable seeded random values and tick timers', async () => {
    const randomBehavior = defineBehavior({
      id: 'example.seeded-random',
      state: { value: 0 },
      on: {
        'lifecycle.started': ({ rng, timers }) => [
          { kind: 'random.value', payload: { value: rng.integer(1, 100) } },
          timers.after(30, 'continue'),
        ],
      },
    });
    const event = { reason: 'initial' } as const;
    const first = await createBehaviorTestHarness(randomBehavior, { seed: 'same' }).dispatch(
      'lifecycle.started',
      event,
    );
    const second = await createBehaviorTestHarness(randomBehavior, { seed: 'same' }).dispatch(
      'lifecycle.started',
      event,
    );

    expect(first.commands).toEqual(second.commands);
    expect(first.commands[1]).toEqual({
      kind: 'timer.after',
      payload: { ticks: 30, timerId: 'continue' },
    });
  });

  it('emits a stable diagnostic for malformed behavior ids', () => {
    expect(() => defineBehavior({ id: 'Not Valid', state: {} })).toThrowError(
      'TBSDK0001: behavior id "Not Valid" must be a dotted lowercase identifier',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createRuntimeAdapter } from '../examples/runtime-adapter.js';
import type { RuntimeAdapterComponentStore, RuntimeAdapterWorld } from './runtime-adapter.js';

const componentStore = <T extends object>(): RuntimeAdapterComponentStore<T> => {
  const values = new Map<number, T>();
  return {
    get: (entity) => values.get(entity),
    set: (entity, value) => values.set(entity, value),
    has: (entity) => values.has(entity),
    delete: (entity) => {
      values.delete(entity);
    },
    entries: () => values.entries(),
  };
};

describe('published runtime adapter example', () => {
  it('executes the compile-checked named factory', () => {
    const emit = vi.fn();
    const stores = new Map<string, RuntimeAdapterComponentStore<object>>();
    const world: RuntimeAdapterWorld = {
      createEntity: () => 1,
      destroyEntity: () => undefined,
      registerComponent: <T extends object>(name: string) => {
        const store = componentStore<T>();
        stores.set(name, store as RuntimeAdapterComponentStore<object>);
        return store;
      },
      getComponent: <T extends object>(name: string) =>
        stores.get(name) as RuntimeAdapterComponentStore<T>,
    };
    const adapter = createRuntimeAdapter({ getMapPackage: () => ({}), emit, seed: 7 });

    adapter.onInit?.({ pluginId: adapter.id }, world);
    adapter.onTick?.(world, 1 / 20, 3);

    expect(adapter.id).toBe('@tileborne-plugins/example-gameplay');
    expect(stores.has('example.started')).toBe(true);
    expect(emit).toHaveBeenNthCalledWith(1, {
      kind: '@tileborne-plugins/example-gameplay.started',
      tick: 0,
    });
    expect(emit).toHaveBeenNthCalledWith(2, { kind: 'example.tick', tick: 3 });
  });
});

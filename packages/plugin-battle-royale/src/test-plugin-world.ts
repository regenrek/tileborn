import type { ComponentStore, PluginWorld } from './types/runtime-plugin.js';

export class TestPluginWorld implements PluginWorld {
  private nextEntity = 1;
  private readonly stores = new Map<string, Map<number, object>>();

  createEntity(): number {
    const entity = this.nextEntity;
    this.nextEntity += 1;
    return entity;
  }

  destroyEntity(entity: number): void {
    for (const store of this.stores.values()) {
      store.delete(entity);
    }
  }

  registerComponent<T extends object>(name: string): ComponentStore<T> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return this.componentStore(name);
  }

  getComponent<T extends object>(name: string): ComponentStore<T> {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`component not registered: ${name}`);
    }
    return this.componentStore(name);
  }

  private componentStore<T extends object>(name: string): ComponentStore<T> {
    const values = this.stores.get(name) ?? new Map<number, object>();
    this.stores.set(name, values);
    return {
      get: (entity: number): T | undefined => {
        const value = values.get(entity);
        return value === undefined ? undefined : (value as T);
      },
      set: (entity: number, value: T): void => {
        values.set(entity, value);
      },
      has: (entity: number): boolean => values.has(entity),
      delete: (entity: number): void => {
        values.delete(entity);
      },
      entries: (): IterableIterator<[number, T]> & { readonly length: number } => {
        const pairs: Array<[number, T]> = [];
        for (const [entity, value] of values.entries()) {
          pairs.push([entity, value as T]);
        }
        const iterator = pairs[Symbol.iterator]();
        return Object.assign(iterator, { length: pairs.length });
      },
    };
  }
}

export const createTestPluginWorld = (): TestPluginWorld => new TestPluginWorld();

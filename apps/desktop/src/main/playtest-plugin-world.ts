interface ComponentStore<T extends object> {
  get(entity: number): T | undefined;
  set(entity: number, value: T): void;
  has(entity: number): boolean;
  delete(entity: number): void;
  entries(): Iterable<[number, T]>;
}

export interface PlaytestPluginWorld {
  createEntity(): number;
  destroyEntity(entity: number): void;
  registerComponent<T extends object>(name: string): ComponentStore<T>;
  getComponent<T extends object>(name: string): ComponentStore<T>;
  aliveEntities(): readonly number[];
}

export class SimplePlaytestWorld implements PlaytestPluginWorld {
  private nextEntity = 1;
  private readonly alive = new Set<number>();
  private readonly stores = new Map<string, Map<number, object>>();

  createEntity(): number {
    const entity = this.nextEntity;
    this.nextEntity += 1;
    this.alive.add(entity);
    return entity;
  }

  destroyEntity(entity: number): void {
    this.alive.delete(entity);
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

  aliveEntities(): readonly number[] {
    return [...this.alive];
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
      entries: (): Iterable<[number, T]> => {
        const pairs: Array<[number, T]> = [];
        for (const [entity, value] of values.entries()) {
          pairs.push([entity, value as T]);
        }
        return pairs;
      },
    };
  }
}

export const createPlaytestPluginWorld = (): SimplePlaytestWorld => new SimplePlaytestWorld();

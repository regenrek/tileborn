import { Option, Schema } from 'effect';

import type { ComponentDefinition, ComponentFieldType } from './components.js';

const SLOT_BITS = 16;
const SLOT_MASK = 0xffff;
const MAX_GENERATION = 0xffff;
const DEFAULT_CAPACITY = 1024;

export const EntityIdSchema = Schema.Number.pipe(Schema.brand('EntityId'));
export type EntityId = typeof EntityIdSchema.Type;

type NumericArray = Float32Array | Float64Array | Int32Array | Uint32Array | Int8Array | Uint8Array;

export type ComponentAccess<T extends object> = {
  -readonly [K in keyof T]: T[K];
};

interface RegisteredComponent<T extends object> {
  readonly definition: ComponentDefinition<T>;
  readonly bit: bigint;
  readonly columns: { readonly [K in keyof T]: NumericArray };
}

export class World {
  private capacity: number;
  private nextSlot = 0;
  private slotGenerations: Uint32Array;
  private alive: Uint8Array;
  private masks: bigint[];
  private readonly freeSlots: number[] = [];
  private readonly components = new Map<ComponentDefinition<object>, RegisteredComponent<object>>();
  private nextComponentBit = 0n;

  constructor(capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > SLOT_MASK + 1) {
      throw new RangeError(`world capacity must be an integer between 1 and ${SLOT_MASK + 1}`);
    }
    this.capacity = capacity;
    this.slotGenerations = new Uint32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.masks = Array.from({ length: capacity }, () => 0n);
  }

  createEntity(): EntityId {
    const slot = this.freeSlots.pop() ?? this.allocateSlot();
    const currentGeneration = this.slotGenerations[slot] ?? 0;
    if (currentGeneration === 0) {
      this.slotGenerations[slot] = 1;
    }
    this.alive[slot] = 1;
    this.masks[slot] = 0n;
    return this.packEntityId(slot, this.slotGenerations[slot] ?? 1);
  }

  destroyEntity(entity: EntityId): void {
    const slot = this.slotForMutation(entity);
    this.alive[slot] = 0;
    this.masks[slot] = 0n;
    this.clearComponentSlot(slot);
    const currentGeneration = this.slotGenerations[slot] ?? 0;
    if (currentGeneration === MAX_GENERATION) {
      this.slotGenerations[slot] = 0;
      return;
    }
    this.slotGenerations[slot] = currentGeneration + 1;
    this.freeSlots.push(slot);
  }

  addComponent<T extends object>(
    entity: EntityId,
    component: ComponentDefinition<T>,
    init?: Partial<T>,
  ): ComponentAccess<T> {
    const slot = this.slotForMutation(entity);
    const registered = this.register(component);
    const codec = component.schema as Schema.Codec<T, unknown, never, never>;
    const value = Schema.decodeUnknownSync(codec)({ ...component.defaults(), ...init });
    this.writeComponent(registered, slot, value);
    this.masks[slot] = this.maskOfSlot(slot) | registered.bit;
    return this.accessorFor(registered, entity);
  }

  removeComponent<T extends object>(entity: EntityId, component: ComponentDefinition<T>): void {
    const slot = this.slotForMutation(entity);
    const registered = this.components.get(component as ComponentDefinition<object>);
    if (!registered) {
      return;
    }
    this.masks[slot] = this.maskOfSlot(slot) & ~registered.bit;
  }

  getComponent<T extends object>(
    entity: EntityId,
    component: ComponentDefinition<T>,
  ): Option.Option<T> {
    const slot = this.slotForRead(entity);
    if (slot === undefined) {
      return Option.none();
    }
    const registered = this.components.get(component as ComponentDefinition<object>);
    if (!registered || (this.maskOfSlot(slot) & registered.bit) !== registered.bit) {
      return Option.none();
    }
    return Option.some(this.snapshotComponent(registered as RegisteredComponent<T>, slot));
  }

  hasComponent<T extends object>(entity: EntityId, component: ComponentDefinition<T>): boolean {
    const slot = this.slotForRead(entity);
    if (slot === undefined) {
      return false;
    }
    const registered = this.components.get(component as ComponentDefinition<object>);
    return registered !== undefined && (this.maskOfSlot(slot) & registered.bit) === registered.bit;
  }

  query<const T extends readonly ComponentDefinition<object>[]>(
    components: T,
    callback: (
      entity: EntityId,
      ...values: {
        [K in keyof T]: T[K] extends ComponentDefinition<infer C> ? ComponentAccess<C> : never;
      }
    ) => void,
  ): void {
    const registered = components.map((component) => this.register(component));
    const requiredMask = registered.reduce((mask, component) => mask | component.bit, 0n);
    const matches: EntityId[] = [];
    for (let slot = 0; slot < this.nextSlot; slot += 1) {
      if (this.alive[slot] === 1 && (this.maskOfSlot(slot) & requiredMask) === requiredMask) {
        matches.push(this.packEntityId(slot, this.slotGenerations[slot] ?? 0));
      }
    }

    const accessors = registered.map((component) => this.cursorFor(component));
    const values = accessors.map((accessor) => accessor.value) as {
      [K in keyof T]: T[K] extends ComponentDefinition<infer C> ? ComponentAccess<C> : never;
    };
    for (const entity of matches) {
      const slot = this.slotForRead(entity);
      if (slot === undefined || (this.maskOfSlot(slot) & requiredMask) !== requiredMask) {
        continue;
      }
      for (const accessor of accessors) {
        accessor.setEntity(entity);
      }
      // Preserve positional query callbacks; the zero-alloc invariant is the stable component view tuple above.
      callback(entity, ...values);
    }
  }

  hasEntity(entity: EntityId): boolean {
    return this.slotForRead(entity) !== undefined;
  }

  private register<T extends object>(definition: ComponentDefinition<T>): RegisteredComponent<T> {
    const key = definition as ComponentDefinition<object>;
    const existing = this.components.get(key);
    if (existing) {
      return existing as RegisteredComponent<T>;
    }
    const registered: RegisteredComponent<T> = {
      definition,
      bit: 1n << this.nextComponentBit,
      columns: this.createColumns(definition),
    };
    this.nextComponentBit += 1n;
    this.components.set(key, registered as RegisteredComponent<object>);
    return registered;
  }

  private allocateSlot(): number {
    if (this.nextSlot === this.capacity) {
      this.grow();
    }
    if (this.nextSlot > SLOT_MASK) {
      throw new RangeError(`world cannot allocate more than ${SLOT_MASK + 1} entity slots`);
    }
    const slot = this.nextSlot;
    this.nextSlot += 1;
    return slot;
  }

  private grow(): void {
    const nextCapacity = Math.min(this.capacity * 2, SLOT_MASK + 1);
    if (nextCapacity === this.capacity) {
      throw new RangeError(`world cannot grow beyond ${SLOT_MASK + 1} entity slots`);
    }
    const nextGenerations = new Uint32Array(nextCapacity);
    nextGenerations.set(this.slotGenerations);
    this.slotGenerations = nextGenerations;
    const nextAlive = new Uint8Array(nextCapacity);
    nextAlive.set(this.alive);
    this.alive = nextAlive;
    this.masks.length = nextCapacity;
    for (let index = this.capacity; index < nextCapacity; index += 1) {
      this.masks[index] = 0n;
    }
    this.capacity = nextCapacity;
    for (const component of this.components.values()) {
      this.growColumns(component);
    }
  }

  private createColumns<T extends object>(
    definition: ComponentDefinition<T>,
  ): { readonly [K in keyof T]: NumericArray } {
    const columns: Partial<Record<keyof T, NumericArray>> = {};
    for (const key of Object.keys(definition.fields) as Array<keyof T>) {
      columns[key] = this.createArray(definition.fields[key], this.capacity);
    }
    return columns as { readonly [K in keyof T]: NumericArray };
  }

  private growColumns<T extends object>(component: RegisteredComponent<T>): void {
    for (const key of Object.keys(component.definition.fields) as Array<keyof T>) {
      const current = component.columns[key];
      const next = this.createArray(component.definition.fields[key], this.capacity);
      next.set(current);
      (component.columns as Record<keyof T, NumericArray>)[key] = next;
    }
  }

  private createArray(type: ComponentFieldType, capacity: number): NumericArray {
    switch (type) {
      case 'f32':
        return new Float32Array(capacity);
      case 'f64':
        return new Float64Array(capacity);
      case 'i32':
        return new Int32Array(capacity);
      case 'u32':
        return new Uint32Array(capacity);
      case 'i8':
        return new Int8Array(capacity);
      case 'u8':
        return new Uint8Array(capacity);
    }
  }

  private writeComponent<T extends object>(
    component: RegisteredComponent<T>,
    slot: number,
    value: T,
  ): void {
    for (const key of Object.keys(component.definition.fields) as Array<keyof T>) {
      component.columns[key][slot] = Number(value[key]);
    }
  }

  private clearComponentSlot(slot: number): void {
    for (const component of this.components.values()) {
      this.clearRegisteredComponentSlot(component, slot);
    }
  }

  private clearRegisteredComponentSlot<T extends object>(
    component: RegisteredComponent<T>,
    slot: number,
  ): void {
    for (const key of Object.keys(component.definition.fields) as Array<keyof T>) {
      component.columns[key][slot] = 0;
    }
  }

  private snapshotComponent<T extends object>(component: RegisteredComponent<T>, slot: number): T {
    const value: Partial<Record<keyof T, number>> = {};
    for (const key of Object.keys(component.definition.fields) as Array<keyof T>) {
      value[key] = component.columns[key][slot];
    }
    const codec = component.definition.schema as Schema.Codec<T, unknown, never, never>;
    return Schema.decodeUnknownSync(codec)(value);
  }

  private accessorFor<T extends object>(
    component: RegisteredComponent<T>,
    entity: EntityId,
  ): ComponentAccess<T> {
    const accessor = this.cursorFor(component);
    accessor.setEntity(entity);
    return accessor.value;
  }

  private cursorFor<T extends object>(
    component: RegisteredComponent<T>,
  ): {
    readonly value: ComponentAccess<T>;
    setEntity: (entity: EntityId) => void;
  } {
    let cachedSlot = 0;
    let cachedGeneration = 0;
    const validateMutableAccess = () => {
      const expectedGeneration = this.slotGenerations[cachedSlot] ?? 0;
      if (cachedGeneration !== expectedGeneration) {
        throw new EntityHandleStaleError({
          slotIndex: cachedSlot,
          expectedGeneration,
          actualGeneration: cachedGeneration,
        });
      }
    };
    const value = {};
    for (const key of Object.keys(component.definition.fields) as Array<keyof T>) {
      Object.defineProperty(value, key, {
        enumerable: true,
        get: () => component.columns[key][cachedSlot],
        set: (next: number) => {
          validateMutableAccess();
          component.columns[key][cachedSlot] = next;
        },
      });
    }
    return {
      value: value as ComponentAccess<T>,
      setEntity: (entity) => {
        const packed = entity as number;
        cachedSlot = packed & SLOT_MASK;
        cachedGeneration = packed >>> SLOT_BITS;
      },
    };
  }

  private slotForRead(entity: EntityId): number | undefined {
    const packed = entity as number;
    const slot = packed & SLOT_MASK;
    const generation = packed >>> SLOT_BITS;
    if (
      slot >= this.nextSlot ||
      this.alive[slot] !== 1 ||
      generation === 0 ||
      this.slotGenerations[slot] !== generation
    ) {
      return undefined;
    }
    return slot;
  }

  private slotForMutation(entity: EntityId): number {
    const slot = this.slotForRead(entity);
    if (slot === undefined) {
      const packed = entity as number;
      const slotIndex = packed & SLOT_MASK;
      const actualGeneration = packed >>> SLOT_BITS;
      throw new EntityHandleStaleError({
        slotIndex,
        expectedGeneration: this.slotGenerations[slotIndex] ?? 0,
        actualGeneration,
      });
    }
    return slot;
  }

  private packEntityId(slot: number, generation: number): EntityId {
    return ((((generation & SLOT_MASK) << SLOT_BITS) | slot) >>> 0) as EntityId;
  }

  private maskOfSlot(slot: number): bigint {
    return this.masks[slot] ?? 0n;
  }
}

/** Raised when an entity handle no longer matches the live slot generation. */
export class EntityHandleStaleError extends Schema.TaggedErrorClass<EntityHandleStaleError>()(
  'EntityHandleStaleError',
  {
    slotIndex: Schema.Number,
    expectedGeneration: Schema.Number,
    actualGeneration: Schema.Number,
  },
) {}

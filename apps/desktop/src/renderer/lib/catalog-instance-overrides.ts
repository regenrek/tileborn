import { Option } from 'effect';
import type {
  GameObjectType,
  JsonObject,
  JsonValue,
  LootInteractionMode,
  LootSourceComponent,
  MapObject,
} from '@tileborne/core';

import type {
  AuthoringSettingsFieldDescriptor,
  AuthoringSettingsForm,
} from '@/lib/authoring-settings-form';

/**
 * Renderer-owned, plugin-neutral helpers that bridge a resolved catalog
 * `GameObjectType` (read-only definition) to the per-instance overrides
 * authored on a placed `MapObject` (ADR-0025 slice 5). Definitions — including
 * loot-table/item content — are never mutated here; everything an author edits
 * is persisted onto `MapObject.properties` (decision `c-cgsd`). These functions
 * are pure (they compute the next `properties` bag, never a new definition) so
 * the inspector panel and its tests share one source of truth.
 */

/** Humanise a flat property/grant key (`maxUses` → `Max uses`). */
const humanise = (key: string): string => {
  const spaced = key
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  if (spaced.length === 0) {
    return key;
  }
  return `${spaced[0]!.toUpperCase()}${spaced.slice(1)}`;
};

/**
 * The numeric per-instance override values keyed by the `instanceDefaults`
 * field they override. The generic `AuthoringSettingsForm` mechanism is
 * numeric-only (each descriptor carries `min`/`step`), so only the numeric
 * authoring defaults project into editable override fields.
 */
export type InstanceOverrideValues = Record<string, number>;

const numericDefaults = (
  objectType: GameObjectType,
): readonly (readonly [string, number])[] =>
  Object.entries(objectType.instanceDefaults).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );

const fieldDescriptor = (key: string, value: number): AuthoringSettingsFieldDescriptor => ({
  key,
  label: humanise(key),
  min: Math.min(0, value),
  step: Number.isInteger(value) ? 1 : 0.1,
});

/**
 * Derive an {@link AuthoringSettingsForm} for one object type's numeric
 * instance overrides. The inspector renders + validates it through the very
 * same generic mechanism the plugin-owned map-settings panel uses — the form
 * is data-driven from the catalog definition, never a hand-written field set.
 */
export const buildInstanceOverridesForm = (
  objectType: GameObjectType,
): AuthoringSettingsForm<InstanceOverrideValues> => {
  const fields = numericDefaults(objectType).map(([key, value]) => fieldDescriptor(key, value));
  return {
    fields,
    toDraft: (settings) => {
      const draft: Record<string, string> = {};
      for (const field of fields) {
        draft[field.key] = String(settings[field.key] ?? 0);
      }
      return draft;
    },
    parseDraft: (draft) => {
      const parsed: InstanceOverrideValues = {};
      for (const field of fields) {
        const raw = draft[field.key];
        if (raw === undefined || raw.trim().length === 0) {
          return undefined;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          return undefined;
        }
        parsed[field.key] = value;
      }
      return parsed;
    },
    invalidMessage: 'Enter a valid number for every override field.',
  };
};

/**
 * Read the effective numeric override values for a placed object: a per-instance
 * value persisted on `MapObject.properties` wins, otherwise the type's
 * `instanceDefaults` value is surfaced (so an untouched instance shows the
 * definition's defaults without persisting them).
 */
export const readInstanceOverrides = (
  object: MapObject,
  objectType: GameObjectType,
): InstanceOverrideValues => {
  const values: InstanceOverrideValues = {};
  for (const [key, defaultValue] of numericDefaults(objectType)) {
    const persisted = object.properties[key];
    values[key] = typeof persisted === 'number' ? persisted : defaultValue;
  }
  return values;
};

/**
 * Compute the next `properties` bag with the numeric overrides applied. Pure:
 * returns a new object and never touches the input object or its definition.
 */
export const mergeInstanceOverrides = (
  object: MapObject,
  values: InstanceOverrideValues,
): JsonObject => ({ ...object.properties, ...values });

/** The reserved `MapObject.properties` key holding the loot-source binding. */
export const LOOT_SOURCE_PROPERTY_KEY = 'lootSource';

/** A placed object's per-instance loot binding + interaction/grant overrides. */
export interface LootBindingValue {
  /** Bound loot-table id (an `LootTableId` string), or `undefined` to inherit. */
  readonly lootTableId: string | undefined;
  readonly interactionMode: LootInteractionMode;
  readonly grants: Record<string, boolean>;
}

/** Find an object type's loot-source component, if any (the binding's source). */
export const findLootSource = (
  objectType: GameObjectType,
): LootSourceComponent | undefined =>
  objectType.components.find(
    (component): component is LootSourceComponent => component._tag === 'loot-source',
  );

const isPlainRecord = (
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readGrants = (
  lootSource: LootSourceComponent,
  override: { readonly [key: string]: JsonValue } | undefined,
): Record<string, boolean> => {
  const grants: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(lootSource.grants)) {
    const persisted = override?.[key];
    grants[key] = typeof persisted === 'boolean' ? persisted : value;
  }
  return grants;
};

const isInteractionMode = (value: JsonValue | undefined): value is LootInteractionMode =>
  value === 'auto' || value === 'tap' || value === 'hold';

/**
 * Read the effective loot binding for a placed object: a per-instance binding
 * persisted under {@link LOOT_SOURCE_PROPERTY_KEY} wins over the component's
 * definition defaults (the bound table, interaction mode, and grant flags).
 */
export const readLootBinding = (
  object: MapObject,
  lootSource: LootSourceComponent,
): LootBindingValue => {
  const override = object.properties[LOOT_SOURCE_PROPERTY_KEY];
  const overrideRecord = isPlainRecord(override) ? override : undefined;
  const persistedTable = overrideRecord?.lootTableId;
  const definitionTable = Option.getOrUndefined(lootSource.lootTableId);
  const lootTableId =
    typeof persistedTable === 'string'
      ? persistedTable
      : persistedTable === null
        ? undefined
        : definitionTable;
  const persistedMode = overrideRecord?.interactionMode;
  const grantsOverride = overrideRecord?.grants;
  return {
    lootTableId,
    interactionMode: isInteractionMode(persistedMode) ? persistedMode : lootSource.interactionMode,
    grants: readGrants(lootSource, isPlainRecord(grantsOverride) ? grantsOverride : undefined),
  };
};

/** Serialize a loot binding into the JSON record persisted under {@link LOOT_SOURCE_PROPERTY_KEY}. */
export const lootBindingRecord = (value: LootBindingValue): JsonObject => ({
  lootTableId: value.lootTableId ?? null,
  interactionMode: value.interactionMode,
  grants: { ...value.grants },
});

/**
 * Compute the next `properties` bag with the loot binding applied (the BINDING
 * and per-instance overrides only — never the loot-table definition). Pure:
 * returns a new object; the input object and catalog definition are untouched.
 */
export const mergeLootBinding = (object: MapObject, value: LootBindingValue): JsonObject => ({
  ...object.properties,
  [LOOT_SOURCE_PROPERTY_KEY]: lootBindingRecord(value),
});

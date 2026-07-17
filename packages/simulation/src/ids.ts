import { Schema } from 'effect';
import type { Uuid } from '@tileborne/core';

/**
 * Prefixed-id factory mirroring `@tileborne/core`'s `definePrefixedId`
 * discipline (`<prefix>:<uuid-v4>`). Kept local so `@tileborne/simulation`
 * owns its own combat-domain ids (per ADR-0018) without reaching into core
 * internals; the validation shape is identical to core's domain ids.
 */
const definePrefixedId = <Tag extends string>(prefix: string, brand: Tag) => {
  const pattern = new RegExp(
    `^${prefix}:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  );
  const schema = Schema.String.check(Schema.isPattern(pattern)).pipe(Schema.brand(brand));
  const make = (uuid: Uuid): (typeof schema)['Type'] =>
    `${prefix}:${uuid}` as (typeof schema)['Type'];
  return { schema, make, prefix };
};

const weapon = definePrefixedId('weapon', 'WeaponDefinitionId');
const status = definePrefixedId('status', 'StatusEffectId');
const ability = definePrefixedId('ability', 'AbilityId');

/**
 * Branded weapon-definition identifier (`weapon:<uuid>`).
 * Reserved by ADR-0019 for ADR-0018; the schema/shape of a weapon lives here,
 * the concrete numbers are plugin content data.
 */
export const WeaponDefinitionId = weapon.schema;
export type WeaponDefinitionId = typeof WeaponDefinitionId.Type;
export const makeWeaponDefinitionId = weapon.make;

/** Branded status-effect identifier (`status:<uuid>`). Reserved by ADR-0019. */
export const StatusEffectId = status.schema;
export type StatusEffectId = typeof StatusEffectId.Type;
export const makeStatusEffectId = status.make;

/** Branded ability identifier (`ability:<uuid>`). Reserved by ADR-0019. */
export const AbilityId = ability.schema;
export type AbilityId = typeof AbilityId.Type;
export const makeAbilityId = ability.make;

/**
 * Identity of a combat participant within a {@link CombatWorldView}. Neutral
 * integer handle (stable, sortable) so replays can iterate in a deterministic
 * order; the runtime/plugin adapt their ECS entity to this id.
 */
export const CombatEntityId = Schema.Int.pipe(Schema.brand('CombatEntityId'));
export type CombatEntityId = typeof CombatEntityId.Type;
export const makeCombatEntityId = (value: number): CombatEntityId => value as CombatEntityId;

/**
 * Open, neutral team identity interpreted by an injected
 * {@link HitResolutionPolicy}. NOT a closed mode/role enum — there is
 * deliberately no `solo`/`duo`/`squad` here (that is BR-plugin balance).
 */
export const TeamId = Schema.String.pipe(Schema.brand('CombatTeamId'));
export type TeamId = typeof TeamId.Type;
export const makeTeamId = (value: string): TeamId => value as TeamId;

/**
 * Open, neutral inventory item identity held in an `InventoryState` slot or
 * granted by a loot roll (ADR-0018 inventory/loot addendum). Deliberately an
 * open branded string — NOT a closed item-kind or tier enum: the engine never
 * interprets the value, it only stores and moves it. Plugins put whatever
 * identity they own here (e.g. a catalog `ItemDefinitionId` or a composite
 * content key).
 */
export const InventoryItemId = Schema.String.pipe(Schema.brand('InventoryItemId'));
export type InventoryItemId = typeof InventoryItemId.Type;
export const makeInventoryItemId = (value: string): InventoryItemId => value as InventoryItemId;

/**
 * Open, neutral ammunition classification keying an `AmmoReserve` stack
 * (ADR-0018 inventory/loot addendum). An open branded string — never a closed
 * ammo-type enum: which kinds exist (and which weapon consumes which) is
 * plugin content data.
 */
export const AmmoKind = Schema.String.pipe(Schema.brand('AmmoKind'));
export type AmmoKind = typeof AmmoKind.Type;
export const makeAmmoKind = (value: string): AmmoKind => value as AmmoKind;

/**
 * Open, neutral equipment-slot identity keyed by an `EquipmentState` entry
 * (ADR-0018 inventory/loot addendum, Slice 2). An open branded string — never
 * a closed slot enum: which slots exist is plugin content data (the catalog's
 * `EquippableComponent.slot` open tag is the authoring-side counterpart; the
 * caller maps it onto this id when building equip/swap commands).
 */
export const EquipmentSlotId = Schema.String.pipe(Schema.brand('EquipmentSlotId'));
export type EquipmentSlotId = typeof EquipmentSlotId.Type;
export const makeEquipmentSlotId = (value: string): EquipmentSlotId => value as EquipmentSlotId;

/**
 * Identity of an in-flight projectile persisted across ticks by the
 * {@link runCombatTick} orchestrator (Slice 4). Neutral integer handle, stable
 * and sortable so the projectile lifecycle replays in a deterministic order;
 * the orchestrator allocates ids from a monotonically increasing counter held
 * in its tick state.
 */
export const ProjectileId = Schema.Int.pipe(Schema.brand('ProjectileId'));
export type ProjectileId = typeof ProjectileId.Type;
export const makeProjectileId = (value: number): ProjectileId => value as ProjectileId;

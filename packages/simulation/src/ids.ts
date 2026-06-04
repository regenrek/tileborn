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

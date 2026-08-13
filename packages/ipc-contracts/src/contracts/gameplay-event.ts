import { Schema } from 'effect';

import { WeaponDefinitionId } from '@tileborne/core';
import { InventoryItemId, StatusEffectId } from '@tileborne/simulation';

/**
 * Plugin-neutral runtime identity used at the gameplay-event wire boundary.
 * A game-mode adapter maps its ECS/runtime identity into this stable string;
 * consumers never need to know the plugin's entity representation.
 */
export const GameplayEntityId = Schema.String.pipe(Schema.brand('GameplayEntityId'));
export type GameplayEntityId = typeof GameplayEntityId.Type;
export const makeGameplayEntityId = (id: string): GameplayEntityId =>
  Schema.decodeUnknownSync(GameplayEntityId)(id);

export const makeGameplayItemId = (id: string): InventoryItemId =>
  Schema.decodeUnknownSync(InventoryItemId)(id);

export class GameplayWeaponFired extends Schema.TaggedClass<GameplayWeaponFired>()('WeaponFired', {
  tick: Schema.Int,
  sourceId: GameplayEntityId,
  weaponId: WeaponDefinitionId,
  origin: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
  }),
  direction: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
  }),
  damage: Schema.Number,
  ammoRemaining: Schema.Int,
}) {}

export class GameplayDamageApplied extends Schema.TaggedClass<GameplayDamageApplied>()(
  'DamageApplied',
  {
    tick: Schema.Int,
    targetId: GameplayEntityId,
    sourceId: Schema.optionalKey(GameplayEntityId),
    amount: Schema.Number,
    healthBefore: Schema.Number,
    healthAfter: Schema.Number,
  },
) {}

export class GameplayEntityDefeated extends Schema.TaggedClass<GameplayEntityDefeated>()(
  'EntityDefeated',
  {
    tick: Schema.Int,
    targetId: GameplayEntityId,
    sourceId: Schema.optionalKey(GameplayEntityId),
    amount: Schema.optionalKey(Schema.Number),
    healthBefore: Schema.optionalKey(Schema.Number),
  },
) {}

export class GameplayItemGranted extends Schema.TaggedClass<GameplayItemGranted>()('ItemGranted', {
  tick: Schema.Int,
  targetId: GameplayEntityId,
  itemId: InventoryItemId,
  slot: Schema.optionalKey(Schema.Int),
  quantity: Schema.Int,
}) {}

export class GameplayItemDropped extends Schema.TaggedClass<GameplayItemDropped>()('ItemDropped', {
  tick: Schema.Int,
  sourceId: GameplayEntityId,
  itemId: InventoryItemId,
  reason: Schema.Literals(['overflow', 'requested', 'defeat'] as const),
}) {}

export class GameplayItemConsumed extends Schema.TaggedClass<GameplayItemConsumed>()(
  'ItemConsumed',
  {
    tick: Schema.Int,
    sourceId: GameplayEntityId,
    itemId: InventoryItemId,
  },
) {}

export class GameplayStatusApplied extends Schema.TaggedClass<GameplayStatusApplied>()(
  'StatusApplied',
  {
    tick: Schema.Int,
    targetId: GameplayEntityId,
    effectId: StatusEffectId,
    sourceId: Schema.optionalKey(GameplayEntityId),
  },
) {}

export class GameplayStatusExpired extends Schema.TaggedClass<GameplayStatusExpired>()(
  'StatusExpired',
  {
    tick: Schema.Int,
    targetId: GameplayEntityId,
    effectId: StatusEffectId,
  },
) {}

export class GameplayZonePhaseChanged extends Schema.TaggedClass<GameplayZonePhaseChanged>()(
  'ZonePhaseChanged',
  {
    tick: Schema.Int,
    phase: Schema.String,
    previousPhase: Schema.optionalKey(Schema.String),
    secondsRemaining: Schema.optionalKey(Schema.Number),
  },
) {}

export class GameplayMatchPhaseChanged extends Schema.TaggedClass<GameplayMatchPhaseChanged>()(
  'MatchPhaseChanged',
  {
    tick: Schema.Int,
    phase: Schema.String,
    previousPhase: Schema.optionalKey(Schema.String),
    winnerId: Schema.optionalKey(GameplayEntityId),
  },
) {}

/**
 * Canonical consumer-agnostic gameplay event stream from ADR-0029.
 * Plugins own the fold from simulation/mode results; HUD, audio, telemetry,
 * replay, and behavior runtimes consume this one wire vocabulary.
 */
export const GameplayEvent = Schema.Union([
  GameplayWeaponFired,
  GameplayDamageApplied,
  GameplayEntityDefeated,
  GameplayItemGranted,
  GameplayItemDropped,
  GameplayItemConsumed,
  GameplayStatusApplied,
  GameplayStatusExpired,
  GameplayZonePhaseChanged,
  GameplayMatchPhaseChanged,
]);
export type GameplayEvent = Schema.Schema.Type<typeof GameplayEvent>;

export const SequencedGameplayEvent = Schema.Struct({
  sequence: Schema.Int,
  event: GameplayEvent,
});
export type SequencedGameplayEvent = Schema.Schema.Type<typeof SequencedGameplayEvent>;

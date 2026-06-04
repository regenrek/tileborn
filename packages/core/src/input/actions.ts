import { Schema } from "effect";

/**
 * Neutral, OPEN gameplay action identifier (ADR-0024).
 *
 * An `ActionId` is a branded string naming a logical action the resolver fills
 * from raw input — never a key/button literal and never a closed enum. The
 * engine ships a baseline vocabulary ({@link CORE_ACTIONS}); a plugin references
 * those and/or declares its own (`"myMode.Grapple"`) with ZERO engine edits. The
 * engine never enumerates a closed action union and never names what an action
 * *does* (that is plugin policy — ADR-0024 forbidden edges).
 */
export const ActionId = Schema.String.pipe(Schema.brand("ActionId"));
export type ActionId = typeof ActionId.Type;

/** Brand a raw string as an {@link ActionId} (keeps the cast in one place). */
export const makeActionId = (id: string): ActionId => Schema.decodeUnknownSync(ActionId)(id);

/**
 * Durable identity of a saved binding set (a plugin default map or a user remap
 * overlay). Branded so a persisted overlay is keyed without hand-casting.
 */
export const BindingSetId = Schema.String.pipe(Schema.brand("BindingSetId"));
export type BindingSetId = typeof BindingSetId.Type;

export const makeBindingSetId = (id: string): BindingSetId =>
  Schema.decodeUnknownSync(BindingSetId)(id);

/**
 * The value KIND an action carries, so the resolver knows how to fill it:
 * - `digital` — pressed / just-pressed / just-released edges (e.g. PrimaryAction);
 * - `analog1d` — a single −1..1 axis;
 * - `analog2d` — a 2D vector, e.g. Move;
 * - `pointer` — a screen-space position, e.g. Aim.
 */
export const ActionValueKind = Schema.Literals(["digital", "analog1d", "analog2d", "pointer"]);
export type ActionValueKind = typeof ActionValueKind.Type;

/**
 * A plugin's declaration that it uses a given action and the value kind the
 * resolver must produce for it. Scheme-independent: the same Move is `analog2d`
 * whether satisfied by WASD or a stick.
 */
export class ActionDeclaration extends Schema.Class<ActionDeclaration>("ActionDeclaration")({
  action: ActionId,
  valueKind: ActionValueKind,
}) {}

/**
 * Engine-shipped baseline action ids (constants, NOT a closed `Schema` union —
 * mirrors ADR-0019 `FamilyTag`/`OpenTag` so a new genre adds actions without
 * engine edits). The `core.` prefix marks the engine baseline; plugins may use
 * these and/or their own namespaced ids.
 */
export const CORE_ACTIONS = {
  /** Analog 2D movement vector (axes). */
  Move: "core.Move",
  /** Analog 2D / pointer-derived aim. */
  Aim: "core.Aim",
  /** Digital "fire" / "attack" — the headline remap target. */
  PrimaryAction: "core.PrimaryAction",
  /** Digital secondary action. */
  SecondaryAction: "core.SecondaryAction",
  /** Digital "use" / context interaction. */
  Interact: "core.Interact",
  /** Digital reload. */
  Reload: "core.Reload",
  /** Digital dash. */
  Dash: "core.Dash",
  /** Digital slot selectors (loadout / weapon slots). */
  Slot1: "core.Slot1",
  Slot2: "core.Slot2",
  Slot3: "core.Slot3",
  Slot4: "core.Slot4",
  Slot5: "core.Slot5",
} as const;

/** All baseline action id strings (for iteration / validation). */
export const CORE_ACTION_IDS: readonly string[] = Object.values(CORE_ACTIONS);

/** Brand a {@link CORE_ACTIONS} value (or any baseline id) as an {@link ActionId}. */
export const coreActionId = (id: (typeof CORE_ACTIONS)[keyof typeof CORE_ACTIONS]): ActionId =>
  id as string as ActionId;

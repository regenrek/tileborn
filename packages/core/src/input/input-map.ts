import { Schema } from "effect";

import { ActionDeclaration, ActionId, BindingSetId } from "./actions.js";
import { AxisRole, ControlScheme } from "./control-scheme.js";

/**
 * One raw input trigger that can be bound to an action (ADR-0024). A tagged
 * union of the device-neutral trigger shapes the resolver understands. This is
 * the ONLY place a key/button identity exists — always as decoded DATA inside a
 * binding, never as a baked literal in engine code.
 */
export class KeyTrigger extends Schema.TaggedClass<KeyTrigger>()("key", {
  /** A `KeyboardEvent.code`, e.g. `"Space"`, `"KeyW"`, `"Digit1"`. */
  code: Schema.String,
}) {}

export class MouseButtonTrigger extends Schema.TaggedClass<MouseButtonTrigger>()("mouseButton", {
  /** A `MouseEvent.button` index (0 = primary/left). */
  button: Schema.Int,
}) {}

export class GamepadButtonTrigger extends Schema.TaggedClass<GamepadButtonTrigger>()("gamepadButton", {
  button: Schema.Int,
}) {}

export class AxisTrigger extends Schema.TaggedClass<AxisTrigger>()("axis", {
  /** Gamepad axis index (stick/trigger). */
  axis: Schema.Int,
  /** Direction of travel that activates this trigger: `+1` or `-1`. */
  sign: Schema.Literals([1, -1]),
}) {}

export class PointerTrigger extends Schema.TaggedClass<PointerTrigger>()("pointer", {}) {}

export const RawTrigger = Schema.Union([
  KeyTrigger,
  MouseButtonTrigger,
  GamepadButtonTrigger,
  AxisTrigger,
  PointerTrigger,
]);
export type RawTrigger = typeof RawTrigger.Type;

/**
 * One raw trigger bound to an action. For analog actions, {@link axisRole}
 * declares which output axis/sign the trigger contributes to. The owning control
 * scheme is the {@link InputMap.schemeDefaults} key, so the binding itself stays
 * scheme-agnostic data the remap UI can move between schemes.
 */
export class InputBinding extends Schema.TaggedClass<InputBinding>()("InputBinding", {
  action: ActionId,
  trigger: RawTrigger,
  // `OptionFromOptional` so a digital binding may OMIT `axisRole` entirely (only
  // analog bindings carry one); an absent key decodes to `Option.none()`.
  axisRole: Schema.OptionFromOptional(AxisRole),
}) {}

/**
 * A durable binding set (ADR-0024): the actions a map declares (with value
 * kinds) plus default bindings per control scheme. A plugin contributes one as
 * its default map; a user remap overlay is the same shape, applied on top at
 * resolve time. The engine owns this schema; plugins/users supply the data.
 */
export class InputMap extends Schema.Class<InputMap>("InputMap")({
  id: BindingSetId,
  /** The actions this map satisfies + each action's value kind. */
  actions: Schema.Array(ActionDeclaration),
  /** Default bindings keyed by control scheme. */
  schemeDefaults: Schema.Record(ControlScheme, Schema.Array(InputBinding)),
}) {}

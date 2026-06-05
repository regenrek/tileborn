import { coreActionId, CORE_ACTIONS, CONTROL_SCHEMES, InputMap, type ActionId, type ActionState } from "@tileborne/core";
import type { Direction8 } from "@tileborne/ipc-contracts/protocols/battle-royale";
import { Schema } from "effect";

/**
 * Battle Royale's neutral input map + action→intent adapter (ADR-0024 Slice 6).
 *
 * BR declares its actions + default `keyboard-mouse` bindings as DATA (the typed
 * `RuntimeInputMapContribution` slot) reproducing today's controls exactly:
 * `Space`/mouse-0 → PrimaryAction, WASD/arrows → Move, `R` → Reload, `Digit/Numpad
 * 1-5` → Slot1-5, pointer → Aim. The engine resolver turns raw input into a
 * neutral `ActionState`; THIS module owns the only BR-specific step — mapping that
 * neutral state into BR's existing `{ dir, shoot, aimDeg, weaponSlot }` intent.
 * The engine never knows PrimaryAction means "shoot"; that is this adapter's job.
 */

/** Contribution id for BR's default input map registered via the typed slot. */
export const BR_INPUT_MAP_CONTRIBUTION_ID = "br-input-map";

/** Durable id of BR's default binding set. */
export const BR_INPUT_MAP_ID = "br-default-bindings";

/** Weapon slots BR exposes (Slot1..Slot5), in order. */
const BR_SLOT_ACTIONS = [
  CORE_ACTIONS.Slot1,
  CORE_ACTIONS.Slot2,
  CORE_ACTIONS.Slot3,
  CORE_ACTIONS.Slot4,
  CORE_ACTIONS.Slot5,
] as const;

const MOVE_ACTION: ActionId = coreActionId(CORE_ACTIONS.Move);
const AIM_ACTION: ActionId = coreActionId(CORE_ACTIONS.Aim);
const PRIMARY_ACTION: ActionId = coreActionId(CORE_ACTIONS.PrimaryAction);
const SLOT_ACTION_IDS: readonly ActionId[] = BR_SLOT_ACTIONS.map((action) => coreActionId(action));

interface RawTriggerData {
  readonly _tag: "key" | "mouseButton" | "axis" | "pointer" | "gamepadButton";
  readonly code?: string;
  readonly button?: number;
  readonly axis?: number;
  readonly sign?: number;
}

interface BindingData {
  readonly _tag: "InputBinding";
  readonly action: string;
  readonly trigger: RawTriggerData;
  readonly axisRole?: "x+" | "x-" | "y+" | "y-";
}

const keyBinding = (
  action: string,
  code: string,
  axisRole?: "x+" | "x-" | "y+" | "y-",
): BindingData => ({
  _tag: "InputBinding",
  action,
  trigger: { _tag: "key", code },
  ...(axisRole === undefined ? {} : { axisRole }),
});

const moveBindings = (): readonly BindingData[] => [
  keyBinding(CORE_ACTIONS.Move, "KeyW", "y-"),
  keyBinding(CORE_ACTIONS.Move, "ArrowUp", "y-"),
  keyBinding(CORE_ACTIONS.Move, "KeyS", "y+"),
  keyBinding(CORE_ACTIONS.Move, "ArrowDown", "y+"),
  keyBinding(CORE_ACTIONS.Move, "KeyA", "x-"),
  keyBinding(CORE_ACTIONS.Move, "ArrowLeft", "x-"),
  keyBinding(CORE_ACTIONS.Move, "KeyD", "x+"),
  keyBinding(CORE_ACTIONS.Move, "ArrowRight", "x+"),
];

const slotBindings = (): readonly BindingData[] =>
  BR_SLOT_ACTIONS.flatMap((action, index) => {
    const digit = index + 1;
    return [keyBinding(action, `Digit${digit}`), keyBinding(action, `Numpad${digit}`)];
  });

const primaryActionBindings = (): readonly BindingData[] => [
  keyBinding(CORE_ACTIONS.PrimaryAction, "Space"),
  { _tag: "InputBinding", action: CORE_ACTIONS.PrimaryAction, trigger: { _tag: "mouseButton", button: 0 } },
];

/**
 * Build BR's default input map as plain neutral DATA (the JSON shape declared in
 * the manifest's typed `inputMaps` slot and decoded by `@tileborne/plugin-api`'s
 * {@link decodeInputMap}). The engine owns the `InputMap` shape; BR supplies the
 * binding identities. Keep this in sync with the `tileborne-plugin.json`
 * `runtime.inputMaps` entry (the BR input-map test asserts the manifest decodes).
 */
export const buildBattleRoyaleInputMapData = (): {
  readonly id: string;
  readonly actions: readonly { readonly action: string; readonly valueKind: string }[];
  readonly schemeDefaults: Record<string, readonly BindingData[]>;
} => ({
  id: BR_INPUT_MAP_ID,
  actions: [
    { action: CORE_ACTIONS.Move, valueKind: "analog2d" },
    { action: CORE_ACTIONS.Aim, valueKind: "pointer" },
    { action: CORE_ACTIONS.PrimaryAction, valueKind: "digital" },
    { action: CORE_ACTIONS.Reload, valueKind: "digital" },
    { action: CORE_ACTIONS.Interact, valueKind: "digital" },
    ...BR_SLOT_ACTIONS.map((action) => ({ action, valueKind: "digital" })),
  ],
  schemeDefaults: {
    [CONTROL_SCHEMES.KeyboardMouse]: [
      ...moveBindings(),
      ...primaryActionBindings(),
      keyBinding(CORE_ACTIONS.Reload, "KeyR"),
      keyBinding(CORE_ACTIONS.Interact, "KeyE"),
      { _tag: "InputBinding", action: CORE_ACTIONS.Aim, trigger: { _tag: "pointer" } },
      ...slotBindings(),
    ],
  },
});

/**
 * Decode BR's default {@link buildBattleRoyaleInputMapData} into a typed
 * `@tileborne/core` {@link InputMap}. Self-contained (validates against the core
 * schema directly) so the renderer playtest host can build the resolver's
 * effective map without reaching for the host registry. The user-remap overlay
 * is applied on top of this by the engine (`resolveEffectiveInputMap`).
 */
export const battleRoyaleDefaultInputMap = (): InputMap =>
  Schema.decodeUnknownSync(InputMap)(buildBattleRoyaleInputMapData());

/**
 * BR's runtime intent produced from neutral actions — the existing
 * `ClientInputFrame` payload minus the renderer-owned `tick`/`seq`. `dir` is
 * `undefined` when the player is not moving (matches today's "no movement key"
 * idle), `aimDeg` is `undefined` until the pointer has moved.
 */
export interface BattleRoyaleInputIntent {
  readonly dir: Direction8 | undefined;
  readonly shoot: boolean;
  readonly aimDeg?: number;
  readonly weaponSlot?: number;
}

/** Origin (viewport-center / local-player screen position) aim angle is measured from. */
export interface BattleRoyaleAimContext {
  readonly aimOrigin?: { readonly x: number; readonly y: number };
}

/**
 * Compute the integer aim angle in degrees [0, 359] from a pointer position to
 * the aim origin (DOM screen-space: y grows downward; 0° east, 90° south).
 * Moved here from the renderer (ADR-0024 hard-cut): aim→angle is BR intent, not
 * engine resolution.
 */
const computeAimDeg = (pointerX: number, pointerY: number, originX: number, originY: number): number => {
  const dx = pointerX - originX;
  const dy = pointerY - originY;
  if (dx === 0 && dy === 0) {
    return 0;
  }
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((Math.round(raw) % 360) + 360) % 360;
};

/** Quantize a Move analog vector into the 8-way `Direction8` (or `undefined` when idle). */
const moveVectorToDirection = (x: number, y: number): Direction8 | undefined => {
  const dx = Math.sign(x);
  const dy = Math.sign(y);
  if (dx === 0 && dy === 0) {
    return undefined;
  }
  if (dx === 1 && dy === 0) return 0;
  if (dx === 1 && dy === 1) return 1;
  if (dx === 0 && dy === 1) return 2;
  if (dx === -1 && dy === 1) return 3;
  if (dx === -1 && dy === 0) return 4;
  if (dx === -1 && dy === -1) return 5;
  if (dx === 0 && dy === -1) return 6;
  return 7;
};

/**
 * The BR action→intent adapter (ADR-0024). Maps a neutral {@link ActionState}
 * into BR's `{ dir, shoot, aimDeg, weaponSlot }` intent so the renderer/host can
 * encode the current `ClientInputFrame` shape. PrimaryAction→shoot, Move→dir,
 * Aim(pointer)→aimDeg, the first just-pressed SlotN→weaponSlot.
 */
export const resolveBattleRoyaleInputIntent = (
  actions: ActionState,
  context: BattleRoyaleAimContext = {},
): BattleRoyaleInputIntent => {
  const move = actions.analog.get(MOVE_ACTION);
  const dir = move === undefined ? undefined : moveVectorToDirection(move.x, move.y);
  const shoot = actions.digital.get(PRIMARY_ACTION)?.pressed ?? false;

  let aimDeg: number | undefined;
  const pointer = actions.pointer.get(AIM_ACTION);
  if (pointer !== undefined && context.aimOrigin !== undefined) {
    aimDeg = computeAimDeg(pointer.x, pointer.y, context.aimOrigin.x, context.aimOrigin.y);
  }

  let weaponSlot: number | undefined;
  for (let index = 0; index < SLOT_ACTION_IDS.length; index += 1) {
    const slotAction = SLOT_ACTION_IDS[index] as ActionId;
    if (actions.digital.get(slotAction)?.justPressed === true) {
      weaponSlot = index + 1;
      break;
    }
  }

  return {
    dir,
    shoot,
    ...(aimDeg === undefined ? {} : { aimDeg }),
    ...(weaponSlot === undefined ? {} : { weaponSlot }),
  };
};

import { Schema } from 'effect';

/**
 * Neutral, OPEN control-scheme tag (ADR-0024). A branded string selecting which
 * device families + binding shapes apply. Engine-shipped baseline ids live in
 * {@link CONTROL_SCHEMES}; it stays open so a new device family is added as data,
 * not a closed engine enum.
 */
export const ControlScheme = Schema.String.pipe(Schema.brand('ControlScheme'));
export type ControlScheme = typeof ControlScheme.Type;

/** Brand a raw string as a {@link ControlScheme} (keeps the cast in one place). */
export const makeControlScheme = (id: string): ControlScheme =>
  Schema.decodeUnknownSync(ControlScheme)(id);

/**
 * Engine-shipped baseline control schemes (constants, not a closed `Schema`
 * union):
 * - `keyboard-mouse` — keys + mouse buttons + pointer-derived aim;
 * - `gamepad` — buttons + axes, pointer-less aim from the right stick;
 * - `twin-stick` — left stick = Move, right stick = Aim, face/trigger buttons.
 */
export const CONTROL_SCHEMES = {
  KeyboardMouse: 'keyboard-mouse',
  Gamepad: 'gamepad',
  TwinStick: 'twin-stick',
} as const;

/** All baseline control-scheme id strings (for iteration / validation). */
export const CONTROL_SCHEME_IDS: readonly string[] = Object.values(CONTROL_SCHEMES);

/** Brand a {@link CONTROL_SCHEMES} value as a {@link ControlScheme}. */
export const controlScheme = (
  id: (typeof CONTROL_SCHEMES)[keyof typeof CONTROL_SCHEMES],
): ControlScheme => id as string as ControlScheme;

/**
 * Which output axis + sign an analog-binding trigger contributes to, for
 * `analog1d` / `analog2d` actions. `x-`/`y-` negate the contribution; `x+`/`y+`
 * add it. (e.g. the "move left" key carries `x-`.)
 */
export const AxisRole = Schema.Literals(['x+', 'x-', 'y+', 'y-']);
export type AxisRole = typeof AxisRole.Type;

import type { ActionId } from './actions.js';

/**
 * The neutral, per-tick output of the engine input resolver (ADR-0024). A pure,
 * worker-safe value type (no Schema needed — it is transient, not durable) the
 * renderer + game-host consume and a plugin maps to its own runtime intent. The
 * engine never names what an action *does*; it only reports filled actions.
 */
export interface DigitalActionState {
  /** True while at least one bound trigger for the action is held this tick. */
  readonly pressed: boolean;
  /** True on the tick the action transitions released → pressed. */
  readonly justPressed: boolean;
  /** True on the tick the action transitions pressed → released. */
  readonly justReleased: boolean;
}

/** A 2D value for `analog2d` / `pointer` actions (`analog1d` uses `x` only). */
export interface Vector2State {
  readonly x: number;
  readonly y: number;
}

export interface ActionState {
  readonly digital: ReadonlyMap<ActionId, DigitalActionState>;
  readonly analog: ReadonlyMap<ActionId, Vector2State>;
  readonly pointer: ReadonlyMap<ActionId, Vector2State>;
}

/** An all-empty {@link ActionState} (no action filled this tick). */
export const emptyActionState = (): ActionState => ({
  digital: new Map(),
  analog: new Map(),
  pointer: new Map(),
});

import {
  emptyActionState,
  type ActionId,
  type ActionState,
  type ControlScheme,
  type DigitalActionState,
  type InputBinding,
  type InputMap,
  type RawTrigger,
  type Vector2State,
} from '@tileborne/core';
import { Option } from 'effect';

import { InputState, type InputEvent } from './input.js';

/**
 * Analog stick magnitude below which an axis trigger is treated as released
 * (digital edge). Tuning only — NOT a binding literal; the binding identity is
 * the decoded {@link InputMap}, never a baked key/button constant.
 */
const AXIS_DEADZONE = 0.2;

const clampAxis = (value: number): number =>
  Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

const roleSignValue = (role: 'x+' | 'x-' | 'y+' | 'y-'): number => (role.endsWith('+') ? 1 : -1);

/**
 * The single engine place where raw input becomes neutral meaning (ADR-0024).
 *
 * Pure + worker-safe: it owns no DOM/Pixi/Electron/Node — it accumulates raw
 * {@link InputEvent}s into the reused {@link InputState} and resolves them into a
 * neutral {@link ActionState} through a DATA-declared {@link InputMap} (plugin
 * defaults ⊕ user remaps) for an active {@link ControlScheme}. There is NO baked
 * `KeyA→left` / `Space→fire` switch; the mapping is the `effectiveMap` argument.
 * The same resolver runs in the renderer playtest host and in `apps/game-host`.
 */
export class InputResolver {
  private readonly state = new InputState();
  private readonly previousDigital = new Map<string, boolean>();

  constructor(
    private effectiveMap: InputMap,
    private scheme: ControlScheme,
  ) {}

  /** Swap the active effective map (plugin defaults ⊕ user overlay). Remap seam. */
  setEffectiveMap(map: InputMap): void {
    this.effectiveMap = map;
  }

  /** Swap the active control scheme (keyboard-mouse / gamepad / twin-stick). */
  setScheme(scheme: ControlScheme): void {
    this.scheme = scheme;
  }

  /** Accumulate one raw input event into the device state. */
  apply(event: InputEvent): void {
    this.state.apply(event);
  }

  /** Accumulate a batch of raw events (deterministic replay log friendly). */
  applyMany(events: Iterable<InputEvent>): void {
    for (const event of events) {
      this.state.apply(event);
    }
  }

  private bindingsForScheme(): readonly InputBinding[] {
    return this.effectiveMap.schemeDefaults[this.scheme] ?? [];
  }

  private triggerHeld(trigger: RawTrigger): boolean {
    switch (trigger._tag) {
      case 'key':
        return this.state.pressedKeys.has(trigger.code);
      case 'mouseButton':
        return this.state.pressedMouseButtons.has(trigger.button);
      case 'axis': {
        const value = this.axisValue(trigger.axis);
        return trigger.sign > 0 ? value > AXIS_DEADZONE : value < -AXIS_DEADZONE;
      }
      case 'pointer':
        return true;
      // No raw gamepad-button source exists in the InputEvent union yet; such a
      // binding decodes + persists but resolves inactive until a source lands.
      case 'gamepadButton':
        return false;
    }
  }

  private axisValue(axis: number): number {
    return clampAxis(this.state.gamepadAxes.get(`0:${axis}`) ?? 0);
  }

  private resolveDigital(action: ActionId, bindings: readonly InputBinding[]): DigitalActionState {
    const pressed = bindings.some((binding) => this.triggerHeld(binding.trigger));
    const key = action as string;
    const previous = this.previousDigital.get(key) ?? false;
    return {
      pressed,
      justPressed: pressed && !previous,
      justReleased: !pressed && previous,
    };
  }

  private resolveAnalog(bindings: readonly InputBinding[], oneDimensional: boolean): Vector2State {
    let x = 0;
    let y = 0;
    for (const binding of bindings) {
      const role = Option.getOrUndefined(binding.axisRole);
      if (role === undefined) {
        continue;
      }
      const toX = role.startsWith('x');
      if (oneDimensional && !toX) {
        continue;
      }
      const contribution =
        binding.trigger._tag === 'axis'
          ? this.axisValue(binding.trigger.axis)
          : this.triggerHeld(binding.trigger)
            ? roleSignValue(role)
            : 0;
      if (toX) {
        x += contribution;
      } else {
        y += contribution;
      }
    }
    return { x: clampAxis(x), y: oneDimensional ? 0 : clampAxis(y) };
  }

  private resolvePointer(bindings: readonly InputBinding[]): Vector2State | undefined {
    const hasPointer = bindings.some((binding) => binding.trigger._tag === 'pointer');
    return hasPointer ? { x: this.state.mouse.x, y: this.state.mouse.y } : undefined;
  }

  /**
   * Resolve the accumulated raw state into neutral actions for this tick. Pure
   * over `(effectiveMap, scheme, accumulated InputState)` — the same event log +
   * map yields the same {@link ActionState} (determinism for replay/remap tests).
   */
  resolve(): ActionState {
    const bindings = this.bindingsForScheme();
    const byAction = new Map<string, InputBinding[]>();
    for (const binding of bindings) {
      const list = byAction.get(binding.action as string);
      if (list === undefined) {
        byAction.set(binding.action as string, [binding]);
      } else {
        list.push(binding);
      }
    }

    const result = emptyActionState();
    const digital = result.digital as Map<ActionId, DigitalActionState>;
    const analog = result.analog as Map<ActionId, Vector2State>;
    const pointer = result.pointer as Map<ActionId, Vector2State>;

    const nextDigital = new Map<string, boolean>();
    for (const declaration of this.effectiveMap.actions) {
      const actionBindings = byAction.get(declaration.action as string) ?? [];
      switch (declaration.valueKind) {
        case 'digital': {
          const resolved = this.resolveDigital(declaration.action, actionBindings);
          digital.set(declaration.action, resolved);
          nextDigital.set(declaration.action as string, resolved.pressed);
          break;
        }
        case 'analog1d':
          analog.set(declaration.action, this.resolveAnalog(actionBindings, true));
          break;
        case 'analog2d':
          analog.set(declaration.action, this.resolveAnalog(actionBindings, false));
          break;
        case 'pointer': {
          const resolved = this.resolvePointer(actionBindings);
          if (resolved !== undefined) {
            pointer.set(declaration.action, resolved);
          }
          break;
        }
      }
    }

    this.previousDigital.clear();
    for (const [key, value] of nextDigital) {
      this.previousDigital.set(key, value);
    }
    return result;
  }
}

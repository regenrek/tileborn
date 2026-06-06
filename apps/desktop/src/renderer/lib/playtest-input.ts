import type { ActionState, ControlScheme, InputMap } from '@tileborne/core';
import {
  InputResolver,
  KeyInputEvent,
  MouseButtonInputEvent,
  MouseMoveInputEvent,
} from '@tileborne/runtime';

/**
 * Neutral playtest input capture (ADR-0024).
 *
 * The renderer NO LONGER interprets keys: it captures raw DOM key/mouse events,
 * feeds them to the engine `InputResolver` over a DATA-declared `InputMap`, and
 * hands the resolved neutral `ActionState` to the active plugin's action→intent
 * adapter. `SHOOT_KEY = 'Space'`, `movementKeysToDirection`, `parseWeaponSlotKey`,
 * and `computeAimDeg` are HARD-CUT — what `PrimaryAction` binds to (Space, mouse,
 * or both) is now a property of the `InputMap`, not a renderer literal.
 */

/** The wire intent the runtime + BR expect, produced by a plugin action→intent adapter. */
export interface ResolvedInputIntent {
  /** 8-way movement direction, or `undefined` when idle. */
  readonly dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | undefined;
  readonly shoot: boolean;
  readonly aimDeg?: number;
  readonly weaponSlot?: number;
}

export interface InputCaptureProfile {
  /** Key codes bound in the active scheme (the only keys the capture reacts to). */
  readonly boundKeyCodes: ReadonlySet<string>;
  /** Whether any binding in the active scheme uses a mouse button. */
  readonly usesMouseButtons: boolean;
}

/**
 * Derive which raw key codes + whether mouse buttons are bound in a scheme, so
 * the capture only `preventDefault`s + reacts to relevant input (and ignores
 * everything else) — without the renderer ever naming a key literal itself.
 */
export const deriveInputCaptureProfile = (
  inputMap: InputMap,
  scheme: ControlScheme,
): InputCaptureProfile => {
  const bindings = inputMap.schemeDefaults[scheme] ?? [];
  const boundKeyCodes = new Set<string>();
  let usesMouseButtons = false;
  for (const binding of bindings) {
    if (binding.trigger._tag === 'key') {
      boundKeyCodes.add(binding.trigger.code);
    } else if (binding.trigger._tag === 'mouseButton') {
      usesMouseButtons = true;
    }
  }
  return { boundKeyCodes, usesMouseButtons };
};

export interface PlaytestInputCaptureOptions {
  readonly container: HTMLElement | null;
  readonly inputMap: InputMap;
  readonly controlScheme: ControlScheme;
  readonly profile: InputCaptureProfile;
  /** The active plugin's action→intent adapter (e.g. BR's PrimaryAction→shoot). */
  readonly resolveIntent: (
    actions: ActionState,
    context: { aimOrigin?: { x: number; y: number } },
  ) => ResolvedInputIntent;
  /** Called with the produced intent whenever bound input changes. */
  readonly onIntent: (intent: ResolvedInputIntent) => void;
}

export interface PlaytestInputCaptureHandle {
  /**
   * Live-swap the effective input map (ADR-0024 remap seam): apply a freshly
   * resolved `pluginDefault ⊕ userOverlay` map to the running resolver
   * (`InputResolver.setEffectiveMap`) and re-derive which raw keys/buttons the
   * capture reacts to, so a rebind applies WITHOUT tearing down + recreating the
   * capture (which would drop held key/mouse state). The control scheme is
   * unchanged.
   */
  setEffectiveMap(inputMap: InputMap): void;
  dispose(): void;
}

/**
 * Attach raw-event capture for a playtest viewport. Wires window key listeners +
 * container mouse listeners into one engine `InputResolver`; on each bound-input
 * change it resolves neutral actions and emits the plugin intent. Pointer moves
 * update aim state but do not emit on their own (aim rides the next key/mouse
 * send, matching the prior cadence).
 */
export const attachPlaytestInputCapture = (
  options: PlaytestInputCaptureOptions,
): PlaytestInputCaptureHandle => {
  const { container, inputMap, controlScheme, profile, resolveIntent, onIntent } = options;
  const resolver = new InputResolver(inputMap, controlScheme);
  // The capture profile (which raw keys/buttons we react to) is derived from the
  // effective map and re-derived on a live remap (`setEffectiveMap`), so it is
  // mutable rather than a fixed destructured value.
  let currentProfile = profile;
  const heldKeys = new Set<string>();
  // Mouse buttons we have seen pressed in-viewport but not yet released. The
  // release listener lives on `window` (below) so a press that starts in the
  // viewport but is released ANYWHERE still clears the button — otherwise a
  // mouseup outside the container never arrives and PrimaryAction sticks
  // pressed (BR keeps shooting). Tracking the held set lets a global mouseup be
  // honored only for the button we actually bound.
  const heldMouseButtons = new Set<number>();
  let pointerMoved = false;

  const aimOrigin = (): { x: number; y: number } | undefined => {
    if (!pointerMoved || !container) {
      return undefined;
    }
    return { x: container.clientWidth / 2, y: container.clientHeight / 2 };
  };

  const emit = (): void => {
    const origin = aimOrigin();
    onIntent(resolveIntent(resolver.resolve(), origin === undefined ? {} : { aimOrigin: origin }));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!currentProfile.boundKeyCodes.has(event.code)) {
      return;
    }
    event.preventDefault();
    if (heldKeys.has(event.code)) {
      return;
    }
    heldKeys.add(event.code);
    resolver.apply(new KeyInputEvent({ tick: 0, code: event.code, pressed: true }));
    emit();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (!currentProfile.boundKeyCodes.has(event.code)) {
      return;
    }
    event.preventDefault();
    heldKeys.delete(event.code);
    resolver.apply(new KeyInputEvent({ tick: 0, code: event.code, pressed: false }));
    emit();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    resolver.apply(
      new MouseMoveInputEvent({ tick: 0, x: event.clientX - rect.left, y: event.clientY - rect.top }),
    );
    pointerMoved = true;
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (!currentProfile.usesMouseButtons) {
      return;
    }
    event.preventDefault();
    heldMouseButtons.add(event.button);
    resolver.apply(new MouseButtonInputEvent({ tick: 0, button: event.button, pressed: true }));
    emit();
  };

  // Release is global: a press starts in-viewport (container `mousedown`) but a
  // release may land outside the container, so the listener is on `window`. We
  // only react to buttons we actually saw pressed so unrelated clicks elsewhere
  // are ignored (and we never `preventDefault` a release we are not handling).
  const onMouseUp = (event: MouseEvent): void => {
    if (!currentProfile.usesMouseButtons || !heldMouseButtons.delete(event.button)) {
      return;
    }
    event.preventDefault();
    resolver.apply(new MouseButtonInputEvent({ tick: 0, button: event.button, pressed: false }));
    emit();
  };

  const releaseHeldInputs = (): void => {
    if (heldKeys.size === 0 && heldMouseButtons.size === 0) {
      return;
    }
    for (const code of heldKeys) {
      resolver.apply(new KeyInputEvent({ tick: 0, code, pressed: false }));
    }
    for (const button of heldMouseButtons) {
      resolver.apply(new MouseButtonInputEvent({ tick: 0, button, pressed: false }));
    }
    heldKeys.clear();
    heldMouseButtons.clear();
    emit();
  };

  const documentStillHasFocus = (): boolean => {
    try {
      return document.hasFocus();
    } catch {
      return false;
    }
  };

  const onWindowBlur = (): void => {
    if (documentStillHasFocus()) {
      return;
    }
    releaseHeldInputs();
  };

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      releaseHeldInputs();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);
  container?.addEventListener('pointermove', onPointerMove);
  container?.addEventListener('mousedown', onMouseDown);

  return {
    setEffectiveMap: (nextMap: InputMap): void => {
      resolver.setEffectiveMap(nextMap);
      currentProfile = deriveInputCaptureProfile(nextMap, controlScheme);
    },
    dispose: (): void => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      container?.removeEventListener('pointermove', onPointerMove);
      container?.removeEventListener('mousedown', onMouseDown);
    },
  };
};

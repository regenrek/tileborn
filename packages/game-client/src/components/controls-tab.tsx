import {
  RawTrigger,
  type ActionDeclaration,
  type ActionId,
  type ControlScheme,
  type InputMap,
} from '@tileborne/core';
import { Button } from '@tileborne/ui';
import { Schema } from 'effect';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import {
  effectiveBindingsForAction,
  rebindActionTrigger,
  resetActionInScheme,
  triggerLabel,
  type UserInputBindingsStore,
} from '../input/user-bindings.js';

export interface ControlsTabConfig {
  /** The active plugin/mode's DEFAULT input map (the base the overlay layers on). */
  readonly inputMap: InputMap;
  /** The control scheme being edited (keyboard-mouse today). */
  readonly scheme: ControlScheme;
  /** Persistence port for the user remap overlay. */
  readonly store: UserInputBindingsStore;
  /**
   * Optional live-apply hook fired with the persisted overlay on Save. A host
   * running the engine resolver can pass `resolveEffectiveInputMap` +
   * `resolver.setEffectiveMap` here to apply a rebind without a reload.
   */
  readonly onApply?: (overlay: InputMap | undefined) => void;
}

/** Only digital actions are single-trigger remappable here; analog/pointer are read-only. */
const isRemappable = (declaration: ActionDeclaration): boolean =>
  declaration.valueKind === 'digital';

const decodeTrigger = (data: unknown): RawTrigger => Schema.decodeUnknownSync(RawTrigger)(data);

/**
 * Generic keybind remap editor for the Controls settings tab (ADR-0024). Lists
 * the active mode's declared actions + their EFFECTIVE bindings (plugin defaults
 * ⊕ user overlay) for the active scheme, captures a new key/mouse trigger to
 * rebind a (digital) action, supports reset-to-default, and persists the overlay
 * via the injected store. Names no binding literal — it edits the neutral
 * `InputMap`; the concrete "PrimaryAction Space→mouse/key" remap flows through
 * this UI.
 */
export function ControlsTab({ inputMap, scheme, store, onApply }: ControlsTabConfig): ReactElement {
  const [overlay, setOverlay] = useState<InputMap | undefined>(() => store.load());
  const [capturing, setCapturing] = useState<ActionId | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  // The controls UI root. A `mousedown` on `window` fires BEFORE a button's
  // React `click`, so while capturing we must ignore presses that land inside
  // this container (Cancel/Reset/Save) — otherwise clicking "Cancel" would be
  // captured as a mouse-button rebind for the action being remapped.
  const containerRef = useRef<HTMLDivElement>(null);

  const applyTrigger = useCallback(
    (action: ActionId, trigger: RawTrigger): void => {
      setOverlay((current) =>
        rebindActionTrigger({ base: inputMap, overlay: current, scheme, action, trigger }),
      );
      setCapturing(undefined);
      setSaved(false);
    },
    [inputMap, scheme],
  );

  // While capturing, the NEXT key or mouse press becomes the action's trigger.
  // Listeners attach after the initiating click resolves (effect runs post-render)
  // so the click that started capture is not itself captured. Escape cancels.
  useEffect(() => {
    if (capturing === undefined) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      if (event.code === 'Escape') {
        setCapturing(undefined);
        return;
      }
      applyTrigger(capturing, decodeTrigger({ _tag: 'key', code: event.code }));
    };
    const onMouseDown = (event: MouseEvent): void => {
      // A press inside the controls UI (e.g. the Cancel/Reset buttons) is a UI
      // interaction, not a rebind trigger — ignore it so the button's own click
      // handler runs and the capture is not hijacked. Escape still cancels.
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target) === true) {
        return;
      }
      event.preventDefault();
      applyTrigger(capturing, decodeTrigger({ _tag: 'mouseButton', button: event.button }));
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [capturing, applyTrigger]);

  const resetAction = (action: ActionId): void => {
    setOverlay((current) => resetActionInScheme({ overlay: current, scheme, action }));
    setSaved(false);
  };

  const resetAll = (): void => {
    setOverlay(undefined);
    setCapturing(undefined);
    setSaved(false);
  };

  const save = (): void => {
    if (overlay === undefined) {
      store.clear();
    } else {
      store.save(overlay);
    }
    onApply?.(overlay);
    setSaved(true);
  };

  return (
    <div data-testid="controls-tab" ref={containerRef}>
      <p className="tb-tagline">
        Rebind an action: press <strong>Rebind</strong>, then the new key or mouse button. Save to
        persist; Reset restores the default.
      </p>

      <div className="tb-section-label">{scheme} bindings</div>
      <ul className="tb-controls-list">
        {inputMap.actions.map((declaration) => {
          const action = declaration.action;
          const actionId = action as string;
          const bindings = effectiveBindingsForAction(inputMap, overlay, scheme, action);
          const label =
            bindings.length === 0
              ? 'Unbound'
              : bindings.map((binding) => triggerLabel(binding.trigger)).join(', ');
          const remappable = isRemappable(declaration);
          const isCapturing = capturing === action;
          return (
            <li
              key={actionId}
              className="tb-controls-row"
              data-testid={`controls-action-${actionId}`}
            >
              <span className="tb-controls-action">{actionId}</span>
              <span className="tb-controls-binding" data-testid={`controls-binding-${actionId}`}>
                {isCapturing ? 'Press a key or mouse button…' : label}
              </span>
              {remappable ? (
                <span className="tb-controls-actions">
                  <Button
                    size="sm"
                    variant={isCapturing ? 'default' : 'outline'}
                    aria-pressed={isCapturing}
                    onClick={() => {
                      setCapturing(isCapturing ? undefined : action);
                      setSaved(false);
                    }}
                    data-testid={`controls-rebind-${actionId}`}
                  >
                    {isCapturing ? 'Cancel' : 'Rebind'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resetAction(action)}
                    data-testid={`controls-reset-${actionId}`}
                  >
                    Reset
                  </Button>
                </span>
              ) : (
                <span className="tb-controls-readonly">fixed</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="tb-actions-row" style={{ marginTop: '1rem' }}>
        <Button size="sm" onClick={save} data-testid="controls-save">
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={resetAll} data-testid="controls-reset-all">
          Reset all
        </Button>
        {saved ? (
          <span className="tb-tagline" data-testid="controls-saved" style={{ margin: 'auto 0' }}>
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

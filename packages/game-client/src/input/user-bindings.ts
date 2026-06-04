import {
  InputMap,
  RawTrigger,
  type ActionId,
  type ActionValueKind,
  type ControlScheme,
  type InputBinding,
} from "@tileborne/core";
import { resolveEffectiveInputMap } from "@tileborne/plugin-api";
import { Option, Schema } from "effect";

/**
 * User keybind remap model + persistence for the game-client Controls UI
 * (ADR-0024 "Remap UI + persistence ownership").
 *
 * A user override is a PARTIAL {@link InputMap} OVERLAY: per-action, per-scheme
 * rebindings layered on the active plugin's default map by the engine via
 * {@link resolveEffectiveInputMap}. This module is brand- and plugin-neutral —
 * it never names a binding literal; it edits the neutral `InputMap` the engine
 * owns. Persistence stores the overlay as the canonical `@tileborne/core`
 * `InputMap` Schema encoding (no bespoke wire format) so the same durable bytes
 * are loaded + applied by the engine resolver (in the game client and the
 * desktop playtest host alike).
 */

/** Durable id stamped on the user remap overlay binding set. */
export const USER_OVERLAY_BINDING_SET_ID = "user-overlay";

/**
 * `localStorage` key for the persisted user overlay. Versioned for forward
 * migration. MUST stay in sync with the desktop playtest prefs key
 * (`apps/desktop/.../playtest-user-bindings.ts`) — they share one durable
 * contract so a remap saved here is the overlay the playtest reads.
 */
export const USER_INPUT_OVERLAY_STORAGE_KEY = "tileborne:input:user-overlay:v1";

/** Persistence port for the user remap overlay (localStorage-backed by default). */
export interface UserInputBindingsStore {
  /** Load the persisted overlay, or `undefined` when none / undecodable. */
  load(): InputMap | undefined;
  /** Persist the overlay as its canonical `InputMap` encoding. */
  save(overlay: InputMap): void;
  /** Drop the persisted overlay (reset-to-defaults). */
  clear(): void;
}

const decodeOverlay = (raw: string): InputMap | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(InputMap)(parsed));
};

/**
 * Build a {@link UserInputBindingsStore} over a `Storage` (browser
 * `localStorage` by default; inject a fake for tests). When no storage is
 * available (non-DOM context) the store is a safe no-op that always loads
 * `undefined`.
 */
export const createLocalStorageBindingsStore = (options?: {
  readonly storage?: Storage;
  readonly key?: string;
}): UserInputBindingsStore => {
  const key = options?.key ?? USER_INPUT_OVERLAY_STORAGE_KEY;
  const storage =
    options?.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  return {
    load: (): InputMap | undefined => {
      if (storage === undefined) {
        return undefined;
      }
      const raw = storage.getItem(key);
      return raw === null ? undefined : decodeOverlay(raw);
    },
    save: (overlay: InputMap): void => {
      storage?.setItem(key, JSON.stringify(Schema.encodeUnknownSync(InputMap)(overlay)));
    },
    clear: (): void => {
      storage?.removeItem(key);
    },
  };
};

/** Mutable plain-data form of an `InputMap` (its Schema encoding) we edit between decodes. */
interface OverlayBindingData {
  readonly _tag: "InputBinding";
  readonly action: string;
  readonly trigger: unknown;
  readonly axisRole?: "x+" | "x-" | "y+" | "y-";
}

interface OverlayData {
  id: string;
  actions: { action: string; valueKind: ActionValueKind }[];
  schemeDefaults: Record<string, OverlayBindingData[]>;
}

const emptyOverlayData = (): OverlayData => ({
  id: USER_OVERLAY_BINDING_SET_ID,
  actions: [],
  schemeDefaults: {},
});

// Round-trip the decoded overlay through its JSON encoding to get a mutable,
// structurally-cloned plain object we can edit, then re-decode (which validates).
const toMutableData = (overlay: InputMap): OverlayData =>
  JSON.parse(JSON.stringify(Schema.encodeUnknownSync(InputMap)(overlay))) as OverlayData;

/** The effective (default ⊕ overlay) bindings for one action in one scheme. */
export const effectiveBindingsForAction = (
  base: InputMap,
  overlay: InputMap | undefined,
  scheme: ControlScheme,
  action: ActionId,
): readonly InputBinding[] => {
  const effective = resolveEffectiveInputMap(base, overlay);
  const bindings = effective.schemeDefaults[scheme] ?? [];
  return bindings.filter((binding) => (binding.action as string) === (action as string));
};

/**
 * Rebind an action's trigger for one control scheme: produce a NEW overlay where
 * the action's bindings IN THAT SCHEME are replaced by the single captured
 * trigger. Non-destructive on the plugin defaults (the overlay only carries the
 * remapped action); the action's value-kind declaration is copied from the base
 * map so the overlay stays self-describing.
 */
export const rebindActionTrigger = (params: {
  readonly base: InputMap;
  readonly overlay: InputMap | undefined;
  readonly scheme: ControlScheme;
  readonly action: ActionId;
  readonly trigger: RawTrigger;
}): InputMap => {
  const { base, overlay, scheme, action, trigger } = params;
  const data = overlay === undefined ? emptyOverlayData() : toMutableData(overlay);
  const actionId = action as string;

  if (!data.actions.some((declaration) => declaration.action === actionId)) {
    const baseDeclaration = base.actions.find(
      (declaration) => (declaration.action as string) === actionId,
    );
    if (baseDeclaration !== undefined) {
      data.actions.push({ action: actionId, valueKind: baseDeclaration.valueKind });
    }
  }

  const triggerData = Schema.encodeUnknownSync(RawTrigger)(trigger);
  const kept = (data.schemeDefaults[scheme] ?? []).filter((binding) => binding.action !== actionId);
  data.schemeDefaults[scheme] = [
    ...kept,
    { _tag: "InputBinding", action: actionId, trigger: triggerData },
  ];

  return Schema.decodeUnknownSync(InputMap)(data);
};

/**
 * Reset one action in one scheme back to the plugin default: drop its overlay
 * entry (and its now-unused declaration). Returns the trimmed overlay, or
 * `undefined` when the overlay becomes empty (no remaps left → use defaults).
 */
export const resetActionInScheme = (params: {
  readonly overlay: InputMap | undefined;
  readonly scheme: ControlScheme;
  readonly action: ActionId;
}): InputMap | undefined => {
  const { overlay, scheme, action } = params;
  if (overlay === undefined) {
    return undefined;
  }
  const data = toMutableData(overlay);
  const actionId = action as string;

  const kept = (data.schemeDefaults[scheme] ?? []).filter((binding) => binding.action !== actionId);
  if (kept.length === 0) {
    delete data.schemeDefaults[scheme];
  } else {
    data.schemeDefaults[scheme] = kept;
  }

  const stillBound = Object.values(data.schemeDefaults).some((bindings) =>
    bindings.some((binding) => binding.action === actionId),
  );
  if (!stillBound) {
    data.actions = data.actions.filter((declaration) => declaration.action !== actionId);
  }

  if (data.actions.length === 0 && Object.keys(data.schemeDefaults).length === 0) {
    return undefined;
  }
  return Schema.decodeUnknownSync(InputMap)(data);
};

const KEY_LABEL_PREFIXES: readonly [string, string][] = [
  ["Key", ""],
  ["Digit", ""],
  ["Numpad", "Numpad "],
  ["Arrow", "Arrow "],
];

const labelForKeyCode = (code: string): string => {
  for (const [prefix, replacement] of KEY_LABEL_PREFIXES) {
    if (code.startsWith(prefix) && code.length > prefix.length) {
      return `${replacement}${code.slice(prefix.length)}`;
    }
  }
  return code;
};

const MOUSE_BUTTON_LABELS: Record<number, string> = {
  0: "Left",
  1: "Middle",
  2: "Right",
};

/**
 * A short, human-readable label for a raw trigger (e.g. `Space`, `F`, `Mouse
 * Left`) for the remap editor. Display-only; never used as a binding identity.
 */
export const triggerLabel = (trigger: RawTrigger): string => {
  switch (trigger._tag) {
    case "key":
      return labelForKeyCode(trigger.code);
    case "mouseButton":
      return `Mouse ${MOUSE_BUTTON_LABELS[trigger.button] ?? `Button ${trigger.button}`}`;
    case "gamepadButton":
      return `Pad Button ${trigger.button}`;
    case "axis":
      return `Axis ${trigger.axis}${trigger.sign > 0 ? "+" : "-"}`;
    case "pointer":
      return "Pointer";
  }
};

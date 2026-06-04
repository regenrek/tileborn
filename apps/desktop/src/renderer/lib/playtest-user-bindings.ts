import { InputMap } from '@tileborne/core';
import { Option, Schema } from 'effect';

/**
 * Renderer-side persistence of the user's keybind remap overlay (ADR-0024
 * "Remap UI + persistence ownership").
 *
 * The persisted value is a partial {@link InputMap} OVERLAY (per-action,
 * per-scheme rebindings) — never a full copy of the plugin defaults. The engine
 * owns the `@tileborne/core` `InputMap` SHAPE; we persist that exact shape via
 * its Schema (no bespoke wire format), so the durable bytes are the canonical
 * engine type and decode back to it deterministically. At playtest the bridge
 * loads this overlay and feeds it to `resolveEffectiveInputMap(pluginDefault,
 * overlay)` so the resolver maps raw input through the remapped bindings.
 *
 * Persistence mechanism: browser `localStorage` in the renderer (the playtest
 * host runs in the Electron renderer; no IPC user-settings store exists for
 * input prefs yet, so the renderer-owned `localStorage` is the fitting store).
 * The key + serialization match `@tileborne/game-client`'s Controls store so a
 * remap saved in the player settings surface is the same durable overlay the
 * playtest reads.
 */

/**
 * `localStorage` key for the user input overlay. Versioned so a future schema
 * change can migrate rather than mis-decode. MUST stay in sync with the
 * `@tileborne/game-client` Controls store key (same durable contract).
 */
export const USER_INPUT_OVERLAY_STORAGE_KEY = 'tileborne:input:user-overlay:v1';

const resolveStorage = (storage?: Storage): Storage | undefined =>
  storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);

/**
 * Load the persisted user remap overlay, or `undefined` when none is stored,
 * the storage is unavailable (e.g. a non-DOM test/worker), or the stored value
 * does not decode against the current `InputMap` schema (treated as absent
 * rather than throwing — a corrupt overlay must never block playtest input).
 */
export const loadUserInputOverlay = (storage?: Storage): InputMap | undefined => {
  const store = resolveStorage(storage);
  if (store === undefined) {
    return undefined;
  }
  const raw = store.getItem(USER_INPUT_OVERLAY_STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(InputMap)(parsed));
};

/** Persist the user remap overlay as its canonical `InputMap` Schema encoding. */
export const saveUserInputOverlay = (overlay: InputMap, storage?: Storage): void => {
  const store = resolveStorage(storage);
  if (store === undefined) {
    return;
  }
  const encoded = Schema.encodeUnknownSync(InputMap)(overlay);
  store.setItem(USER_INPUT_OVERLAY_STORAGE_KEY, JSON.stringify(encoded));
};

/** Drop the persisted overlay (reset-to-defaults: resolver falls back to plugin defaults). */
export const clearUserInputOverlay = (storage?: Storage): void => {
  resolveStorage(storage)?.removeItem(USER_INPUT_OVERLAY_STORAGE_KEY);
};

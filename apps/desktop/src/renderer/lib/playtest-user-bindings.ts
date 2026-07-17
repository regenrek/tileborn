import type { InputMap } from '@tileborne/core';
import {
  createLocalStorageBindingsStore,
  USER_INPUT_OVERLAY_STORAGE_KEY,
} from '@tileborne/game-client';

export { USER_INPUT_OVERLAY_STORAGE_KEY };

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
 * Load the persisted user remap overlay, or `undefined` when none is stored,
 * the storage is unavailable (e.g. a non-DOM test/worker), or the stored value
 * does not decode against the current `InputMap` schema (treated as absent
 * rather than throwing — a corrupt overlay must never block playtest input).
 */
export const loadUserInputOverlay = (storage?: Storage): InputMap | undefined => {
  return createLocalStorageBindingsStore(storage === undefined ? undefined : { storage }).load();
};

/** Persist the user remap overlay as its canonical `InputMap` Schema encoding. */
export const saveUserInputOverlay = (overlay: InputMap, storage?: Storage): void => {
  createLocalStorageBindingsStore(storage === undefined ? undefined : { storage }).save(overlay);
};

/** Drop the persisted overlay (reset-to-defaults: resolver falls back to plugin defaults). */
export const clearUserInputOverlay = (storage?: Storage): void => {
  createLocalStorageBindingsStore(storage === undefined ? undefined : { storage }).clear();
};

import { HudLayout } from '@tileborne/core';
import { Option, Schema } from 'effect';

/**
 * Renderer-side persistence of the user's HUD customisation overlay (sibling
 * of the ADR-0024 keybind overlay in `playtest-user-bindings.ts`).
 *
 * The persisted value is a partial {@link HudLayout} OVERLAY (per-widget
 * placement overrides: move / reorder / hide / extra instances) — never a full
 * copy of the plugin default. The engine owns the `@tileborne/core`
 * `HudLayout` SHAPE; we persist that exact shape via its Schema, so the
 * durable bytes are the canonical engine type. At playtest the bridge loads
 * this overlay and feeds it to `resolveEffectiveHudLayout(pluginDefault,
 * overlay)` so the HUD renders the user's arrangement.
 */

/** `localStorage` key for the user HUD overlay. Versioned for future migration. */
export const USER_HUD_OVERLAY_STORAGE_KEY = 'tileborne:hud:user-overlay:v1';

const resolveStorage = (storage?: Storage): Storage | undefined =>
  storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);

/**
 * Load the persisted user HUD overlay, or `undefined` when none is stored,
 * the storage is unavailable, or the stored value does not decode against the
 * current `HudLayout` schema (treated as absent rather than throwing — a
 * corrupt overlay must never block the playtest HUD).
 */
export const loadUserHudOverlay = (storage?: Storage): HudLayout | undefined => {
  const store = resolveStorage(storage);
  if (store === undefined) {
    return undefined;
  }
  const raw = store.getItem(USER_HUD_OVERLAY_STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(HudLayout)(parsed));
};

/** Persist the user HUD overlay as its canonical `HudLayout` Schema encoding. */
export const saveUserHudOverlay = (overlay: HudLayout, storage?: Storage): void => {
  const store = resolveStorage(storage);
  if (store === undefined) {
    return;
  }
  const encoded = Schema.encodeUnknownSync(HudLayout)(overlay);
  store.setItem(USER_HUD_OVERLAY_STORAGE_KEY, JSON.stringify(encoded));
};

/** Drop the persisted overlay (reset-to-defaults: HUD falls back to the plugin layout). */
export const clearUserHudOverlay = (storage?: Storage): void => {
  resolveStorage(storage)?.removeItem(USER_HUD_OVERLAY_STORAGE_KEY);
};

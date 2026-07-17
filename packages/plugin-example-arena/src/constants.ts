/**
 * Canonical, dependency-free ids for the example "arena" game-mode plugin.
 *
 * This package exists only to PROVE Tileborne's plugin architecture is
 * genre-neutral: a second game mode (a tiny top-down melee arena, distinct from
 * Battle Royale) becomes a discovered, contract-decoding mode with ZERO edits to
 * any engine package. Everything here is plugin-owned content/ids.
 */

/** Plugin id (mirrors the manifest `id`; the neutral game-mode identity). */
export const ARENA_PLUGIN_ID = '@tileborne-plugins/example-arena' as const;

/** Runtime-system contribution id — the manifest signal "this plugin is a mode". */
export const ARENA_RUNTIME_SYSTEM_ID = 'arena-runtime' as const;

/** Authoring settings-panel contribution id (zone `plugins`, capability `settings`). */
export const ARENA_SETTINGS_PANEL_ID = 'arena-settings' as const;

/** `EditorGameSettingsForm` contribution id (same declaration as the panel data). */
export const ARENA_SETTINGS_FORM_ID = 'arena-settings-form' as const;

import { HudLayout, ProjectManifest, type JsonValue } from '@tileborne/core';
import { Option, Schema } from 'effect';

/**
 * Project-level HUD layout overlay (the DESIGNER's arrangement).
 *
 * Three layers produce the effective in-match HUD (each merged via
 * `resolveEffectiveHudLayout`):
 *   1. plugin default  — the mode's `runtime.hudLayouts` manifest contribution;
 *   2. PROJECT layout  — this overlay, authored in the editor and saved in the
 *      project manifest's neutral `settings` bag (ships with the project);
 *   3. player overlay  — the per-user customisation in the renderer prefs
 *      store (`playtest-user-hud.ts`).
 *
 * Persisted as the canonical `@tileborne/core` `HudLayout` Schema encoding
 * under one settings key — the same durable-bytes discipline as the
 * `activeGameMode` selection and the keybind overlay.
 */

export const PROJECT_HUD_LAYOUT_SETTINGS_KEY = 'hudLayout';

/**
 * Read the project's HUD layout overlay, or `undefined` when none is stored
 * or the stored value does not decode against the current `HudLayout` schema
 * (treated as absent rather than throwing — a corrupt value must never block
 * playtest).
 */
export const readProjectHudLayout = (
  project: Pick<ProjectManifest, 'settings'> | undefined,
): HudLayout | undefined => {
  const value = project?.settings?.[PROJECT_HUD_LAYOUT_SETTINGS_KEY];
  if (value === undefined) {
    return undefined;
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(HudLayout)(value));
};

/** Return a new manifest with the HUD layout overlay written to the settings bag. */
export const writeProjectHudLayout = (
  project: ProjectManifest,
  layout: HudLayout,
): ProjectManifest =>
  new ProjectManifest({
    ...project,
    settings: {
      ...(project.settings ?? {}),
      [PROJECT_HUD_LAYOUT_SETTINGS_KEY]: Schema.encodeUnknownSync(HudLayout)(layout) as JsonValue,
    },
  });

/** Return a new manifest with the HUD layout overlay removed (reset to plugin default). */
export const clearProjectHudLayout = (project: ProjectManifest): ProjectManifest => {
  const rest = { ...(project.settings ?? {}) };
  delete rest[PROJECT_HUD_LAYOUT_SETTINGS_KEY];
  return new ProjectManifest({ ...project, settings: rest });
};

import { type GameModeId, gameModeIdFromPluginId, type HudLayout, type PluginId } from "@tileborne/core";
import { Option, Result } from "effect";

import type { PluginContributions } from "./contributions.js";
import {
  decodeGameSettingsForm,
  materializeGameSettingsForm,
  type MaterializedGameSettingsForm,
} from "./game-settings-form.js";
import { decodeHudLayout } from "./hud-layout-registry.js";

/**
 * Manifest-driven game-mode discovery (ADR-0023 section B).
 *
 * The engine owns DISCOVERY as data: a plugin declares it provides a game mode
 * via its manifest contributions (a runtime system plus optional authoring
 * panel/form data), and the engine resolves it into a
 * {@link GameModeDescriptor} that the renderer playtest, inspector, and
 * game-host boot consume. This replaces the hardcoded `switch (pluginId)` /
 * `battleRoyaleEnabled` literal-id paths: a new genre plugin becomes a
 * selectable mode with ZERO engine edits.
 *
 * This module is renderer-safe: it only reads already-decoded
 * {@link PluginContributions} values (no Node, no asset-pipeline runtime). The
 * canonical caller is the main-process `tileborne:plugins:listContributions`
 * handler, which projects descriptors to the renderer over IPC.
 */

/** The capability tag a panel declares to mark itself an authoring settings form. */
const SETTINGS_CAPABILITY = "settings";

/** The contribution zone a mode's per-map authoring settings panel lives in. */
const SETTINGS_PANEL_ZONE = "plugins";

/** A plugin's id paired with its decoded manifest contributions. */
export interface GameModeManifest {
  readonly pluginId: PluginId;
  readonly contributions: PluginContributions;
}

/**
 * A discovered, selectable game mode resolved from a plugin manifest. Carries
 * the neutral mode id, the owning plugin, a human label, and the discovered
 * contribution ids/data (runtime system + authoring settings panel/form) the
 * renderer needs to wire playtest + inspector — all by discovery, never by id
 * literal.
 */
export interface GameModeDescriptor {
  readonly modeId: GameModeId;
  readonly pluginId: PluginId;
  readonly label: string;
  /** The plugin's runtime-system contribution id (the simulation owner). */
  readonly runtimeSystemId: string | undefined;
  /** The authoring settings-panel contribution id, when the plugin declares one. */
  readonly authoringSettingsPanelId: string | undefined;
  /** The game settings-form contribution id, when the plugin declares one. */
  readonly gameSettingsFormId: string | undefined;
  /** The decoded, renderer-ready settings form declared by `editor.gameSettingsForms`. */
  readonly gameSettingsForm: MaterializedGameSettingsForm | undefined;
  /** The HUD-layout contribution id, when the plugin declares one. */
  readonly hudLayoutContributionId: string | undefined;
  /** The decoded default in-match HUD layout declared by `runtime.hudLayouts`. */
  readonly hudLayout: HudLayout | undefined;
  /** Whether the mode declares authoring UI the inspector mounts. */
  readonly hasAuthoringPanel: boolean;
}

const optionalArray = <A>(option: Option.Option<readonly A[]>): readonly A[] =>
  Option.getOrElse(option, () => []);

const discoverGameSettingsForm = (
  contributions: PluginContributions,
): {
  readonly id: string | undefined;
  readonly form: MaterializedGameSettingsForm | undefined;
} => {
  const editor = Option.getOrUndefined(contributions.editor);
  const forms = editor === undefined ? [] : optionalArray(editor.gameSettingsForms);
  const contribution = forms[0];
  if (contribution === undefined) {
    return { id: undefined, form: undefined };
  }
  const decoded = decodeGameSettingsForm(contribution.id, contribution.data);
  return {
    id: contribution.id,
    form: Result.isSuccess(decoded) ? materializeGameSettingsForm(decoded.success) : undefined,
  };
};

const discoverHudLayout = (
  contributions: PluginContributions,
): {
  readonly id: string | undefined;
  readonly layout: HudLayout | undefined;
} => {
  const runtime = Option.getOrUndefined(contributions.runtime);
  const layouts = runtime === undefined ? [] : optionalArray(runtime.hudLayouts);
  const contribution = layouts[0];
  if (contribution === undefined) {
    return { id: undefined, layout: undefined };
  }
  const decoded = decodeHudLayout(contribution.id, contribution.data);
  return {
    id: contribution.id,
    layout: Result.isSuccess(decoded) ? decoded.success : undefined,
  };
};

/**
 * Describe a single plugin as a game mode, or `undefined` when it does not
 * provide one. The manifest signal for "this plugin is a game mode" is a
 * declared runtime system contribution (it owns runtime simulation); authoring
 * UI is discovered from the settings-capable panel in the `plugins` zone and/or
 * the first-class `EditorGameSettingsForm` contribution; the default in-match
 * HUD arrangement is discovered from the `runtime.hudLayouts` slot.
 */
export const describeGameMode = (manifest: GameModeManifest): GameModeDescriptor | undefined => {
  const { pluginId, contributions } = manifest;
  const runtime = Option.getOrUndefined(contributions.runtime);
  const systems = runtime === undefined ? [] : optionalArray(runtime.systems);
  if (systems.length === 0) {
    return undefined;
  }
  const firstSystem = systems[0];
  const panels = optionalArray(contributions.panels);
  const settingsPanel = panels.find(
    (panel) =>
      panel.zone === SETTINGS_PANEL_ZONE &&
      optionalArray(panel.capabilities).includes(SETTINGS_CAPABILITY),
  );
  const gameSettingsForm = discoverGameSettingsForm(contributions);
  const hudLayout = discoverHudLayout(contributions);
  const systemLabel = firstSystem === undefined
    ? undefined
    : Option.getOrUndefined(firstSystem.display)?.label;
  return {
    modeId: gameModeIdFromPluginId(pluginId),
    pluginId,
    label: settingsPanel?.title ?? systemLabel ?? pluginId,
    runtimeSystemId: firstSystem?.id,
    authoringSettingsPanelId: settingsPanel?.id,
    gameSettingsFormId: gameSettingsForm.id,
    gameSettingsForm: gameSettingsForm.form,
    hudLayoutContributionId: hudLayout.id,
    hudLayout: hudLayout.layout,
    hasAuthoringPanel: settingsPanel !== undefined || gameSettingsForm.form !== undefined,
  };
};

/**
 * Discover all selectable game modes from a set of (enabled) plugin manifests.
 * Order follows the input order; the engine offers each as a selectable
 * {@link ActiveGameMode}.
 */
export const discoverGameModes = (
  manifests: readonly GameModeManifest[],
): readonly GameModeDescriptor[] =>
  manifests.flatMap((manifest) => {
    const descriptor = describeGameMode(manifest);
    return descriptor === undefined ? [] : [descriptor];
  });

/**
 * Resolve the active game mode from the discovered set given an optional
 * selection (a {@link GameModeId}, conventionally a plugin id). A single-mode
 * project still works without an explicit selection, but multi-mode projects
 * must choose one explicitly so a demo/runtime cannot be selected by accident.
 */
export const resolveActiveGameMode = (
  modes: readonly GameModeDescriptor[],
  selection?: GameModeId | undefined,
): GameModeDescriptor | undefined => {
  if (selection !== undefined) {
    const selected = modes.find((mode) => mode.modeId === selection);
    if (selected !== undefined) {
      return selected;
    }
    return undefined;
  }
  return modes.length === 1 ? modes[0] : undefined;
};

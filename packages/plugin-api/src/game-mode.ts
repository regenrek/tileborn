import {
  type GameModeId,
  gameModeIdFromPluginId,
  type HudLayout,
  type PluginId,
} from '@tileborne/core';
import { Option, Result } from 'effect';

import type { GameModeCapabilityId, PluginContributions } from './contributions.js';
import {
  decodeGameSettingsForm,
  materializeGameSettingsForm,
  type MaterializedGameSettingsForm,
} from './game-settings-form.js';
import { decodeHudLayout } from './hud-layout-registry.js';

/**
 * Manifest-driven game-mode discovery (ADR-0023 section B).
 *
 * The engine owns DISCOVERY as data: a plugin declares it provides a game mode
 * via its manifest contributions (a runtime system plus optional authoring
 * panel/form data), and the engine resolves it into a
 * {@link GameModeDescriptor} that the renderer playtest, inspector, and
 * game-host boot consume. This replaces the hardcoded per-plugin-id switch and
 * literal-id enabled-flag paths: a new genre plugin becomes a selectable mode
 * with ZERO engine edits.
 *
 * This module is renderer-safe: it only reads already-decoded
 * {@link PluginContributions} values (no Node, no asset-pipeline runtime). The
 * canonical caller is the main-process `tileborne:plugins:listContributions`
 * handler, which projects descriptors to the renderer over IPC.
 */

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
  readonly runtimeSystemId: string;
  /** The authoring settings-panel contribution id, when the plugin declares one. */
  readonly authoringSettingsPanelId: string | undefined;
  /** Bundled authoring implementation selected through the typed host registry. */
  readonly authoringCapabilityId: GameModeCapabilityId | undefined;
  /** Bundled playtest renderer/projector selected through the typed host registry. */
  readonly rendererCapabilityId: GameModeCapabilityId | undefined;
  /** Bundled readiness extension selected through the typed host registry. */
  readonly readinessCapabilityId: GameModeCapabilityId | undefined;
  /** Bundled starter implementation selected through the typed host registry. */
  readonly starterCapabilityId: GameModeCapabilityId | undefined;
  /** The game settings-form contribution id, when the plugin declares one. */
  readonly gameSettingsFormId: string | undefined;
  /** The decoded, renderer-ready settings form declared by `editor.gameSettingsForms`. */
  readonly gameSettingsForm: MaterializedGameSettingsForm | undefined;
  /** The HUD-layout contribution id, when the plugin declares one. */
  readonly hudLayoutContributionId: string | undefined;
  /** The decoded default in-match HUD layout declared by `runtime.hudLayouts`. */
  readonly hudLayout: HudLayout | undefined;
  readonly mapValidatorId: string | undefined;
  readonly starter:
    | {
        readonly templateId: string;
        readonly label: string;
        readonly description: string | undefined;
      }
    | undefined;
  readonly creatorChecklistFacts: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string | undefined;
    readonly sources: readonly ('game-mode' | 'map' | 'catalog' | 'asset' | 'visual-model')[];
  }[];
  /** Whether the mode declares authoring UI the inspector mounts. */
  readonly hasAuthoringPanel: boolean;
}

const optionalArray = <A>(
  value: Option.Option<readonly A[]> | readonly A[] | undefined,
): readonly A[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined) {
    return [];
  }
  return Option.getOrElse(value as Option.Option<readonly A[]>, () => []);
};

const discoverGameSettingsForm = (
  contributions: PluginContributions,
  formId: string | undefined,
): {
  readonly id: string | undefined;
  readonly form: MaterializedGameSettingsForm | undefined;
} => {
  const editor = Option.getOrUndefined(contributions.editor);
  const forms = editor === undefined ? [] : optionalArray(editor.gameSettingsForms);
  const contribution = forms.find(({ id }) => id === formId);
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
  hudLayoutId: string | undefined,
): {
  readonly id: string | undefined;
  readonly layout: HudLayout | undefined;
} => {
  const runtime = Option.getOrUndefined(contributions.runtime);
  const layouts = runtime === undefined ? [] : optionalArray(runtime.hudLayouts);
  const contribution = layouts.find(({ id }) => id === hudLayoutId);
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
 * provide one. A plugin is a mode only when it explicitly declares a
 * `contributes.gameModes` registration. Linked contribution ids are resolved
 * from that declaration; array position and plugin-id conventions are never
 * used as hidden registration signals.
 */
export const describeGameMode = (manifest: GameModeManifest): GameModeDescriptor | undefined => {
  const { pluginId, contributions } = manifest;
  const registrations = optionalArray(contributions.gameModes);
  if (registrations.length > 1) {
    throw new Error(
      `Plugin ${pluginId} declares ${registrations.length} game modes; exactly one gameModes registration is supported per plugin`,
    );
  }
  const registration = registrations[0];
  if (registration === undefined) {
    return undefined;
  }
  const settingsPanelId = registration.settingsPanelId;
  const settingsPanel = optionalArray(contributions.panels).find(
    ({ id }) => id === settingsPanelId,
  );
  const gameSettingsForm = discoverGameSettingsForm(contributions, registration.settingsFormId);
  const hudLayout = discoverHudLayout(contributions, registration.hudLayoutId);
  const capabilities = registration.capabilities;
  const starter = registration.starter;
  const facts = registration.checklistFacts ?? [];
  return {
    modeId: gameModeIdFromPluginId(pluginId),
    pluginId,
    label: registration.display.label,
    runtimeSystemId: registration.runtimeSystemId,
    authoringSettingsPanelId: settingsPanel?.id,
    authoringCapabilityId: capabilities?.authoring,
    rendererCapabilityId: capabilities?.renderer,
    readinessCapabilityId: capabilities?.readiness,
    starterCapabilityId: capabilities?.starter,
    gameSettingsFormId: gameSettingsForm.id,
    gameSettingsForm: gameSettingsForm.form,
    hudLayoutContributionId: hudLayout.id,
    hudLayout: hudLayout.layout,
    mapValidatorId: registration.mapValidatorId,
    starter:
      starter === undefined
        ? undefined
        : {
            templateId: starter.templateId,
            label: starter.label,
            description: starter.description,
          },
    creatorChecklistFacts: facts.map((fact) => ({
      id: fact.id,
      label: fact.label,
      description: fact.description,
      sources: fact.sources,
    })),
    hasAuthoringPanel:
      capabilities?.authoring !== undefined ||
      settingsPanel !== undefined ||
      gameSettingsForm.form !== undefined,
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

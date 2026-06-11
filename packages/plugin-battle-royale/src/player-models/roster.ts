import {
  PlayerModelRef,
  ProjectManifest,
  REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  validatePlayerModelRef,
  type JsonObject,
  type JsonValue,
  type TileborneMap,
  type PlayerModelValidationIssue,
} from "@tileborne/core";
import { Schema } from "effect";

import {
  DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS,
  DEPRECATED_BATTLE_ROYALE_PLAYER_MODEL_IDS,
  isDeprecatedBattleRoyalePlayerModelId,
} from "../content-assets.js";
import { PLUGIN_ID } from "../constants.js";

/**
 * Battle Royale's per-project player-model roster: a single set of selectable
 * avatars shared across all of the project's BR maps (locked product decision —
 * NOT per-map). Persisted on `project.settings.battleRoyale.playerModels` and
 * surfaced through the generic player-model POLICY mechanism (BR declares
 * `mode: 'selectable'`; the editor + lobby + projector consume the resolved
 * models without renderer-side BR special-casing).
 *
 * This is the canonical owner of the durable BR player-model schema; the editor
 * holds only the generic resolver + the composition registry that reference the
 * exported {@link BATTLE_ROYALE_PLAYER_MODEL_POLICY}.
 */
const PlayerModelArray = Schema.Array(PlayerModelRef);

const readObject = (value: JsonValue | undefined): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

export interface BattleRoyalePlayerModelRosterIssue extends PlayerModelValidationIssue {
  readonly modelId: string | undefined;
}

export const validateBattleRoyalePlayerModelRoster = (
  models: readonly PlayerModelRef[],
): readonly BattleRoyalePlayerModelRosterIssue[] =>
  models.flatMap((model, index) =>
    validatePlayerModelRef(model).map((issue) => ({
      ...issue,
      path: `playerModels[${index}].${issue.path}`,
      modelId: model.id,
    })),
  );

const assertValidBattleRoyalePlayerModelRoster = (
  models: readonly PlayerModelRef[],
): void => {
  const issues = validateBattleRoyalePlayerModelRoster(models);
  if (issues.length > 0) {
    throw new Error(
      `Invalid Battle Royale player-model roster: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
};

/** Decode the project's BR player-model roster (empty when unset/invalid). */
export const readBattleRoyalePlayerModels = (
  project: ProjectManifest | undefined,
): readonly PlayerModelRef[] => {
  if (project?.settings === undefined) {
    return [];
  }
  const battleRoyale = readObject(project.settings.battleRoyale);
  const raw = battleRoyale.playerModels;
  if (!Array.isArray(raw)) {
    return [];
  }
  try {
    const models = Schema.decodeUnknownSync(PlayerModelArray)(raw);
    return validateBattleRoyalePlayerModelRoster(models).length === 0 ? models : [];
  } catch {
    return [];
  }
};

/** Read authored project models that are still part of the production roster contract. */
export const readBattleRoyalePlayerModelOverrides = (
  project: ProjectManifest | undefined,
): readonly PlayerModelRef[] =>
  readBattleRoyalePlayerModels(project).filter(
    (model) => !isDeprecatedBattleRoyalePlayerModelId(model.id),
  );

export const hasBattleRoyalePlayerModelOverrides = (
  project: ProjectManifest | undefined,
): boolean => readBattleRoyalePlayerModelOverrides(project).length > 0;

/** Resolve the effective BR roster: authored project roster, else bundled defaults. */
export const resolveBattleRoyalePlayerModels = (
  project: ProjectManifest | undefined,
): readonly PlayerModelRef[] => {
  const projectModels = readBattleRoyalePlayerModelOverrides(project);
  return projectModels.length === 0 ? DEFAULT_BATTLE_ROYALE_PLAYER_MODEL_REFS : projectModels;
};

/** Persist a new BR player-model roster onto the project manifest settings. */
export const applyBattleRoyalePlayerModels = (
  project: ProjectManifest,
  models: readonly PlayerModelRef[],
): ProjectManifest => {
  assertValidBattleRoyalePlayerModelRoster(models);
  // Encode through the schema then JSON-roundtrip so optional/undefined fields
  // collapse to a clean JsonValue the project manifest can persist.
  const encoded = JSON.parse(
    JSON.stringify(Schema.encodeUnknownSync(PlayerModelArray)(models)),
  ) as JsonValue;
  const previousSettings = readObject(project.settings as JsonValue | undefined);
  const previousBattleRoyale = readObject(previousSettings.battleRoyale);
  return new ProjectManifest({
    ...project,
    settings: {
      ...previousSettings,
      battleRoyale: {
        ...previousBattleRoyale,
        playerModels: encoded,
      },
    },
  });
};

/** Add (or replace by id) a model in the project's BR roster. */
export const upsertBattleRoyalePlayerModel = (
  project: ProjectManifest,
  model: PlayerModelRef,
): ProjectManifest => {
  const current = readBattleRoyalePlayerModelOverrides(project);
  const next = current.some((entry) => entry.id === model.id)
    ? current.map((entry) => (entry.id === model.id ? model : entry))
    : [...current, model];
  return applyBattleRoyalePlayerModels(project, next);
};

/** Remove a model from the project's BR roster by id. */
export const removeBattleRoyalePlayerModel = (
  project: ProjectManifest,
  modelId: string,
): ProjectManifest =>
  applyBattleRoyalePlayerModels(
    project,
    readBattleRoyalePlayerModelOverrides(project).filter((entry) => entry.id !== modelId),
  );

/**
 * Resolution context handed to the generic player-model policy mechanism. This
 * mirrors the editor's `PlayerModelPolicyContext` structurally so the exported
 * contribution stays assignable to it without the plugin depending on the
 * editor (the editor owns the generic mechanism + registry).
 */
interface PlayerModelPolicyContext {
  readonly map: TileborneMap;
  readonly project?: ProjectManifest | undefined;
}

/**
 * Battle Royale's player-model POLICY contribution: a selectable roster sourced
 * from the per-project settings. The editor's `plugin-player-model-policies`
 * registry references this exported contribution.
 */
export const BATTLE_ROYALE_PLAYER_MODEL_POLICY = {
  pluginId: PLUGIN_ID,
  mode: "selectable" as const,
  requiredClipKeys: REQUIRED_PLAYER_MODEL_CLIP_KEYS,
  defaultGeometry: {
    anchor: { x: 0.5, y: 0.86 },
    hand: { x: 0.64, y: 0.56 },
    hitbox: { x: 0.28, y: 0.18, width: 0.44, height: 0.66 },
    renderScale: 1,
    worldSize: { width: 24, height: 32 },
  },
  placeholderModelIds: DEPRECATED_BATTLE_ROYALE_PLAYER_MODEL_IDS,
  resolveModels: (context: PlayerModelPolicyContext): readonly PlayerModelRef[] =>
    resolveBattleRoyalePlayerModels(context.project),
  applyModels: applyBattleRoyalePlayerModels,
};

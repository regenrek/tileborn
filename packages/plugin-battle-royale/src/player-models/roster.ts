import {
  PlayerModelRef,
  ProjectManifest,
  type JsonObject,
  type JsonValue,
  type TileborneMap,
} from "@tileborne/core";
import { Schema } from "effect";

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
    return Schema.decodeUnknownSync(PlayerModelArray)(raw);
  } catch {
    return [];
  }
};

/** Persist a new BR player-model roster onto the project manifest settings. */
export const applyBattleRoyalePlayerModels = (
  project: ProjectManifest,
  models: readonly PlayerModelRef[],
): ProjectManifest => {
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
  const current = readBattleRoyalePlayerModels(project);
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
    readBattleRoyalePlayerModels(project).filter((entry) => entry.id !== modelId),
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
  resolveModels: (context: PlayerModelPolicyContext): readonly PlayerModelRef[] =>
    readBattleRoyalePlayerModels(context.project),
};

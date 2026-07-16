import { JsonObject } from '@tileborne/core';
import { Option, Result, Schema } from 'effect';

/**
 * Consumption of the manifest-discovered `EditorGameSettingsForm` contribution
 * (ADR-0023 section A).
 *
 * Promotes the previously TS-only `AuthoringSettingsForm` mechanism to a
 * schema'd, manifest-discovered DECLARATION: a game-mode plugin declares its
 * settings FIELD set + per-field UI hints + validation policy as data, and the
 * generic editor renders + validates the form from that declaration (never from
 * a TS import naming a plugin-specific field). Mirrors {@link decodeInputMap} /
 * the ADR-0019 catalog registry: the engine owns the SHAPE, the plugin supplies
 * the field DATA. Settings VALUES persist under the neutral per-plugin namespace
 * (`map.properties.<pluginId>` / `project.settings.<pluginId>`, owned by
 * `@tileborne/core`'s `plugin-settings` helper).
 */

/** Where a settings form's values persist: per-map or per-project. */
export const GameSettingsScope = Schema.Literals(['map', 'project']);
export type GameSettingsScope = typeof GameSettingsScope.Type;

/**
 * Value kind a field edits. Numeric is the only kind today (BR's field set);
 * the union grows as new kinds are needed (kept narrow per ADR-0023 risk 1).
 */
export const GameSettingsFieldKind = Schema.Literals(['number']);
export type GameSettingsFieldKind = typeof GameSettingsFieldKind.Type;

/**
 * One settings field the editor renders generically (mirrors ct-js
 * `IExtensionField` / LDtk field-defs): the value key, a label, optional
 * numeric bounds + step (UI hints + validation), and a default. Conditional
 * visibility / nested groups are deferred until a genre needs them.
 */
export class GameSettingsFieldDescriptor extends Schema.Class<GameSettingsFieldDescriptor>(
  'GameSettingsFieldDescriptor',
)({
  key: Schema.String,
  label: Schema.String,
  kind: Schema.optional(GameSettingsFieldKind),
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  step: Schema.optional(Schema.Number),
  default: Schema.Number,
}) {}

/**
 * A plugin's full settings-form declaration: the durable, manifest-discovered
 * data behind the `EditorGameSettingsForm` contribution. The engine decodes it
 * and renders + validates the form generically.
 */
export class GameSettingsFormDeclaration extends Schema.Class<GameSettingsFormDeclaration>(
  'GameSettingsFormDeclaration',
)({
  scope: GameSettingsScope,
  fields: Schema.Array(GameSettingsFieldDescriptor),
  invalidMessage: Schema.optional(Schema.String),
}) {}

/** A contributed settings form failed to decode against the engine schema. */
export class InvalidGameSettingsFormError extends Schema.TaggedErrorClass<InvalidGameSettingsFormError>()(
  'InvalidGameSettingsFormError',
  {
    contributionId: Schema.String,
    message: Schema.String,
  },
) {}

/** Decode raw contribution `data` into a typed {@link GameSettingsFormDeclaration}. */
export const decodeGameSettingsForm = (
  contributionId: string,
  data: unknown,
): Result.Result<GameSettingsFormDeclaration, InvalidGameSettingsFormError> => {
  const decoded = Schema.decodeUnknownOption(GameSettingsFormDeclaration)(data);
  return Option.match(decoded, {
    onNone: () =>
      Result.fail(
        new InvalidGameSettingsFormError({
          contributionId,
          message: `contribution ${contributionId} is not a valid game settings form`,
        }),
      ),
    onSome: (form) => Result.succeed(form),
  });
};

const DEFAULT_INVALID_MESSAGE = 'Settings must be valid numbers within range.';

/** A field flattened from {@link GameSettingsFieldDescriptor} for generic rendering. */
export interface MaterializedGameSettingsField {
  readonly key: string;
  readonly label: string;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly step: number | undefined;
  readonly default: number;
}

/**
 * A settings form flattened from its decoded declaration into plain values the
 * renderer consumes without touching `Option`. Carries the value-policy
 * helpers' inputs (fields + invalid message) — the generic editor pairs it with
 * {@link gameSettingsToDraft} / {@link parseGameSettingsDraft}.
 */
export interface MaterializedGameSettingsForm {
  readonly scope: GameSettingsScope;
  readonly fields: readonly MaterializedGameSettingsField[];
  readonly invalidMessage: string;
}

/** Flatten a decoded declaration into the renderer-facing materialized form. */
export const materializeGameSettingsForm = (
  declaration: GameSettingsFormDeclaration,
): MaterializedGameSettingsForm => ({
  scope: declaration.scope,
  invalidMessage: declaration.invalidMessage ?? DEFAULT_INVALID_MESSAGE,
  fields: declaration.fields.map((field) => ({
    key: field.key,
    label: field.label,
    min: field.min,
    max: field.max,
    step: field.step,
    default: field.default,
  })),
});

/** The default value for every field, as a typed values record. */
export const gameSettingsDefaults = (form: MaterializedGameSettingsForm): Record<string, number> =>
  Object.fromEntries(form.fields.map((field) => [field.key, field.default]));

/**
 * Build a string draft (per field, keyed by field key) from stored values,
 * falling back to each field's default when the stored value is missing or not
 * a finite number. The neutral counterpart to BR's old `toDraft`.
 */
export const gameSettingsToDraft = (
  form: MaterializedGameSettingsForm,
  values: JsonObject,
): Record<string, string> =>
  Object.fromEntries(
    form.fields.map((field) => {
      const raw = values[field.key];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : field.default;
      return [field.key, String(value)];
    }),
  );

/**
 * Parse + validate a string draft into typed values, or `undefined` when any
 * field is non-finite or out of its declared `[min, max]` bounds (the editor
 * then blocks the save). The neutral counterpart to BR's old `parseDraft`.
 */
export const parseGameSettingsDraft = (
  form: MaterializedGameSettingsForm,
  draft: Record<string, string>,
): Record<string, number> | undefined => {
  const parsed: Record<string, number> = {};
  for (const field of form.fields) {
    const value = Number(draft[field.key]);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    if (field.min !== undefined && value < field.min) {
      return undefined;
    }
    if (field.max !== undefined && value > field.max) {
      return undefined;
    }
    parsed[field.key] = value;
  }
  return parsed;
};

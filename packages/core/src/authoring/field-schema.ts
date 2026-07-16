import { Schema } from "effect";

import type { JsonObject, JsonValue } from "../project/index.js";

/** Discoverable registries a reference field may target. Kept genre-neutral. */
export const AuthoringReferenceTarget = Schema.Literals([
  "asset",
  "entity",
  "weapon",
  "item",
  "loot-table",
]);
export type AuthoringReferenceTarget = typeof AuthoringReferenceTarget.Type;

export class AuthoringEnumOption extends Schema.Class<AuthoringEnumOption>(
  "AuthoringEnumOption",
)({
  value: Schema.String,
  label: Schema.String,
}) {}

interface AuthoringFieldBase {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
}

export interface NumberAuthoringField extends AuthoringFieldBase {
  readonly kind: "number";
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly integer?: boolean;
}

export interface TextAuthoringField extends AuthoringFieldBase {
  readonly kind: "text";
  readonly default: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly multiline?: boolean;
}

export interface BooleanAuthoringField extends AuthoringFieldBase {
  readonly kind: "boolean";
  readonly default: boolean;
}

export interface EnumAuthoringField extends AuthoringFieldBase {
  readonly kind: "enum";
  readonly default: string;
  readonly options: readonly AuthoringEnumOption[];
}

export interface ReferenceAuthoringField extends AuthoringFieldBase {
  readonly kind: "reference";
  readonly target: AuthoringReferenceTarget;
  readonly default?: string;
  readonly allowNone?: boolean;
}

export interface OptionalAuthoringField extends AuthoringFieldBase {
  readonly kind: "optional";
  readonly field: AuthoringFieldSchema;
}

export interface GroupAuthoringField extends AuthoringFieldBase {
  readonly kind: "group";
  readonly fields: readonly AuthoringFieldSchema[];
}

/**
 * Durable, recursive authoring schema shared by plugin declarations, project
 * definitions, IPC and renderer controls. It owns validation constraints and
 * reference targets; React components only render it.
 */
export type AuthoringFieldSchema =
  | NumberAuthoringField
  | TextAuthoringField
  | BooleanAuthoringField
  | EnumAuthoringField
  | ReferenceAuthoringField
  | OptionalAuthoringField
  | GroupAuthoringField;

const base = {
  key: Schema.String,
  label: Schema.String,
  help: Schema.optional(Schema.String),
};

const NumberField = Schema.Struct({
  ...base,
  kind: Schema.Literal("number"),
  default: Schema.Number,
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  step: Schema.optional(Schema.Number),
  integer: Schema.optional(Schema.Boolean),
});

const TextField = Schema.Struct({
  ...base,
  kind: Schema.Literal("text"),
  default: Schema.String,
  minLength: Schema.optional(Schema.Int),
  maxLength: Schema.optional(Schema.Int),
  pattern: Schema.optional(Schema.String),
  multiline: Schema.optional(Schema.Boolean),
});

const BooleanField = Schema.Struct({
  ...base,
  kind: Schema.Literal("boolean"),
  default: Schema.Boolean,
});

const EnumField = Schema.Struct({
  ...base,
  kind: Schema.Literal("enum"),
  default: Schema.String,
  options: Schema.Array(AuthoringEnumOption),
});

const ReferenceField = Schema.Struct({
  ...base,
  kind: Schema.Literal("reference"),
  target: AuthoringReferenceTarget,
  default: Schema.optional(Schema.String),
  allowNone: Schema.optional(Schema.Boolean),
});

export const AuthoringFieldSchema: Schema.Codec<AuthoringFieldSchema> = Schema.suspend(
  (): Schema.Codec<AuthoringFieldSchema> =>
    Schema.Union([
      NumberField,
      TextField,
      BooleanField,
      EnumField,
      ReferenceField,
      Schema.Struct({
        ...base,
        kind: Schema.Literal("optional"),
        field: AuthoringFieldSchema,
      }),
      Schema.Struct({
        ...base,
        kind: Schema.Literal("group"),
        fields: Schema.Array(AuthoringFieldSchema),
      }),
    ]) as Schema.Codec<AuthoringFieldSchema>,
);

export interface AuthoringReferenceIndex {
  readonly asset?: ReadonlySet<string>;
  readonly entity?: ReadonlySet<string>;
  readonly weapon?: ReadonlySet<string>;
  readonly item?: ReadonlySet<string>;
  readonly "loot-table"?: ReadonlySet<string>;
}

export interface AuthoringValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface AuthoringValidationResult {
  readonly ok: boolean;
  readonly issues: readonly AuthoringValidationIssue[];
}

const valueAt = (values: JsonObject, key: string): JsonValue | undefined => values[key];

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateField = (
  field: AuthoringFieldSchema,
  value: JsonValue | undefined,
  path: string,
  references: AuthoringReferenceIndex,
  issues: AuthoringValidationIssue[],
): void => {
  if (field.kind === "optional") {
    if (value === undefined || value === null) return;
    validateField(field.field, value, path, references, issues);
    return;
  }
  if (field.kind === "group") {
    if (!isJsonObject(value)) {
      issues.push({ path, message: `${field.label} must be a group` });
      return;
    }
    for (const child of field.fields) {
      validateField(child, valueAt(value, child.key), `${path}.${child.key}`, references, issues);
    }
    return;
  }
  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ path, message: `${field.label} must be a finite number` });
      return;
    }
    if (field.integer === true && !Number.isInteger(value)) {
      issues.push({ path, message: `${field.label} must be an integer` });
    }
    if (field.min !== undefined && value < field.min) {
      issues.push({ path, message: `${field.label} must be at least ${field.min}` });
    }
    if (field.max !== undefined && value > field.max) {
      issues.push({ path, message: `${field.label} must be at most ${field.max}` });
    }
    return;
  }
  if (field.kind === "text") {
    if (typeof value !== "string") {
      issues.push({ path, message: `${field.label} must be text` });
      return;
    }
    if (field.minLength !== undefined && value.length < field.minLength) {
      issues.push({ path, message: `${field.label} is too short` });
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      issues.push({ path, message: `${field.label} is too long` });
    }
    if (field.pattern !== undefined) {
      try {
        if (!new RegExp(field.pattern).test(value)) {
          issues.push({ path, message: `${field.label} has an invalid format` });
        }
      } catch {
        issues.push({ path, message: `${field.label} has an invalid schema pattern` });
      }
    }
    return;
  }
  if (field.kind === "boolean") {
    if (typeof value !== "boolean") {
      issues.push({ path, message: `${field.label} must be true or false` });
    }
    return;
  }
  if (field.kind === "enum") {
    if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
      issues.push({ path, message: `${field.label} must use a declared option` });
    }
    return;
  }
  if (value === undefined || value === null || value === "") {
    if (field.allowNone !== true) {
      issues.push({ path, message: `${field.label} requires a selection` });
    }
    return;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: `${field.label} must be a reference` });
    return;
  }
  const index = references[field.target];
  if (index !== undefined && !index.has(value)) {
    issues.push({ path, message: `${field.label} references missing ${field.target} ${value}` });
  }
};

/** Validate one values object against the canonical recursive field schema. */
export const validateAuthoringValues = (
  fields: readonly AuthoringFieldSchema[],
  values: JsonObject,
  references: AuthoringReferenceIndex = {},
): AuthoringValidationResult => {
  const issues: AuthoringValidationIssue[] = [];
  for (const field of fields) {
    validateField(field, valueAt(values, field.key), field.key, references, issues);
  }
  return { ok: issues.length === 0, issues };
};

const fieldDefault = (field: AuthoringFieldSchema): JsonValue => {
  if (field.kind === "optional") return null;
  if (field.kind === "group") {
    return Object.fromEntries(field.fields.map((child) => [child.key, fieldDefault(child)]));
  }
  if (field.kind === "reference") return field.default ?? null;
  return field.default;
};

/** Deterministic defaults for creating a project-owned definition or instance. */
export const authoringDefaults = (fields: readonly AuthoringFieldSchema[]): JsonObject =>
  Object.fromEntries(fields.map((field) => [field.key, fieldDefault(field)]));

import { PluginId } from "@tileborne/core";
import { Schema } from "effect";

import { ContributionId, PluginRef, SemverRangeString } from "./primitives.js";

export class InvalidPluginManifestError extends Schema.TaggedErrorClass<InvalidPluginManifestError>()(
  "InvalidPluginManifestError",
  {
    pluginId: Schema.OptionFromUndefinedOr(PluginId),
    message: Schema.String,
  },
) {}

export class MissingPermissionError extends Schema.TaggedErrorClass<MissingPermissionError>()(
  "MissingPermissionError",
  {
    pluginId: PluginId,
    permission: Schema.String,
    message: Schema.String,
  },
) {}

export class UnresolvedPluginDependencyError extends Schema.TaggedErrorClass<UnresolvedPluginDependencyError>()(
  "UnresolvedPluginDependencyError",
  {
    pluginId: PluginId,
    dependency: PluginRef,
    message: Schema.String,
  },
) {}

export class IncompatibleEngineVersionError extends Schema.TaggedErrorClass<IncompatibleEngineVersionError>()(
  "IncompatibleEngineVersionError",
  {
    pluginId: PluginId,
    required: SemverRangeString,
    actual: Schema.String,
    message: Schema.String,
  },
) {}

export class DuplicateContributionError extends Schema.TaggedErrorClass<DuplicateContributionError>()(
  "DuplicateContributionError",
  {
    pluginId: PluginId,
    contributionId: ContributionId,
    message: Schema.String,
  },
) {}

export class MigrationConflictError extends Schema.TaggedErrorClass<MigrationConflictError>()(
  "MigrationConflictError",
  {
    pluginId: PluginId,
    entity: Schema.String,
    fromVersion: Schema.Int,
    toVersion: Schema.Int,
    message: Schema.String,
  },
) {}

export const PluginApiError = Schema.Union([
  InvalidPluginManifestError,
  MissingPermissionError,
  UnresolvedPluginDependencyError,
  IncompatibleEngineVersionError,
  DuplicateContributionError,
  MigrationConflictError,
]);

export type PluginApiError = typeof PluginApiError.Type;


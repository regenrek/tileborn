import { Schema } from "effect";

import {
  ConfigParseError,
  ConfigReadError,
  ConfigWriteError,
  HomeInitializationError,
  HomeSecurityError,
} from "@tileborne/services-foundation";
import {
  AssetImportError,
  AssetIntegrityError,
  AssetPackNotFoundError,
  MapNotFoundError,
  MapSaveError,
  MapValidationError,
  ProjectAlreadyExistsError,
  ProjectMigrationError,
  ProjectNotFoundError,
  ProjectPathNotFoundError,
  ProjectSaveError,
  ProjectSlugInvalidError,
  ProjectValidationError,
} from "@tileborne/services-app";
import {
  PluginInstallError,
  PluginIntegrityError,
  PluginNotFoundError,
  PluginResolveError,
  PluginValidationError,
} from "@tileborne/services-plugin";
import { ServicesBuildError } from "@tileborne/services-build";

import { ExitCode, type ExitCodeValue } from "./exit-codes.js";

export class CliUsageError extends Schema.TaggedErrorClass<CliUsageError>()("CliUsageError", {
  message: Schema.String,
}) {}

export class CliValidationError extends Schema.TaggedErrorClass<CliValidationError>()("CliValidationError", {
  message: Schema.String,
}) {}

export type CliError =
  | CliUsageError
  | CliValidationError
  | ConfigReadError
  | ConfigWriteError
  | ConfigParseError
  | HomeInitializationError
  | HomeSecurityError
  | ProjectSlugInvalidError
  | ProjectAlreadyExistsError
  | ProjectNotFoundError
  | ProjectPathNotFoundError
  | ProjectValidationError
  | ProjectSaveError
  | ProjectMigrationError
  | PluginNotFoundError
  | PluginResolveError
  | PluginValidationError
  | PluginInstallError
  | PluginIntegrityError
  | AssetImportError
  | AssetIntegrityError
  | AssetPackNotFoundError
  | MapNotFoundError
  | MapValidationError
  | MapSaveError
  | ServicesBuildError;

const taggedName = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error
    ? String((error as { _tag: unknown })._tag)
    : undefined;

const isMissingInputAssetImport = (error: unknown): boolean => {
  if (taggedName(error) !== "AssetImportError") {
    return false;
  }
  const message = errorMessage(error).toLowerCase();
  return message.includes("enoent") || message.includes("no such file");
};

export const mapErrorToExitCode = (error: unknown): ExitCodeValue => {
  if (isMissingInputAssetImport(error)) {
    return ExitCode.NoInput;
  }
  const tag = taggedName(error);
  switch (tag) {
    case "CliUsageError":
    case "CliValidationError":
    case "ProjectSlugInvalidError":
    case "ProjectValidationError":
      return ExitCode.Usage;
    case "ProjectNotFoundError":
    case "ProjectPathNotFoundError":
    case "PluginNotFoundError":
    case "AssetPackNotFoundError":
    case "MapNotFoundError":
    case "ConfigReadError":
      return ExitCode.NoInput;
    case "MapValidationError":
    case "ServicesBuildError":
      return ExitCode.DataErr;
    case "ProjectAlreadyExistsError":
      return ExitCode.DataErr;
    case "PluginIntegrityError":
    case "AssetIntegrityError":
    case "PluginValidationError":
      return ExitCode.DataErr;
    case "PluginResolveError":
      return ExitCode.TempFail;
    case "ConfigParseError":
    case "ConfigWriteError":
    case "HomeInitializationError":
    case "HomeSecurityError":
      return ExitCode.Config;
    case "ProjectSaveError":
    case "ProjectMigrationError":
    case "PluginInstallError":
    case "AssetImportError":
    case "MapSaveError":
      return ExitCode.IoErr;
    default:
      return ExitCode.Generic;
  }
};

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

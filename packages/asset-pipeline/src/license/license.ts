import { Result, Schema } from "effect";

import { LicenseNotAllowlistedError } from "../errors.js";

export const SPDX_ALLOWLIST = [
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "MIT",
  "Apache-2.0",
  "OFL-1.1",
  "Zlib",
  "Unlicense",
] as const;

export const SpdxId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9-.+]+(?:\s+(?:AND|OR)\s+[A-Za-z0-9-.+]+)*$/),
);
export type SpdxId = typeof SpdxId.Type;

export class License extends Schema.Class<License>("License")({
  spdxId: SpdxId,
  attribution: Schema.OptionFromOptional(Schema.String),
  sourceUrl: Schema.OptionFromOptional(Schema.String),
  notes: Schema.OptionFromOptional(Schema.String),
  redistributable: Schema.optional(Schema.Boolean),
}) {}

export const isSpdxAllowlisted = (spdxId: string): boolean =>
  (SPDX_ALLOWLIST as readonly string[]).includes(spdxId);

export const validateLicenseAllowlist = (
  license: License,
): Result.Result<License, LicenseNotAllowlistedError> => {
  if (isSpdxAllowlisted(license.spdxId)) {
    return Result.succeed(license);
  }
  return Result.fail(
    new LicenseNotAllowlistedError({
      spdxId: license.spdxId,
      message: `License ${license.spdxId} requires explicit user approval`,
    }),
  );
};

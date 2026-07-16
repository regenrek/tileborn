import { Schema } from 'effect';

/** Scoped npm-style plugin dependency reference. */
export const PluginRef = Schema.String.check(
  Schema.isPattern(/^@[a-z0-9-][a-z0-9-._~]*\/[a-z0-9-][a-z0-9-._~]*$/i),
).pipe(Schema.brand('PluginRef'));

export type PluginRef = typeof PluginRef.Type;

/** Strict package version string. Range compatibility is represented separately. */
export const SemverString = Schema.String.check(
  Schema.isPattern(/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
);

export type SemverString = typeof SemverString.Type;

/** Minimal semver range shape for manifest validation without bundling a semver parser. */
export const SemverRangeString = Schema.String.check(
  Schema.isPattern(
    /^(\*|(?:[\^~]?|>=|<=|>|<|=)\s*v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s+(?:>=|<=|>|<|=)\s*v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)*$/,
  ),
);

export type SemverRangeString = typeof SemverRangeString.Type;

export class EntryPoints extends Schema.Class<EntryPoints>('EntryPoints')({
  editor: Schema.OptionFromUndefinedOr(Schema.String),
  runtime: Schema.OptionFromUndefinedOr(Schema.String),
  server: Schema.OptionFromUndefinedOr(Schema.String),
}) {}

export const ContributionId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9.-]*$/i));
export type ContributionId = typeof ContributionId.Type;

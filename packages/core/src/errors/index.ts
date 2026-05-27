import { Schema } from "effect";

/** Raised when a domain id or hash fails validation. */
export class InvalidDomainIdError extends Schema.TaggedErrorClass<InvalidDomainIdError>()(
  "InvalidDomainIdError",
  {
    input: Schema.Unknown,
    message: Schema.String,
  },
) {}

/** Raised when canonical JSON serialization rejects input. */
export class CanonicalJsonError extends Schema.TaggedErrorClass<CanonicalJsonError>()(
  "CanonicalJsonError",
  {
    message: Schema.String,
  },
) {}

/** Raised when schema migration cannot proceed. */
export class SchemaMigrationError extends Schema.TaggedErrorClass<SchemaMigrationError>()(
  "SchemaMigrationError",
  {
    entity: Schema.String,
    fromVersion: Schema.Number,
    toVersion: Schema.Number,
    message: Schema.String,
  },
) {}

/** Raised when decoding a persisted entity fails validation. */
export class SchemaDecodeError extends Schema.TaggedErrorClass<SchemaDecodeError>()(
  "SchemaDecodeError",
  {
    entity: Schema.String,
    message: Schema.String,
  },
) {}

import { Schema } from "effect";

/** Traceability metadata captured when a manifest is imported or authored. */
export class ManifestProvenance extends Schema.Class<ManifestProvenance>("ManifestProvenance")({
  sourcePath: Schema.String,
  originTool: Schema.String,
  importedAt: Schema.String,
}) {}

export type ManifestProvenanceInput = typeof ManifestProvenance.Type;

/** Create provenance metadata for a newly imported manifest. */
export const createManifestProvenance = (input: {
  readonly sourcePath: string;
  readonly originTool: string;
  readonly importedAt?: string;
}): ManifestProvenance =>
  new ManifestProvenance({
    sourcePath: input.sourcePath,
    originTool: input.originTool,
    importedAt: input.importedAt ?? new Date().toISOString(),
  });

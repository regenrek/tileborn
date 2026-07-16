import { AssetPackManifestAsset } from '@tileborne/asset-pipeline';
import {
  BehaviorManifest,
  BehaviorReference,
  ProjectManifestSchema,
  decodePersistedTileborneMapJson,
} from '@tileborne/core';
import { Schema } from 'effect';

export interface ProjectCorpusValidationInput {
  readonly project: unknown;
  readonly maps: readonly unknown[];
  readonly assets: readonly unknown[];
  readonly behaviors: readonly unknown[];
  readonly references: readonly unknown[];
  readonly invalidMapVariants: readonly unknown[];
}

export interface ProjectCorpusValidationReport {
  readonly validProjectPasses: number;
  readonly invalidVariantFaults: number;
  readonly diagnostics: readonly string[];
  readonly recordsInspected: number;
}

/**
 * Canonical schema/project validation pass used by release qualification and import tooling.
 * Counts advance only after the named production schema has inspected the corresponding record.
 */
export const validateProjectContentCorpus = (
  input: ProjectCorpusValidationInput,
): ProjectCorpusValidationReport => {
  let recordsInspected = 0;
  let validProjectPasses = 0;
  Schema.decodeUnknownSync(ProjectManifestSchema)(input.project);
  recordsInspected += 1;

  for (const candidate of input.maps) {
    const map = decodePersistedTileborneMapJson(candidate);
    recordsInspected += 1;
    map.objects.forEach(() => {
      recordsInspected += 1;
    });
  }
  for (const asset of input.assets) {
    Schema.decodeUnknownSync(AssetPackManifestAsset)(asset);
    recordsInspected += 1;
  }
  for (const behavior of input.behaviors) {
    Schema.decodeUnknownSync(BehaviorManifest)(behavior);
    recordsInspected += 1;
  }
  for (const reference of input.references) {
    Schema.decodeUnknownSync(BehaviorReference)(reference);
    recordsInspected += 1;
  }
  validProjectPasses += 1;

  const diagnostics: string[] = [];
  for (const candidate of input.invalidMapVariants) {
    try {
      decodePersistedTileborneMapJson(candidate);
    } catch (cause) {
      diagnostics.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return {
    validProjectPasses,
    invalidVariantFaults: diagnostics.length,
    diagnostics,
    recordsInspected,
  };
};

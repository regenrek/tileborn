import type { ProjectId } from '@tileborne/core';
import type {
  TiledImportLicense,
  TiledImportPlan,
  TiledImportScan,
  TiledImportProfile,
} from '@tileborne/ipc-contracts';
import { AssetImportSourceDetection } from '@tileborne/ipc-contracts';
import type { Schema } from 'effect';

export type TiledImportLicenseDraft = TiledImportLicense;
export type TiledImportSuggestion = TiledImportPlan['suggestions'][number];
export type ImportSourceDetection = Schema.Schema.Type<typeof AssetImportSourceDetection>;
export type TiledImportScanView = TiledImportScan;
export type TiledImportPlanView = TiledImportPlan;

export interface TiledImportWizardState {
  readonly projectId: ProjectId;
  readonly sourcePath: string;
  readonly profile: TiledImportProfile;
  readonly acceptedSuggestionIds: readonly string[];
  readonly license: TiledImportLicenseDraft;
  readonly scan?: TiledImportScanView | undefined;
  readonly plan?: TiledImportPlanView | undefined;
}

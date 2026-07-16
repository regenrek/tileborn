import type { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';

export const APP_CLOSE_REQUESTED_CHANNEL = 'tileborne:app-close:requested';
export const APP_CLOSE_RESOLVED_CHANNEL = 'tileborne:app-close:resolved';
export const APP_RECOVERY_STORAGE_LOAD_CHANNEL = 'tileborne:app-recovery-storage:load';
export const APP_RECOVERY_STORAGE_COMMIT_CHANNEL = 'tileborne:app-recovery-storage:commit';

export interface AppRecoveryStorageRecord {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.documentRecovery;
  readonly documentId: string;
  readonly kind: string;
  readonly label: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly snapshot: unknown;
}

export interface AppRecoveryStorageDiagnostic {
  readonly code: 'recovery-registry-repaired';
  readonly severity: 'warning';
  readonly message: string;
  readonly quarantinedFile: string;
}

export type AppRecoveryStorageMutation =
  | { readonly _tag: 'upsert'; readonly record: AppRecoveryStorageRecord }
  | { readonly _tag: 'delete'; readonly documentId: string };

export interface AppRecoveryStorageCommit {
  readonly mutations: readonly AppRecoveryStorageMutation[];
}

export interface AppRecoveryStorageSnapshot {
  readonly records: readonly AppRecoveryStorageRecord[];
  readonly diagnostic?: AppRecoveryStorageDiagnostic;
}

export interface AppCloseRequest {
  readonly requestId: string;
}

export interface AppCloseResolution {
  readonly requestId: string;
  readonly allow: boolean;
}

export interface TileborneAppLifecycleBridge {
  readonly onCloseRequested: (handler: (request: AppCloseRequest) => void) => () => void;
  readonly resolveClose: (resolution: AppCloseResolution) => void;
  readonly loadRecoveryStorage: () => Promise<AppRecoveryStorageSnapshot>;
  readonly commitRecoveryStorage: (commit: AppRecoveryStorageCommit) => Promise<void>;
}

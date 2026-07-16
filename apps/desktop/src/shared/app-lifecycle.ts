export const APP_CLOSE_REQUESTED_CHANNEL = 'tileborne:app-close:requested';
export const APP_CLOSE_RESOLVED_CHANNEL = 'tileborne:app-close:resolved';
export const APP_RECOVERY_STORAGE_LOAD_CHANNEL = 'tileborne:app-recovery-storage:load';
export const APP_RECOVERY_STORAGE_COMMIT_CHANNEL = 'tileborne:app-recovery-storage:commit';

export interface AppRecoveryStorageRecord {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly kind: string;
  readonly label: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly snapshot: unknown;
}

export type AppRecoveryStorageMutation =
  | { readonly _tag: 'upsert'; readonly record: AppRecoveryStorageRecord }
  | { readonly _tag: 'delete'; readonly documentId: string };

export interface AppRecoveryStorageCommit {
  readonly mutations: readonly AppRecoveryStorageMutation[];
}

export interface AppRecoveryStorageSnapshot {
  readonly records: readonly AppRecoveryStorageRecord[];
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

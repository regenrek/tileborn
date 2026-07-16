export const APP_CLOSE_REQUESTED_CHANNEL = 'tileborne:app-close:requested';
export const APP_CLOSE_RESOLVED_CHANNEL = 'tileborne:app-close:resolved';
export const APP_RECOVERY_STORAGE_FLUSH_CHANNEL = 'tileborne:app-recovery-storage:flush';

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
  readonly flushRecoveryStorage: () => Promise<void>;
}

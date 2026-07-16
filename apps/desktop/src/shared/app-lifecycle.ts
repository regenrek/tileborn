export const APP_CLOSE_REQUESTED_CHANNEL = 'tileborne:app-close:requested';
export const APP_CLOSE_RESOLVED_CHANNEL = 'tileborne:app-close:resolved';

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
}

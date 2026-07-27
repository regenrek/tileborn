import type { DesktopUpdateState } from '@tileborne/ipc-contracts';

export interface TileborneDesktopUpdatesBridge {
  getState(): Promise<DesktopUpdateState>;
  check(): Promise<DesktopUpdateState>;
  restart(): Promise<DesktopUpdateState>;
  onStateChanged(handler: (state: DesktopUpdateState) => void): () => void;
}

import type { MainTileborneBridge } from '@tileborne/ipc-contracts';

import type { TileborneIpcTransport } from '../shared/ipc-transport';
import type { TileborneStartupBridge } from '../shared/startup-status';
import type { TileborneAppLifecycleBridge } from '../shared/app-lifecycle';
import type { MultiplayerSessionState } from '@/lib/playtest-multiplayer-client';

declare global {
  interface Window {
    /** Typed bridge, built in the renderer realm at bootstrap (tileborne-bridge.ts). */
    readonly tileborne: MainTileborneBridge;
    /** Raw channel-allowlisted transport exposed by the preload script. */
    readonly tileborneIpc: TileborneIpcTransport;
    readonly tileborneStartup: TileborneStartupBridge;
    readonly tileborneAppLifecycle: TileborneAppLifecycleBridge;
    __tileborne_e2e?: {
      readonly getMultiplayerSessionState?: () => MultiplayerSessionState | null;
    };
  }

  const __BATTLE_ROYALE_PLUGIN_PATH__: string;
  const __APP_VERSION__: string;
  const __GIT_COMMIT__: string;
}

export {};

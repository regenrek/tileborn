import type { MainTileborneBridge } from '@tileborne/ipc-contracts';

import type { TileborneIpcTransport } from '../shared/ipc-transport';
import type { TileborneStartupBridge } from '../shared/startup-status';
import type { TileborneAppLifecycleBridge } from '../shared/app-lifecycle';
import type { TileborneDesktopUpdatesBridge } from '../shared/desktop-updates-bridge';
import type { MultiplayerSessionState } from '@/lib/playtest-multiplayer-client';
import type { LocalMultiplayerParticipantSession } from '@/lib/playtest-room-url';

declare global {
  interface Window {
    /** Typed bridge, built in the renderer realm at bootstrap (tileborne-bridge.ts). */
    readonly tileborne: MainTileborneBridge;
    /** Raw channel-allowlisted transport exposed by the preload script. */
    readonly tileborneIpc: TileborneIpcTransport;
    readonly tileborneStartup: TileborneStartupBridge;
    readonly tileborneAppLifecycle: TileborneAppLifecycleBridge;
    readonly tileborneDesktopUpdates: TileborneDesktopUpdatesBridge;
    __tileborne_e2e?: {
      readonly getMultiplayerSessionState?: () => MultiplayerSessionState | null;
      readonly getMultiplayerStoreState?: () => {
        readonly flowPhase: string;
        readonly hasRoomReady: boolean;
        readonly isReadyPending: boolean;
        readonly lobbyError: string | null;
        readonly lobbyState: unknown;
        readonly participantSession: LocalMultiplayerParticipantSession | null;
        readonly roomResults: unknown;
      };
      readonly joinMultiplayerSession?: (
        session: LocalMultiplayerParticipantSession,
        options: {
          readonly rendererCapabilityId: string;
          readonly mapId: string;
          readonly mapWidth: number;
          readonly mapHeight: number;
        },
      ) => Promise<void>;
    };
  }

  const __BATTLE_ROYALE_PLUGIN_PATH__: string;
  const __APP_VERSION__: string;
  const __GIT_COMMIT__: string;
}

export {};

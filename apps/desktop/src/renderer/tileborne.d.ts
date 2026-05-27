import type { MainTileborneBridge } from "@tileborne/ipc-contracts";

import type { TileborneStartupBridge } from "../shared/startup-status";
import type { MultiplayerSessionState } from "@/lib/playtest-multiplayer-client";

declare global {
  interface Window {
    readonly tileborne: MainTileborneBridge;
    readonly tileborneStartup: TileborneStartupBridge;
    __tileborne_e2e?: {
      readonly getMultiplayerSessionState?: () => MultiplayerSessionState | null;
    };
  }

  const __BATTLE_ROYALE_PLUGIN_PATH__: string;
  const __APP_VERSION__: string;
  const __GIT_COMMIT__: string;
}

export {};

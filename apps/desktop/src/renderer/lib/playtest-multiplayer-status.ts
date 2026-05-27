import type { PlaytestSessionConnectionInput } from '@/lib/playtest-runtime-status';
import type { MultiplayerSessionState } from '@/lib/playtest-multiplayer-client';

export const multiplayerStateToConnectionInput = (
  state: MultiplayerSessionState | null,
): PlaytestSessionConnectionInput | undefined => {
  if (!state || state.phase === 'idle') {
    return undefined;
  }
  if (state.phase === 'disconnected') {
    return { status: 'Stopped' };
  }
  if (state.phase === 'connecting') {
    return { status: 'Starting' };
  }
  if (state.phase === 'error') {
    return {
      status: 'Running',
      runtimeMetrics: {
        tickCount: state.tick,
        playerCount: state.players.length,
        lastPluginEvent: `startup-failed: ${state.errorMessage ?? 'connection error'}`,
        hud: state.hud,
      },
    };
  }
  return {
    status: 'Running',
    runtimeMetrics: {
      tickCount: state.tick,
      playerCount: state.players.length,
      lastPluginEvent: 'multiplayer-live',
      hud: state.hud,
    },
  };
};

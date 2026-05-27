import type { PlaytestHudState } from '@/lib/playtest-hud-utils';

export const PLAYTEST_RUNTIME_STARTING_MESSAGE = 'Starting plugin runtime…';

export const PLAYTEST_STARTUP_FAILED_PREFIX = 'startup-failed:';

export interface PlaytestRuntimeStatusMetrics {
  readonly tickCount: number;
  readonly playerCount: number;
  readonly lastPluginEvent: string;
  readonly lastTickAtMs?: number | undefined;
  readonly hud?: PlaytestHudState | undefined;
}

export type PlaytestConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'error'
  | 'disconnected';

export interface PlaytestSessionConnectionInput {
  readonly status: 'Starting' | 'Running' | 'Stopped';
  readonly runtimeMetrics?: PlaytestRuntimeStatusMetrics | undefined;
}

export function isPlaytestStartupFailed(lastPluginEvent: string): boolean {
  return lastPluginEvent.startsWith(PLAYTEST_STARTUP_FAILED_PREFIX);
}

export function parseStartupFailedReason(lastPluginEvent: string): string {
  return lastPluginEvent.slice(PLAYTEST_STARTUP_FAILED_PREFIX.length).trim();
}

export function resolvePlaytestConnectionStatus(
  session: PlaytestSessionConnectionInput | undefined,
): PlaytestConnectionStatus {
  if (!session) {
    return 'idle';
  }
  if (session.status === 'Stopped') {
    return 'disconnected';
  }
  if (session.status === 'Starting' || session.runtimeMetrics === undefined) {
    return 'connecting';
  }
  if (isPlaytestStartupFailed(session.runtimeMetrics.lastPluginEvent)) {
    return 'error';
  }
  if (session.status === 'Running') {
    return 'live';
  }
  return 'idle';
}

export function formatPlaytestRuntimeStatus(
  pluginName: string,
  metrics: PlaytestRuntimeStatusMetrics,
): string {
  if (isPlaytestStartupFailed(metrics.lastPluginEvent)) {
    const reason = parseStartupFailedReason(metrics.lastPluginEvent);
    return `Plugin ${pluginName} · startup failed · ${reason}`;
  }
  return `Plugin ${pluginName} · ${metrics.lastPluginEvent} · Tick ${metrics.tickCount} · Players: ${metrics.playerCount}`;
}

export function resolvePlaytestPluginName(activePlugins: readonly string[]): string {
  return activePlugins[0] ?? 'unknown';
}

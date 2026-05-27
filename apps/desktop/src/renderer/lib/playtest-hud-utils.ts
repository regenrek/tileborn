import { Schema } from 'effect';

import { PlaytestRuntimeHud, PlaytestRuntimeHudEvent } from '@tileborne/ipc-contracts';

export type PlaytestHudState = Schema.Schema.Type<typeof PlaytestRuntimeHud>;
export type PlaytestHudEvent = Schema.Schema.Type<typeof PlaytestRuntimeHudEvent>;

export type PlaytestHudMetrics = {
  readonly playerCount: number;
  readonly tickCount: number;
  readonly hud?: PlaytestHudState | undefined;
};

export function formatZoneStatusLabel(
  zoneStatus: NonNullable<PlaytestHudState['zoneStatus']>,
): string {
  if (zoneStatus.phase === 'countdown') {
    const seconds = zoneStatus.secondsRemaining ?? 0;
    return `Zone shrinks in ${seconds}s`;
  }
  if (zoneStatus.phase === 'shrinking') {
    return 'Zone shrinking';
  }
  return 'Zone stable';
}

export function formatAlivePlayersLabel(alive: number, total: number): string {
  return `${alive} / ${total} players alive`;
}

export function healthPercent(health: number, maxHealth: number): number {
  if (maxHealth <= 0) {
    return 0;
  }
  return Math.round((health / maxHealth) * 100);
}

export function eventKey(event: PlaytestHudEvent): string {
  if (event._tag === 'PlayerKilled') {
    return `PlayerKilled:${event.victimId}:${event.tick}:${event.emittedAtMs}`;
  }
  return `GameOver:${event.winnerId}:${event.emittedAtMs}`;
}

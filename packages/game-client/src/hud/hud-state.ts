import { Schema } from 'effect';

import { PlaytestRuntimeHud, type GameplayEvent } from '@tileborne/ipc-contracts';

/**
 * Neutral HUD state shape consumed by the shared HUD chassis ({@link HudOverlay}).
 * The wire/IPC schema lives in `@tileborne/ipc-contracts` (single source of
 * truth); this module only derives the TypeScript view types plus the pure
 * formatting helpers that both the editor playtest and the shipped game
 * client share.
 */
export type HudState = Schema.Schema.Type<typeof PlaytestRuntimeHud>;
export type HudEvent = GameplayEvent;

export type HudMetrics = {
  readonly playerCount: number;
  readonly tickCount: number;
  readonly hud?: HudState | undefined;
};

export function formatZoneStatusLabel(zoneStatus: NonNullable<HudState['zoneStatus']>): string {
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

export function eventKey(event: HudEvent): string {
  switch (event._tag) {
    case 'WeaponFired':
      return `WeaponFired:${event.sourceId}:${event.weaponId}:${event.tick}`;
    case 'DamageApplied':
      return `DamageApplied:${event.targetId}:${event.sourceId ?? 'environment'}:${event.tick}`;
    case 'EntityDefeated':
      return `EntityDefeated:${event.targetId}:${event.sourceId ?? 'environment'}:${event.tick}`;
    case 'ItemGranted':
      return `ItemGranted:${event.targetId}:${event.itemId}:${event.quantity}:${event.tick}`;
    case 'ItemDropped':
      return `ItemDropped:${event.sourceId}:${event.itemId}:${event.tick}`;
    case 'ItemConsumed':
      return `ItemConsumed:${event.sourceId}:${event.itemId}:${event.tick}`;
    case 'StatusApplied':
      return `StatusApplied:${event.targetId}:${event.effectId}:${event.tick}`;
    case 'StatusExpired':
      return `StatusExpired:${event.targetId}:${event.effectId}:${event.tick}`;
    case 'ZonePhaseChanged':
      return `ZonePhaseChanged:${event.phase}:${event.tick}`;
    case 'MatchPhaseChanged':
      return `MatchPhaseChanged:${event.phase}:${event.winnerId ?? 'none'}:${event.tick}`;
  }
}

import { Schema } from "effect";

import { PlaytestRuntimeHud, PlaytestRuntimeHudEvent } from "@tileborne/ipc-contracts";

/**
 * Neutral HUD state shape consumed by the shared HUD chassis ({@link HudOverlay}).
 * The wire/IPC schema lives in `@tileborne/ipc-contracts` (single source of
 * truth); this module only derives the TypeScript view types plus the pure
 * formatting helpers that both the editor playtest and the shipped game
 * client share.
 */
export type HudState = Schema.Schema.Type<typeof PlaytestRuntimeHud>;
export type HudEvent = Schema.Schema.Type<typeof PlaytestRuntimeHudEvent>;

export type HudMetrics = {
  readonly playerCount: number;
  readonly tickCount: number;
  readonly hud?: HudState | undefined;
};

export function formatZoneStatusLabel(zoneStatus: NonNullable<HudState["zoneStatus"]>): string {
  if (zoneStatus.phase === "countdown") {
    const seconds = zoneStatus.secondsRemaining ?? 0;
    return `Zone shrinks in ${seconds}s`;
  }
  if (zoneStatus.phase === "shrinking") {
    return "Zone shrinking";
  }
  return "Zone stable";
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
  if (event._tag === "PlayerKilled") {
    return `PlayerKilled:${event.victimId}:${event.tick}:${event.emittedAtMs}`;
  }
  if (event._tag === "PickupCollected") {
    return `PickupCollected:${event.playerId}:${event.itemKind}:${event.tier}:${event.quantity}:${event.tick}:${event.emittedAtMs}`;
  }
  return `GameOver:${event.winnerId}:${event.emittedAtMs}`;
}

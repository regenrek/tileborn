import { LOOT_PICKUP_RADIUS } from "./constants.js";

export interface HealthState {
  readonly current: number;
  readonly max: number;
}

export interface PlayerState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly health: HealthState;
  readonly alive: boolean;
}

export interface ZoneState {
  readonly centerX: number;
  readonly centerY: number;
  readonly currentRadius: number;
  readonly endRadius: number;
  readonly shrinkIntervalMs: number;
  readonly damagePerSecond: number;
  readonly phaseIndex: number;
  readonly elapsedMs: number;
}

export interface LootCrateState {
  readonly tier: string;
  readonly x: number;
  readonly y: number;
  readonly collected: boolean;
}

export interface InventoryItem {
  readonly itemKind: string;
  readonly tier: string;
}

export type WinCondition =
  | { readonly kind: "ongoing" }
  | { readonly kind: "victor"; readonly victor: string };

export interface WinCheckSnapshot {
  readonly players: readonly PlayerState[];
}

export interface PickupSnapshot {
  readonly playerX: number;
  readonly playerY: number;
  readonly pickupRadius: number;
}

export interface SimulationRules {
  readonly applyZoneDamage: (player: PlayerState, zone: ZoneState, dtSeconds: number) => HealthState;
  readonly checkWinCondition: (snapshot: WinCheckSnapshot) => WinCondition;
  readonly processLootPickup: (
    player: PickupSnapshot,
    crate: LootCrateState,
  ) => readonly InventoryItem[];
}

export const createSimulationRules = (): SimulationRules => ({
  applyZoneDamage: (player, _zone, _dtSeconds) => {
    void _zone;
    void _dtSeconds;
    return player.health;
  },
  checkWinCondition: () => ({ kind: "ongoing" }),
  processLootPickup: () => [],
});

export const defaultPickupRadius = (): number => LOOT_PICKUP_RADIUS;

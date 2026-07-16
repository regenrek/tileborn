import {
  BattleRoyaleProtocol,
  GameplayEntityDefeated,
  GameplayItemGranted,
  GameplayMatchPhaseChanged,
  makeGameplayEntityId,
  makeGameplayItemId,
  type GameplayEvent,
} from '@tileborne/ipc-contracts';

import type { PlaytestPluginWorld } from './playtest-plugin-world.js';

/**
 * Host-side playtest HUD tracker (engine chassis, plugin-agnostic).
 *
 * Ownership split (HUD-state SSOT): the WORLD→HUD derivation — which ECS
 * components exist and how they project into player status, scoreboard,
 * minimap, and zone phase — is plugin code. The active mode's runtime bundle
 * exports `derivePlaytestHudWorldState`, and the host calls it through the
 * {@link PlaytestHudWorldStateDeriver} seam. This module owns only host
 * concerns: accumulating wire events (kill feed, pickup toasts, game-over)
 * across ticks and composing them with the plugin-derived world slice. No
 * Battle Royale component name or zone-schedule constant lives here.
 */

const { decodeMessage } = BattleRoyaleProtocol;

const MAX_GAMEPLAY_EVENTS = 20;

/** The per-tick HUD slice derived from the plugin world — plugin-owned. */
export interface PlaytestRuntimeHudWorldState {
  readonly totalPlayers: number;
  readonly localPlayer?: {
    readonly playerId: string;
    readonly displayName: string;
    readonly team?: string;
    readonly health: number;
    readonly maxHealth: number;
    readonly position?: { readonly x: number; readonly y: number };
    readonly shield?: number;
    readonly armor?: { readonly mitigation: number; readonly durability: number };
    readonly weapon?: {
      readonly weaponId: string;
      readonly slot: number;
      readonly ammoInMagazine?: number;
      readonly magazineSize?: number;
      readonly reserveAmmo?: number;
      readonly cooldownRemainingTicks?: number;
      readonly reloadRemainingTicks?: number;
      readonly reloadTotalTicks?: number;
    };
    readonly inventory?: { readonly itemIds: readonly string[]; readonly capacity: number };
    readonly pickupPrompt?: {
      readonly itemKind?: string;
      readonly tier?: string;
      readonly distance?: number;
      readonly action: 'pickup-loot';
      readonly available: boolean;
    };
    readonly pickupToast?: {
      readonly itemKind: string;
      readonly tier: string;
      readonly quantity: number;
      readonly tick: number;
    };
    readonly damageIndicator?: {
      readonly sourceId: string;
      readonly angleDeg: number;
      readonly amount: number;
      readonly tick: number;
    };
    readonly stats?: { readonly kills: number; readonly deaths: number };
    readonly statusEffects?: readonly {
      readonly effectId: string;
      readonly remainingTicks: number;
      readonly stacks: number;
    }[];
    readonly abilityCooldowns?: readonly {
      readonly abilityId: string;
      readonly remainingTicks: number;
    }[];
  };
  readonly zoneStatus?: {
    readonly phase: 'stable' | 'countdown' | 'shrinking';
    readonly secondsRemaining?: number;
  };
  readonly scoreboard?: readonly {
    readonly playerId: string;
    readonly displayName: string;
    readonly team?: string;
    readonly health: number;
    readonly alive: boolean;
    readonly kills: number;
    readonly deaths: number;
  }[];
  readonly minimap?: {
    readonly zone?: { readonly cx: number; readonly cy: number; readonly radius: number };
    readonly players: readonly {
      readonly playerId: string;
      readonly x: number;
      readonly y: number;
      readonly local: boolean;
      readonly alive: boolean;
      readonly health: number;
    }[];
    readonly objects: readonly {
      readonly objectId: string;
      readonly x: number;
      readonly y: number;
      readonly kind: 'pickup' | 'loot' | 'hazard' | 'objective';
      readonly tier?: string;
      readonly available?: boolean;
    }[];
  };
}

/** The complete HUD state the runtime metrics expose to the renderer. */
export interface PlaytestRuntimeHudState extends PlaytestRuntimeHudWorldState {
  readonly gameplayEvents: readonly GameplayEvent[];
  readonly gameOver?: {
    readonly winnerId: string;
    readonly winnerDisplayName: string;
    readonly alivePlayers: number;
    readonly totalPlayers: number;
    readonly tickCount: number;
  };
}

/**
 * The plugin runtime bundle's world→HUD derivation export. Structurally
 * matches `derivePlaytestHudWorldState` in the Battle Royale runtime bundle;
 * other game-mode plugins export their own.
 */
export type PlaytestHudWorldStateDeriver = (
  world: PlaytestPluginWorld,
  tickCount: number,
) => PlaytestRuntimeHudWorldState | undefined;

export interface PlaytestRuntimeHudTracker {
  readonly ingestFrames: (frames: readonly Uint8Array[]) => void;
  readonly snapshot: (world: PlaytestPluginWorld, tickCount: number) => PlaytestRuntimeHudState;
}

const EMPTY_WORLD_STATE: PlaytestRuntimeHudWorldState = {
  totalPlayers: 0,
  scoreboard: [],
  minimap: { players: [], objects: [] },
};

const formatPlayerDisplayName = (playerId: string): string => {
  const match = /^player-(\d+)$/.exec(playerId);
  if (match) {
    return `Player ${match[1]}`;
  }
  return playerId;
};

export const createPlaytestRuntimeHudTracker = (
  deriveWorldState?: PlaytestHudWorldStateDeriver,
): PlaytestRuntimeHudTracker => {
  const gameplayEvents: GameplayEvent[] = [];
  const seenPickupToastKeys = new Set<string>();
  let gameOver: PlaytestRuntimeHudState['gameOver'];

  const pushEvent = (event: GameplayEvent): void => {
    gameplayEvents.push(event);
    if (gameplayEvents.length > MAX_GAMEPLAY_EVENTS) {
      gameplayEvents.shift();
    }
  };

  return {
    ingestFrames(frames) {
      for (const frame of frames) {
        try {
          const message = decodeMessage(frame);
          if (message._tag === 'PlayerKilled') {
            pushEvent(
              new GameplayEntityDefeated({
                targetId: makeGameplayEntityId(message.victim),
                sourceId: makeGameplayEntityId(message.killer),
                tick: message.tick,
              }),
            );
          } else if (message._tag === 'GameOver') {
            const winnerDisplayName = formatPlayerDisplayName(message.winner);
            gameOver = {
              winnerId: message.winner,
              winnerDisplayName,
              alivePlayers: 1,
              totalPlayers: 0,
              tickCount: 0,
            };
            pushEvent(
              new GameplayMatchPhaseChanged({
                tick: 0,
                phase: 'finished',
                winnerId: makeGameplayEntityId(message.winner),
              }),
            );
          }
        } catch {
          // Ignore malformed plugin frames.
        }
      }
    },
    snapshot(world, tickCount) {
      const worldState = deriveWorldState?.(world, tickCount) ?? EMPTY_WORLD_STATE;
      const localPlayer = worldState.localPlayer;

      const pickupToast = localPlayer?.pickupToast;
      if (localPlayer !== undefined && pickupToast !== undefined) {
        const key = `${localPlayer.playerId}:${pickupToast.itemKind}:${pickupToast.tier}:${pickupToast.quantity}:${pickupToast.tick}`;
        if (!seenPickupToastKeys.has(key)) {
          seenPickupToastKeys.add(key);
          pushEvent(
            new GameplayItemGranted({
              targetId: makeGameplayEntityId(localPlayer.playerId),
              itemId: makeGameplayItemId(`${pickupToast.itemKind}:${pickupToast.tier}`),
              quantity: pickupToast.quantity,
              tick: pickupToast.tick,
            }),
          );
        }
      }

      if (gameOver) {
        gameOver = {
          ...gameOver,
          totalPlayers: worldState.totalPlayers,
          tickCount,
        };
      }

      const currentGameOver = gameOver;
      const events =
        currentGameOver === undefined
          ? [...gameplayEvents]
          : gameplayEvents.map((event) =>
              event._tag === 'MatchPhaseChanged' && event.phase === 'finished'
                ? new GameplayMatchPhaseChanged({
                    ...event,
                    tick: currentGameOver.tickCount,
                  })
                : event,
            );

      return {
        ...worldState,
        gameplayEvents: events,
        ...(gameOver !== undefined ? { gameOver } : {}),
      };
    },
  };
};

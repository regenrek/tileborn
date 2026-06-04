/**
 * Minimal runtime-plugin surface for the example arena adapter. Mirrors the
 * shape of `plugin-battle-royale`'s `RuntimePlugin` host contract but trimmed to
 * the skeleton this proof needs (move + fire). The engine's real runtime host
 * provides a richer world/ECS; this example only demonstrates that a plugin can
 * drive the neutral `@tileborne/simulation` firing core per tick.
 */

/** One tick of resolved player intent the host feeds the adapter. */
export interface ArenaPlayerInput {
  /** Horizontal move axis in [-1, 1]. */
  readonly moveX: number;
  /** Vertical move axis in [-1, 1]. */
  readonly moveY: number;
  /** Whether the melee swing (PrimaryAction) is pressed this tick. */
  readonly attack: boolean;
}

export interface ArenaRuntimeHost {
  /** Deterministic seed (unused by this skeleton, kept for parity). */
  readonly seed?: number;
  /** Resolved player intent for the current tick, when available. */
  readonly getPlayerInput?: () => ArenaPlayerInput | undefined;
}

export interface ArenaRuntimePlugin {
  readonly id: string;
  readonly onInit?: () => void;
  readonly onTick?: (dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

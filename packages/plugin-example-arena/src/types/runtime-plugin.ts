/**
 * Minimal runtime-plugin surface for the example arena adapter. Mirrors the
 * shape of `plugin-battle-royale`'s `RuntimePlugin` host contract but trimmed to
 * the skeleton this proof needs (move + fire). The engine's real runtime host
 * provides a richer world/ECS; this example only demonstrates that a plugin can
 * drive the neutral `@tileborne/simulation` firing core per tick.
 */

/** One tick of resolved player intent the host feeds the adapter. */
export interface ArenaRuntimeInput {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot: boolean;
  readonly aimDeg?: number;
}

export interface ArenaRuntimeMessageOut {
  readonly push: (frame: Uint8Array) => void;
}

export interface ArenaRuntimeHost {
  /** Deterministic seed (unused by this skeleton, kept for parity). */
  readonly seed?: string | number;
  /** Resolved player intent for the current tick, when available. */
  readonly getPlayerInput?: (playerId: string) => ArenaRuntimeInput | undefined;
  readonly msgOut?: ArenaRuntimeMessageOut;
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
}

export interface ArenaRuntimePluginContext {
  readonly pluginId: string;
}

export interface ArenaPluginWorld {
  readonly createEntity: () => number;
}

export interface ArenaRuntimePlugin {
  readonly id: string;
  readonly onInit?: (ctx: ArenaRuntimePluginContext, world: ArenaPluginWorld) => void;
  readonly onTick?: (world: ArenaPluginWorld, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

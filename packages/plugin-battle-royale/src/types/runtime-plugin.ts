import type { BattleRoyaleAbilityId } from '@tileborne/ipc-contracts/protocols/battle-royale';
import type { JsonValue } from '@tileborne/core';
import type {
  RuntimeAdapter,
  RuntimeAdapterComponentStore,
  RuntimeAdapterContext,
  RuntimeAdapterHost,
  RuntimeAdapterWorld,
} from '@tileborne/plugin-api';

import type { BattleRoyaleConfigInput } from '../battle-royale-config.js';

export type ComponentStore<T extends object> = RuntimeAdapterComponentStore<T>;

export interface PluginWorld extends RuntimeAdapterWorld {
  readonly registerComponent: <T extends object>(name: string) => ComponentStore<T>;
  readonly getComponent: <T extends object>(name: string) => ComponentStore<T>;
}

export interface RuntimeMessageOut {
  readonly push: (frame: Uint8Array) => void;
}

export type RuntimeAdapterConfig = BattleRoyaleConfigInput;

export interface RuntimePlayerInput {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly interact: boolean;
  readonly drop: boolean;
  readonly abilities: readonly BattleRoyaleAbilityId[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

/** Per-session player→model assignment (host session concern, never package data). */
export interface PlayerModelSelection {
  readonly playerId: string;
  readonly modelId: string;
}

export interface RuntimePluginHost extends RuntimeAdapterHost {
  /**
   * The encoded `RuntimeMapPackage` wire JSON (ADR-0030): the ONE payload
   * every runtime host hands the plugin. The plugin decodes it through the
   * canonical schema and derives its own runtime state.
   */
  readonly getMapPackage: () => unknown;
  /**
   * Per-session player-model selections. The package deliberately carries no
   * per-session data, so hosts that know who picked which model provide it
   * through this channel.
   */
  readonly getPlayerModelSelections?: () => readonly PlayerModelSelection[];
  readonly getPlayerIds?: () => readonly string[];
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly msgOut?: RuntimeMessageOut;
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  readonly getPluginCheckpoint?: (pluginId: string) => JsonValue | undefined;
  readonly seed?: string | number;
  readonly config?: RuntimeAdapterConfig;
  readonly setPluginCheckpoint?: (pluginId: string, checkpoint: JsonValue | undefined) => void;
}

export type RuntimePluginContext = RuntimeAdapterContext;

export interface RuntimePlugin extends RuntimeAdapter {
  readonly onInit?: (ctx: RuntimePluginContext, world: PluginWorld) => void;
  readonly onTick?: (world: PluginWorld, dt: number, tick: number) => void;
}

import type { BattleRoyaleAbilityId } from "@tileborne/ipc-contracts/protocols/battle-royale";

import type { BattleRoyaleConfigInput } from "../battle-royale-config.js";
import type { ExportedArtifact } from "./artifact.js";

export interface ComponentStore<T extends object> {
  readonly get: (entity: number) => T | undefined;
  readonly set: (entity: number, value: T) => void;
  readonly has: (entity: number) => boolean;
  readonly delete: (entity: number) => void;
  readonly entries: () => Iterable<[number, T]>;
}

export interface PluginWorld {
  readonly createEntity: () => number;
  readonly destroyEntity: (entity: number) => void;
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

export interface RuntimePluginHost {
  readonly getArtifact: () => ExportedArtifact;
  readonly getPlayerIds?: () => readonly string[];
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly msgOut?: RuntimeMessageOut;
  readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  readonly seed?: string | number;
  readonly config?: RuntimeAdapterConfig;
}

export interface RuntimePluginContext {
  readonly pluginId: string;
}

export interface RuntimePlugin {
  readonly id: string;
  readonly onInit?: (ctx: RuntimePluginContext, world: PluginWorld) => void;
  readonly onTick?: (world: PluginWorld, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

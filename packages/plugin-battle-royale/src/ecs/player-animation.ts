import type { PlayerModelClipKey } from '@tileborne/core';

import type { RuntimePlayerInput } from '../types/runtime-plugin.js';
import {
  ANIMATION_STATE_COMPONENT,
  FACING_COMPONENT,
  PLAYER_COMPONENT,
  type AnimationState,
  type Direction8,
  type Facing,
  type Player,
} from './components.js';
import type { PluginWorld } from '../types/runtime-plugin.js';

const DEFAULT_FACING_DEG = 0;

const isDirection8 = (dir: number | undefined): dir is Direction8 =>
  dir !== undefined && Number.isInteger(dir) && dir >= 0 && dir <= 7;

const isAimDeg = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0 && value < 360;

export const direction8ToFacingDeg = (dir: Direction8): number => dir * 45;

const clipKeyForInput = (
  input: RuntimePlayerInput | undefined,
  acceptedFireTick: number | undefined,
): PlayerModelClipKey => {
  if (input?.reload) {
    return 'reload';
  }
  if (input?.shoot && acceptedFireTick !== undefined) {
    return 'shoot';
  }
  return isDirection8(input?.dir) ? 'run' : 'idle';
};

const animationFor = (
  player: Player,
  input: RuntimePlayerInput | undefined,
  facing: Facing | undefined,
  acceptedFireTick: number | undefined,
): AnimationState | undefined => {
  if (player.modelId === undefined) {
    return undefined;
  }
  const moving = isDirection8(input?.dir);
  const facingDeg = isAimDeg(input?.aimDeg)
    ? input.aimDeg
    : moving
      ? direction8ToFacingDeg(input.dir)
      : facing === undefined
        ? DEFAULT_FACING_DEG
        : direction8ToFacingDeg(facing.dir);
  return {
    modelId: player.modelId,
    clipKey: clipKeyForInput(input, acceptedFireTick),
    facingDeg,
    moving,
    ...(isAimDeg(input?.aimDeg) ? { aimDeg: input.aimDeg } : {}),
    ...(acceptedFireTick === undefined ? {} : { acceptedFireTick }),
  };
};

export const updatePlayerAnimationStates = (
  world: PluginWorld,
  getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined,
  getAcceptedFireTick?: (playerId: string) => number | undefined,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const animations = world.registerComponent<AnimationState>(ANIMATION_STATE_COMPONENT);
  const facings = world.registerComponent<Facing>(FACING_COMPONENT);

  for (const [entity, player] of players.entries()) {
    const animation =
      player.alive === 1
        ? animationFor(
            player,
            getPlayerInput?.(player.playerId),
            facings.get(entity),
            getAcceptedFireTick?.(player.playerId),
          )
        : undefined;
    if (animation === undefined) {
      animations.delete(entity);
      continue;
    }
    animations.set(entity, animation);
  }
};

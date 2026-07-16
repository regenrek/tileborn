import type { PlayerModelRef } from '@tileborne/core';

import { MOVEMENT } from '../constants.js';
import type { ExportedArtifact } from '../types/artifact.js';
import type { Player } from './components.js';

export interface PlayerPhysicsProfile {
  readonly radius: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface PlayerPhysicsDefaults {
  readonly radius: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const DEFAULT_PLAYER_PHYSICS: PlayerPhysicsDefaults = {
  radius: MOVEMENT.radius,
  offsetX: 0,
  offsetY: MOVEMENT.footprintOffsetY,
};

const DEFAULT_HITBOX = {
  x: 0.25,
  y: 0.1,
  width: 0.5,
  height: 0.85,
} as const;

const center = (rect: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): { readonly x: number; readonly y: number } => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

const maxExtent = (rect: { readonly width: number; readonly height: number }): number =>
  Math.max(rect.width, rect.height);

export const playerPhysicsFromModel = (
  model: PlayerModelRef,
  defaults: PlayerPhysicsDefaults = DEFAULT_PLAYER_PHYSICS,
): PlayerPhysicsProfile => {
  const baselineCenter = center(DEFAULT_HITBOX);
  const modelCenter = center(model.hitbox);
  const pixelsPerNormalizedUnit = (defaults.radius * 2) / maxExtent(DEFAULT_HITBOX);

  return {
    radius: Math.max(1, (maxExtent(model.hitbox) * pixelsPerNormalizedUnit) / 2),
    offsetX: defaults.offsetX + (modelCenter.x - baselineCenter.x) * pixelsPerNormalizedUnit,
    offsetY: defaults.offsetY + (modelCenter.y - baselineCenter.y) * pixelsPerNormalizedUnit,
  };
};

export const buildPlayerPhysicsByModelId = (
  artifact: ExportedArtifact,
  defaults: PlayerPhysicsDefaults = DEFAULT_PLAYER_PHYSICS,
): ReadonlyMap<string, PlayerPhysicsProfile> =>
  new Map(
    (artifact.playerModels ?? []).map((model) => [
      model.id,
      playerPhysicsFromModel(model, defaults),
    ]),
  );

export const physicsForPlayer = (
  player: Player,
  byModelId: ReadonlyMap<string, PlayerPhysicsProfile> | undefined,
  defaults: PlayerPhysicsDefaults = DEFAULT_PLAYER_PHYSICS,
): PlayerPhysicsProfile => {
  const profile = player.modelId === undefined ? undefined : byModelId?.get(player.modelId);
  return profile ?? defaults;
};

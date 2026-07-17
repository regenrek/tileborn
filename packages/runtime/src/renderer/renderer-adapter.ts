import { Schema, type Effect } from 'effect';

import type { LoadedAssets, RuntimeAssetManifest } from '../assets/runtime-asset-loader.js';
import { PositionComponent } from '../ecs/components.js';
import type { EntityId, World } from '../ecs/world.js';

export interface MountedRenderer {
  readonly container: unknown;
}

export class RendererInitError extends Schema.TaggedErrorClass<RendererInitError>()(
  'RendererInitError',
  {
    message: Schema.String,
  },
) {}

export class RendererAssetError extends Schema.TaggedErrorClass<RendererAssetError>()(
  'RendererAssetError',
  {
    message: Schema.String,
    assetId: Schema.String,
  },
) {}

export class RendererRenderError extends Schema.TaggedErrorClass<RendererRenderError>()(
  'RendererRenderError',
  {
    message: Schema.String,
  },
) {}

export class RendererDisposeError extends Schema.TaggedErrorClass<RendererDisposeError>()(
  'RendererDisposeError',
  {
    message: Schema.String,
  },
) {}

const causeMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const rendererInitError = (message: string, cause?: unknown): RendererInitError =>
  new RendererInitError({
    message: cause === undefined ? message : `${message}: ${causeMessage(cause)}`,
  });

export const rendererAssetError = (
  assetId: string,
  message: string,
  cause?: unknown,
): RendererAssetError =>
  new RendererAssetError({
    assetId,
    message: cause === undefined ? message : `${message}: ${causeMessage(cause)}`,
  });

export const rendererRenderError = (message: string, cause?: unknown): RendererRenderError =>
  new RendererRenderError({
    message: cause === undefined ? message : `${message}: ${causeMessage(cause)}`,
  });

export const rendererDisposeError = (message: string, cause?: unknown): RendererDisposeError =>
  new RendererDisposeError({
    message: cause === undefined ? message : `${message}: ${causeMessage(cause)}`,
  });

export type RendererError =
  | RendererInitError
  | RendererAssetError
  | RendererRenderError
  | RendererDisposeError;

export interface RendererAdapter {
  readonly mount: (container: unknown) => Effect.Effect<MountedRenderer, RendererError>;
  readonly loadAssets: (
    manifest: RuntimeAssetManifest,
  ) => Effect.Effect<LoadedAssets, RendererError>;
  readonly renderFrame: (world: World, alpha: number) => Effect.Effect<void, RendererError>;
  readonly dispose: () => Effect.Effect<void, RendererError>;
}

export interface PreviousPosition {
  readonly x: number;
  readonly y: number;
}

const previousPositionsByWorld = new WeakMap<World, Map<EntityId, PreviousPosition>>();

export const capturePreviousPositions = (world: World): void => {
  const snapshot = new Map<EntityId, PreviousPosition>();
  world.query([PositionComponent], (entity, position) => {
    snapshot.set(entity, { x: position.x, y: position.y });
  });
  previousPositionsByWorld.set(world, snapshot);
};

export const previousPositionFor = (world: World, entity: EntityId): PreviousPosition | undefined =>
  previousPositionsByWorld.get(world)?.get(entity);

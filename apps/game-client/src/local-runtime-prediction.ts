import {
  LocalTransformPredictor,
  type LocalTransformReducer,
  type RenderableEntity,
} from '@tileborne/runtime';

export type LocalInputDirection = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LocalRuntimeInputPrediction {
  readonly sequence: number;
  readonly dir: LocalInputDirection | undefined;
}

export interface LocalAuthoritativeEntity {
  readonly entity: RenderableEntity;
  readonly acknowledgedInputSequence: number;
}

interface LocalTransform {
  readonly x: number;
  readonly y: number;
}

interface LocalMovementInput {
  readonly dir: LocalInputDirection | undefined;
  readonly dtSeconds: number;
}

const SPEED_UNITS_PER_SECOND = 120;
const MAX_FRAME_DT_SECONDS = 0.05;
const POSITION_EPSILON = 0.001;

const direction8ToUnitVector = (
  dir: LocalInputDirection,
): { readonly x: number; readonly y: number } => {
  const angle = (dir * Math.PI) / 4;
  return { x: Math.cos(angle), y: Math.sin(angle) };
};

const reduceLocalMovement: LocalTransformReducer<LocalTransform, LocalMovementInput> = (
  transform,
  input,
) => {
  if (input.dir === undefined || input.dtSeconds <= 0) {
    return transform;
  }
  const vector = direction8ToUnitVector(input.dir);
  const distance = SPEED_UNITS_PER_SECOND * input.dtSeconds;
  return {
    x: transform.x + vector.x * distance,
    y: transform.y + vector.y * distance,
  };
};

const entityTransform = (entity: RenderableEntity): LocalTransform => ({
  x: entity.x,
  y: entity.y,
});

const transformsDiffer = (left: LocalTransform, right: LocalTransform): boolean =>
  Math.abs(left.x - right.x) > POSITION_EPSILON || Math.abs(left.y - right.y) > POSITION_EPSILON;

export class LocalRuntimePredictionController {
  #predictor: LocalTransformPredictor<LocalTransform, LocalMovementInput> | undefined;
  #lastAuthoritativeTransform: LocalTransform | undefined;
  #lastFrameNowMs: number | undefined;
  #latestInput: LocalRuntimeInputPrediction | undefined;
  #pendingElapsedSeconds = 0;
  #pendingInputSequence: number | undefined;

  recordInput(input: LocalRuntimeInputPrediction): void {
    if (input.sequence !== this.#pendingInputSequence) {
      this.#pendingInputSequence = input.sequence;
      this.#pendingElapsedSeconds = 0;
    }
    this.#latestInput = input;
  }

  project(authority: LocalAuthoritativeEntity, nowMs: number): RenderableEntity {
    const authoritativeTransform = entityTransform(authority.entity);
    if (this.#predictor === undefined) {
      this.#predictor = new LocalTransformPredictor(authoritativeTransform, reduceLocalMovement);
      this.#lastAuthoritativeTransform = authoritativeTransform;
      this.#lastFrameNowMs = nowMs;
      return authority.entity;
    }

    if (
      this.#lastAuthoritativeTransform === undefined ||
      transformsDiffer(authoritativeTransform, this.#lastAuthoritativeTransform) ||
      authority.acknowledgedInputSequence > this.#predictor.getState().acknowledgedInputSequence
    ) {
      this.#predictor.reconcile({
        transform: authoritativeTransform,
        acknowledgedInputSequence: authority.acknowledgedInputSequence,
      });
      this.#lastAuthoritativeTransform = authoritativeTransform;
    }

    const elapsedSeconds =
      this.#lastFrameNowMs === undefined
        ? 0
        : Math.min(MAX_FRAME_DT_SECONDS, Math.max(0, (nowMs - this.#lastFrameNowMs) / 1000));
    this.#lastFrameNowMs = nowMs;

    if (this.#latestInput?.dir !== undefined) {
      const movement = {
        dir: this.#latestInput.dir,
        dtSeconds: elapsedSeconds,
      };
      if (
        this.#latestInput.sequence > this.#predictor.getState().acknowledgedInputSequence
      ) {
        this.#pendingElapsedSeconds += elapsedSeconds;
        this.#predictor.upsertPending(
          { ...movement, dtSeconds: this.#pendingElapsedSeconds },
          this.#latestInput.sequence,
        );
      } else {
        this.#predictor.advance(movement);
      }
    }

    const predicted = this.#predictor.getState().predictedTransform;
    if (!transformsDiffer(predicted, authoritativeTransform)) {
      return authority.entity;
    }
    return {
      ...authority.entity,
      x: predicted.x,
      y: predicted.y,
    };
  }

  reset(): void {
    this.#predictor = undefined;
    this.#lastAuthoritativeTransform = undefined;
    this.#lastFrameNowMs = undefined;
    this.#latestInput = undefined;
    this.#pendingElapsedSeconds = 0;
    this.#pendingInputSequence = undefined;
  }
}

export const applyLocalRuntimePredictionToEntities = (
  entities: readonly RenderableEntity[],
  localAuthority: LocalAuthoritativeEntity | undefined,
  controller: LocalRuntimePredictionController,
  nowMs: number,
): RenderableEntity[] => {
  if (localAuthority === undefined) {
    controller.reset();
    return [...entities];
  }

  let foundLocal = false;
  const projected = entities.map((entity) => {
    if (entity.id !== localAuthority.entity.id) {
      return entity;
    }
    foundLocal = true;
    return controller.project(localAuthority, nowMs);
  });

  if (!foundLocal) {
    return [...projected, controller.project(localAuthority, nowMs)];
  }
  return projected;
};

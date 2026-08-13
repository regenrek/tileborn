import { describe, expect, it } from 'vitest';

import {
  LocalTransformPredictor,
  replayLocalTransformInputs,
  type LocalTransformReducer,
} from './local-transform-prediction.js';

interface Transform {
  readonly x: number;
  readonly y: number;
}

interface MovementInput {
  readonly dx: number;
  readonly dy: number;
}

const reducer: LocalTransformReducer<Transform, MovementInput> = (transform, input) => ({
  x: transform.x + input.dx,
  y: transform.y + input.dy,
});

describe('LocalTransformPredictor', () => {
  it('predicts local transform immediately and sequences inputs for transport', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 10, y: 20 },
      reducer,
    );

    expect(predictor.enqueue({ dx: 3, dy: 0 })).toEqual({
      sequence: 0,
      input: { dx: 3, dy: 0 },
    });
    expect(predictor.enqueue({ dx: 0, dy: -2 })).toEqual({
      sequence: 1,
      input: { dx: 0, dy: -2 },
    });

    expect(predictor.getState()).toEqual({
      authoritativeTransform: { x: 10, y: 20 },
      predictedTransform: { x: 13, y: 18 },
      acknowledgedInputSequence: -1,
      pendingInputs: [
        { sequence: 0, input: { dx: 3, dy: 0 } },
        { sequence: 1, input: { dx: 0, dy: -2 } },
      ],
    });
  });

  it('reconciles to the authoritative transform and replays only unacknowledged inputs', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 0, y: 0 },
      reducer,
    );

    predictor.enqueue({ dx: 5, dy: 0 });
    predictor.enqueue({ dx: 0, dy: 4 });
    predictor.enqueue({ dx: 1, dy: 1 });
    predictor.reconcile({ transform: { x: 4.5, y: 0.25 }, acknowledgedInputSequence: 1 });

    expect(predictor.getState()).toEqual({
      authoritativeTransform: { x: 4.5, y: 0.25 },
      predictedTransform: { x: 5.5, y: 1.25 },
      acknowledgedInputSequence: 1,
      pendingInputs: [{ sequence: 2, input: { dx: 1, dy: 1 } }],
    });
  });

  it('ignores stale acknowledgements so late snapshots cannot rewind prediction', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 0, y: 0 },
      reducer,
    );

    predictor.enqueue({ dx: 5, dy: 0 });
    predictor.enqueue({ dx: 0, dy: 4 });
    predictor.reconcile({ transform: { x: 5, y: 4 }, acknowledgedInputSequence: 1 });
    predictor.enqueue({ dx: 1, dy: 0 });
    predictor.reconcile({ transform: { x: 0, y: 0 }, acknowledgedInputSequence: 0 });

    expect(predictor.getState()).toEqual({
      authoritativeTransform: { x: 5, y: 4 },
      predictedTransform: { x: 6, y: 4 },
      acknowledgedInputSequence: 1,
      pendingInputs: [{ sequence: 2, input: { dx: 1, dy: 0 } }],
    });
  });

  it('fails closed at the pending-input bound without dropping reconciliation history', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 0, y: 0 },
      reducer,
      { maxPendingInputs: 2 },
    );

    predictor.enqueue({ dx: 1, dy: 0 });
    predictor.enqueue({ dx: 2, dy: 0 });
    expect(() => predictor.enqueue({ dx: 3, dy: 0 })).toThrow(
      'local transform prediction input buffer is full',
    );

    expect(predictor.getState().pendingInputs).toEqual([
      { sequence: 0, input: { dx: 1, dy: 0 } },
      { sequence: 1, input: { dx: 2, dy: 0 } },
    ]);
    expect(predictor.getState().predictedTransform).toEqual({ x: 3, y: 0 });

    predictor.reconcile({ transform: { x: 1, y: 0 }, acknowledgedInputSequence: 0 });
    expect(predictor.enqueue({ dx: 3, dy: 0 })).toEqual({
      sequence: 2,
      input: { dx: 3, dy: 0 },
    });
    expect(predictor.getState().predictedTransform).toEqual({ x: 6, y: 0 });
  });

  it('accepts an authoritative baseline that acknowledges no local input', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 0, y: 0 },
      reducer,
    );
    predictor.enqueue({ dx: 2, dy: 1 });

    predictor.reconcile({ transform: { x: 10, y: 5 }, acknowledgedInputSequence: -1 });

    expect(predictor.getState()).toEqual({
      authoritativeTransform: { x: 10, y: 5 },
      predictedTransform: { x: 12, y: 6 },
      acknowledgedInputSequence: -1,
      pendingInputs: [{ sequence: 0, input: { dx: 2, dy: 1 } }],
    });
  });

  it('advances render simulation without adding transport reconciliation history', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 0, y: 0 },
      reducer,
      { maxPendingInputs: 1 },
    );

    for (let frame = 0; frame < 140; frame += 1) {
      predictor.advance({ dx: 1, dy: 0 });
    }

    expect(predictor.getState()).toEqual({
      authoritativeTransform: { x: 0, y: 0 },
      predictedTransform: { x: 140, y: 0 },
      acknowledgedInputSequence: -1,
      pendingInputs: [],
    });
  });

  it('coalesces repeated simulation for one transport sequence', () => {
    const predictor = new LocalTransformPredictor<Transform, MovementInput>(
      { x: 0, y: 0 },
      reducer,
      { maxPendingInputs: 1 },
    );

    for (let frame = 1; frame <= 140; frame += 1) {
      predictor.upsertPending({ dx: frame, dy: 0 }, 7);
    }

    expect(predictor.getState().pendingInputs).toEqual([
      { sequence: 7, input: { dx: 140, dy: 0 } },
    ]);
    expect(predictor.getState().predictedTransform).toEqual({ x: 140, y: 0 });
  });
});

describe('replayLocalTransformInputs', () => {
  it('reuses the same reducer for stateless authoritative replay', () => {
    expect(
      replayLocalTransformInputs(
        { x: 100, y: 50 },
        [
          { sequence: 2, input: { dx: -10, dy: 0 } },
          { sequence: 3, input: { dx: 0, dy: 5 } },
        ],
        reducer,
      ),
    ).toEqual({ x: 90, y: 55 });
  });
});

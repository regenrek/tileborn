import { Effect } from 'effect';

import { SimulationInputError } from '../errors.js';

/**
 * Simulation tick event for the v0.1.0 TypeScript backend.
 * Matches the runtime plugin-host tick hook shape: tick index + delta seconds.
 */
export interface SimulationEvent {
  readonly kind: 'tick';
  readonly tick: number;
  readonly deltaSeconds: number;
}

export interface SimulationTickRequest {
  readonly tick: number;
  readonly deltaSeconds: number;
}

export const runSimulationTick = (
  request: SimulationTickRequest,
): Effect.Effect<readonly SimulationEvent[], SimulationInputError> =>
  Effect.gen(function* () {
    if (!Number.isInteger(request.tick) || request.tick < 0) {
      return yield* Effect.fail(
        new SimulationInputError({ message: 'tick must be a non-negative integer' }),
      );
    }
    if (!Number.isFinite(request.deltaSeconds) || request.deltaSeconds < 0) {
      return yield* Effect.fail(
        new SimulationInputError({ message: 'deltaSeconds must be a finite non-negative number' }),
      );
    }
    return [
      {
        kind: 'tick',
        tick: request.tick,
        deltaSeconds: request.deltaSeconds,
      },
    ];
  });

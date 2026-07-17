import { Effect, Option } from 'effect';

import { IpcHandlerThrewError } from '@tileborne/ipc-contracts';

export const ipcCatchAll =
  (channel: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, IpcHandlerThrewError, R> =>
    effect.pipe(
      Effect.mapError(
        (error) =>
          new IpcHandlerThrewError({
            channel: channel as IpcHandlerThrewError['channel'],
            message: error instanceof Error ? error.message : String(error),
            cause: Option.some(String(error)),
          }),
      ),
    );

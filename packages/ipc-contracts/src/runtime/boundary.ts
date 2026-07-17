import { Effect, Option, Schema } from 'effect';

import { IpcChannel } from '../channel.js';
import type { AnyIpcContract, ErrorOf, ResponseOf } from '../contract.js';
import { IpcContractError, IpcDecodeError } from '../errors.js';

export const formatSchemaError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const decodeUnknown = <A>(schema: Schema.Top, input: unknown): Effect.Effect<A, unknown> =>
  Schema.decodeUnknownEffect(schema)(input) as Effect.Effect<A, unknown>;

export const encodeUnknown = (
  schema: Schema.Top,
  input: unknown,
): Effect.Effect<unknown, unknown> =>
  Schema.encodeUnknownEffect(schema)(input) as Effect.Effect<unknown, unknown>;

export const toIpcChannelOption = (channel: string): Option.Option<IpcChannel> =>
  Schema.decodeUnknownOption(IpcChannel)(channel);

export const toIpcContractError = (error: unknown): IpcContractError => {
  if (error instanceof IpcContractError) {
    return error;
  }
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    const tagged = error as { readonly _tag: string; readonly message?: string };
    return new IpcContractError(tagged);
  }
  return new IpcContractError({
    _tag: 'IpcContractError',
    message: formatSchemaError(error),
  });
};

export const decodeResponseOrError = <Contract extends AnyIpcContract>(
  contract: Contract,
  raw: unknown,
): Effect.Effect<ResponseOf<Contract>, ErrorOf<Contract> | IpcDecodeError | IpcContractError> =>
  decodeUnknown<ResponseOf<Contract>>(contract.response, raw).pipe(
    Effect.matchEffect({
      onSuccess: Effect.succeed,
      onFailure: (responseError) =>
        decodeUnknown<ErrorOf<Contract>>(contract.errors, raw).pipe(
          Effect.matchEffect({
            onSuccess: (error) => Effect.fail(toIpcContractError(error)),
            onFailure: () =>
              Effect.fail(
                new IpcDecodeError({
                  channel: Option.some(contract.channel),
                  message: `Invalid IPC response for ${contract.channel}`,
                  issues: [formatSchemaError(responseError)],
                }),
              ),
          }),
        ),
    }),
  );

export const decodeEventPayload = <A>(
  schema: Schema.Top,
  channel: string,
  raw: unknown,
): Effect.Effect<A, IpcDecodeError> =>
  decodeUnknown<A>(schema, raw).pipe(
    Effect.mapError(
      (error) =>
        new IpcDecodeError({
          channel: toIpcChannelOption(channel),
          message: `Invalid IPC event payload for ${channel}`,
          issues: [formatSchemaError(error)],
        }),
    ),
  );

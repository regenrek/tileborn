import { Effect, Option } from 'effect';

import type { IpcClientOf } from '../codegen-shape.js';
import type { AnyIpcContract, RequestOf } from '../contract.js';
import { IpcTimeoutError, IpcValidationError } from '../errors.js';
import type { IpcRegistry } from '../registry.js';
import {
  decodeResponseOrError,
  decodeUnknown,
  encodeUnknown,
  formatSchemaError,
} from './boundary.js';
import type { IpcClientTransport } from './transport.js';

const validationError = (contract: AnyIpcContract, error: unknown): IpcValidationError =>
  new IpcValidationError({
    channel: Option.some(contract.channel),
    message: `Invalid IPC request for ${contract.channel}`,
    issues: [formatSchemaError(error)],
  });

const encodeRequest = <Contract extends AnyIpcContract>(
  contract: Contract,
  decodedRequest: RequestOf<Contract>,
): Effect.Effect<unknown, IpcValidationError> =>
  encodeUnknown(contract.request, decodedRequest).pipe(
    Effect.catch(() =>
      decodeUnknown<RequestOf<Contract>>(contract.request, decodedRequest).pipe(
        Effect.flatMap((request) => encodeUnknown(contract.request, request)),
      ),
    ),
    Effect.mapError((error) => validationError(contract, error)),
  );

const invokeContract = <Contract extends AnyIpcContract>(
  contract: Contract,
  transport: IpcClientTransport,
  request: RequestOf<Contract>,
) => {
  const program = Effect.gen(function* () {
    const encodedRequest = yield* encodeRequest(contract, request);
    const rawResponse = yield* transport.invoke(contract.channel, encodedRequest);
    return yield* decodeResponseOrError(contract, rawResponse);
  });

  if (contract.meta?.timeoutMs === undefined) {
    return program;
  }

  const timeoutMs = contract.meta.timeoutMs;
  return program.pipe(
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          new IpcTimeoutError({
            channel: contract.channel,
            timeoutMs,
            message: `IPC request timed out after ${timeoutMs}ms`,
          }),
        ),
    }),
  );
};

export const createIpcClient = <Registry extends IpcRegistry>(
  registry: Registry,
  transport: IpcClientTransport,
): IpcClientOf<Registry> => {
  const client: Record<string, (request: unknown) => Effect.Effect<unknown, unknown, never>> = {};

  for (const contract of registry.contracts) {
    client[contract.channel] = (request: unknown) =>
      invokeContract(contract, transport, request as RequestOf<typeof contract>) as Effect.Effect<
        unknown,
        unknown,
        never
      >;
  }

  return client as IpcClientOf<Registry>;
};

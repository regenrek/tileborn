import { Effect, Option, Schema } from "effect";

import type { IpcHandlerAtChannel, IpcHandlerGroupOf, IpcHandlersOf } from "../codegen-shape.js";
import type { AnyIpcContract, ErrorOf, RequestOf, ResponseOf } from "../contract.js";
import {
  IpcChannelNotFoundError,
  IpcHandlerThrewError,
  IpcSerializationError,
  IpcValidationError,
} from "../errors.js";
import type { IpcRegistry } from "../registry.js";
import type { IpcServerTransport } from "./transport.js";

export interface RegisteredHandlers {
  unregister(): void;
}

export const defineHandlers = <Registry extends IpcRegistry>(
  _registry: Registry,
  handlers: IpcHandlersOf<Registry>,
): IpcHandlersOf<Registry> => handlers;

export class HandlerBuilder<
  Registry extends IpcRegistry,
  Handlers extends Partial<IpcHandlersOf<Registry>> = Partial<IpcHandlersOf<Registry>>,
> {
  constructor(
    private readonly _registry: Registry,
    readonly handlers: Handlers = {} as Handlers,
  ) {}

  add<Channel extends keyof IpcHandlersOf<Registry> & string>(
    channel: Channel,
    handler: IpcHandlerAtChannel<Registry, Channel>,
  ): HandlerBuilder<
    Registry,
    Handlers & Record<Channel, IpcHandlerAtChannel<Registry, Channel>>
  > {
    return new HandlerBuilder(this._registry, {
      ...this.handlers,
      [channel]: handler,
    });
  }

  build(): Handlers {
    return this.handlers;
  }
}

export const handlerBuilder = <Registry extends IpcRegistry>(
  registry: Registry,
): HandlerBuilder<Registry> => new HandlerBuilder(registry);

export const defineHandlerGroup = <
  Registry extends IpcRegistry,
  const Channels extends keyof IpcHandlersOf<Registry> & string,
>(
  _registry: Registry,
  handlers: IpcHandlerGroupOf<Registry, Channels>,
): IpcHandlerGroupOf<Registry, Channels> => handlers;

const decodeUnknown = <A>(schema: Schema.Top, input: unknown): Effect.Effect<A, unknown> =>
  Schema.decodeUnknownEffect(schema)(input) as Effect.Effect<A, unknown>;

const formatSchemaError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toTransportPayload = (value: unknown): unknown => {
  if (Option.isOption(value)) {
    return Option.getOrUndefined(value);
  }
  if (Array.isArray(value)) {
    return value.map(toTransportPayload);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const payload: Record<string, unknown> = {};
  if ("_tag" in value && typeof value._tag === "string") {
    payload._tag = value._tag;
  }
  if (value instanceof Error) {
    payload.message = value.message;
  }
  let current: object | null = value;
  while (current !== null && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        continue;
      }
      if (key === "constructor" || key === "name" || key === "stack" || key.startsWith("~effect/")) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "function") {
        continue;
      }
      payload[key] = toTransportPayload((value as Record<string, unknown>)[key]);
    }
    current = Object.getPrototypeOf(current);
  }
  return payload;
};

const encodeContractError = <Contract extends AnyIpcContract>(
  contract: Contract,
  error: ErrorOf<Contract>,
): Effect.Effect<unknown> => Effect.succeed(toTransportPayload(error));

const encodeResponse = <Contract extends AnyIpcContract>(
  contract: Contract,
  response: ResponseOf<Contract>,
): Effect.Effect<unknown> =>
  Effect.try({
    try: () => {
      const codec = contract.response as Schema.Codec<
        ResponseOf<Contract>,
        unknown,
        never,
        never
      >;
      try {
        const decoded = Schema.decodeUnknownSync(codec)(response);
        return Schema.encodeSync(codec)(decoded);
      } catch {
        return Schema.encodeSync(codec)(response);
      }
    },
    catch: (schemaError) => schemaError,
  }).pipe(
    Effect.matchEffect({
      onSuccess: Effect.succeed,
      onFailure: (schemaError) =>
        encodeContractError(
          contract,
          new IpcSerializationError({
            channel: Option.some(contract.channel),
            message: `Could not encode IPC response for ${contract.channel}: ${formatSchemaError(schemaError)}`,
          }) as ErrorOf<Contract>,
        ),
    }),
  );

const invokeHandler = <Contract extends AnyIpcContract>(
  contract: Contract,
  handler: ((request: RequestOf<Contract>) => Effect.Effect<ResponseOf<Contract>, ErrorOf<Contract>>) | undefined,
  rawRequest: unknown,
): Effect.Effect<unknown> =>
  decodeUnknown<RequestOf<Contract>>(contract.request, rawRequest).pipe(
    Effect.mapError(
      (error) =>
        new IpcValidationError({
          channel: Option.some(contract.channel),
          message: `Invalid IPC request for ${contract.channel}`,
          issues: [formatSchemaError(error)],
        }) as ErrorOf<Contract>,
    ),
    Effect.flatMap((request) => {
      if (handler === undefined) {
        return Effect.fail(
          new IpcChannelNotFoundError({
            channel: contract.channel,
            message: `No IPC handler registered for ${contract.channel}`,
          }) as ErrorOf<Contract>,
        );
      }

      return Effect.try({
        try: () => handler(request as RequestOf<Contract>),
        catch: (cause) =>
          new IpcHandlerThrewError({
            channel: contract.channel,
            message: `IPC handler for ${contract.channel} threw before returning an Effect`,
            cause: Option.some(String(cause)),
          }) as ErrorOf<Contract>,
      }).pipe(Effect.flatMap((effect) => effect));
    }),
    Effect.matchEffect({
      onFailure: (error) => encodeContractError(contract, error as ErrorOf<Contract>),
      onSuccess: (response) => encodeResponse(contract, response as ResponseOf<Contract>),
    }),
    Effect.catchDefect((cause) =>
      encodeContractError(
        contract,
        new IpcHandlerThrewError({
          channel: contract.channel,
          message: `IPC handler for ${contract.channel} failed with an unchecked defect`,
          cause: Option.some(String(cause)),
        }) as ErrorOf<Contract>,
      ),
    ),
  );

export const registerIpcHandlers = <Registry extends IpcRegistry>(
  registry: Registry,
  transport: IpcServerTransport,
  handlers: IpcHandlersOf<Registry>,
): RegisteredHandlers => {
  const unregisters = registry.contracts.map((contract) => {
    const channelHandlers = handlers as Record<
      string,
      ((request: unknown) => Effect.Effect<unknown, unknown>) | undefined
    >;
    return transport.handle(contract.channel, (payload) =>
      Effect.runPromise(
        invokeHandler(
          contract,
          channelHandlers[contract.channel] as
            | ((request: RequestOf<typeof contract>) => Effect.Effect<ResponseOf<typeof contract>, ErrorOf<typeof contract>>)
            | undefined,
          payload,
        ),
      ),
    );
  });

  return {
    unregister: () => {
      for (const unregister of unregisters) {
        unregister();
      }
    },
  };
};


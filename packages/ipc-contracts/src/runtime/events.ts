import { Effect, Fiber, Schema } from "effect";
import type { ManagedRuntime } from "effect/ManagedRuntime";

import type {
  AnyIpcEvent,
  EventPayloadOf,
  IpcEventRegistry,
} from "../events-core.js";
import { decodeEventPayload } from "./boundary.js";
import type { IpcClientTransport, IpcServerTransport } from "./transport.js";

export type IpcEventEmitterOf<Registry extends IpcEventRegistry> = {
  readonly [Channel in keyof Registry["byChannel"] & string]: (
    payload: EventPayloadOf<Registry["byChannel"][Channel]>,
  ) => Effect.Effect<void>;
};

export type IpcEventSubscriberOf<Registry extends IpcEventRegistry> = {
  readonly [Channel in keyof Registry["byChannel"] & string]: (
    handler: (payload: EventPayloadOf<Registry["byChannel"][Channel]>) => void,
  ) => () => void;
};

const encodeEventPayload = <Event extends AnyIpcEvent>(
  event: Event,
  payload: EventPayloadOf<Event>,
): Effect.Effect<unknown> =>
  Schema.encodeUnknownEffect(event.payload)(payload) as Effect.Effect<unknown>;

export const createEventEmitter = <Registry extends IpcEventRegistry>(
  registry: Registry,
  transport: IpcServerTransport,
): IpcEventEmitterOf<Registry> => {
  const emitter: Record<string, (payload: unknown) => Effect.Effect<void>> = {};

  for (const event of registry.events) {
    emitter[event.channel] = (payload: unknown) =>
      encodeEventPayload(event, payload as EventPayloadOf<typeof event>).pipe(
        Effect.map((encodedPayload) => {
          transport.emit(event.channel, encodedPayload);
        }),
      );
  }

  return emitter as IpcEventEmitterOf<Registry>;
};

export const createEventSubscriber = <Registry extends IpcEventRegistry>(
  registry: Registry,
  transport: IpcClientTransport,
): IpcEventSubscriberOf<Registry> => {
  const subscriber: Record<string, (handler: (payload: unknown) => void) => () => void> = {};

  for (const event of registry.events) {
    subscriber[event.channel] = (handler) =>
      transport.subscribe(event.channel, (raw) => {
        Effect.runSync(
          decodeEventPayload<EventPayloadOf<typeof event>>(
            event.payload,
            event.channel,
            raw,
          ).pipe(Effect.map((payload) => {
            handler(payload);
          })),
        );
      });
  }

  return subscriber as IpcEventSubscriberOf<Registry>;
};

export interface RegisteredEventHandlers {
  unregister(): void;
}

export interface RegisterIpcEventsOptions<R> {
  readonly runtime: ManagedRuntime<R, unknown>;
}

export type IpcEventWiringOf<Registry extends IpcEventRegistry> = {
  readonly [Channel in keyof Registry["byChannel"] & string]: (
    emit: IpcEventEmitterOf<Registry>[Channel],
  ) => Effect.Effect<void, unknown, unknown>;
};

export const registerIpcEvents = <Registry extends IpcEventRegistry, R>(
  registry: Registry,
  transport: IpcServerTransport,
  wiring: IpcEventWiringOf<Registry>,
  options: RegisterIpcEventsOptions<R>,
): RegisteredEventHandlers => {
  const { runtime } = options;
  const emitter = createEventEmitter(registry, transport);
  const fibers: Fiber.Fiber<void, unknown>[] = [];

  for (const channel of Object.keys(wiring) as (keyof typeof wiring & string)[]) {
    const run = wiring[channel];
    const emit = emitter[channel];
    if (run === undefined || emit === undefined) {
      continue;
    }
    const fiber = runtime.runFork(run(emit) as Effect.Effect<void, never, never>);
    fibers.push(fiber);
  }

  return {
    unregister: () => {
      for (const fiber of fibers) {
        runtime.runFork(Fiber.interrupt(fiber));
      }
    },
  };
};

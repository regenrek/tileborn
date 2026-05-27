import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeProjectId, makeProjectManifest } from "@tileborne/core";

import type { IpcHandlersOf } from "./codegen-shape.js";
import { defineContract } from "./contract.js";
import { ProjectsGetContract } from "./contracts/index.js";
import { EmptyRequest, EmptyResponse } from "./contracts/common.js";
import { MainEventRegistry } from "./events.js";
import { TriggerEventPayload } from "./contracts/trigger.js";
import {
  IpcContractError,
  IpcDecodeError,
  IpcError,
  IpcPermissionDeniedError,
  IpcTimeoutError,
  IpcTransportError,
  IpcValidationError,
} from "./errors.js";
import { IpcChannel } from "./channel.js";
import { createRegistry } from "./registry.js";
import {
  createEventEmitter,
  createEventSubscriber,
  createIpcClient,
  registerIpcHandlers,
  type IpcClientTransport,
  type IpcServerTransport,
} from "./runtime/index.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const projectId = makeProjectId(UUID);

const manifest = makeProjectManifest({
  id: projectId,
  name: "Example",
});

const projectsGetRequest = { projectId };
const projectsGetResponse = Schema.decodeUnknownSync(ProjectsGetContract.response)({
  project: manifest,
});

const timeoutContract = defineContract({
  channel: "tileborne:test:timeout",
  request: EmptyRequest,
  response: EmptyResponse,
  errors: IpcError,
  meta: { timeoutMs: 5 },
});

class InMemoryIpcTransport {
  readonly handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  invokeCount = 0;
  lastPayload: unknown;
  lastResponse: unknown;

  readonly client: IpcClientTransport = {
    invoke: (channel, payload) =>
      Effect.tryPromise({
        try: async () => {
          this.invokeCount += 1;
          this.lastPayload = payload;
          const handler = this.handlers.get(channel);
          if (handler === undefined) {
            throw new IpcTransportError({
              channel: Schema.decodeUnknownOption(IpcChannel)(channel),
              message: `No handler for ${channel}`,
              cause: Option.none(),
            });
          }
          const response = await handler(payload);
          this.lastResponse = response;
          return response;
        },
        catch: (cause) =>
          cause instanceof IpcTransportError
            ? cause
            : new IpcTransportError({
                channel: Schema.decodeUnknownOption(IpcChannel)(channel),
                message: `IPC transport invocation failed for ${channel}`,
                cause: Option.some(String(cause)),
              }),
      }),
    subscribe: (channel, onPayload) => {
      const listeners = this.listeners.get(channel) ?? new Set<(payload: unknown) => void>();
      listeners.add(onPayload);
      this.listeners.set(channel, listeners);
      return () => {
        listeners.delete(onPayload);
        if (listeners.size === 0) {
          this.listeners.delete(channel);
        }
      };
    },
  };

  readonly server: IpcServerTransport = {
    handle: (channel, fn) => {
      this.handlers.set(channel, fn);
      return () => {
        this.handlers.delete(channel);
      };
    },
    emit: (channel, payload) => {
      for (const listener of this.listeners.get(channel) ?? []) {
        listener(payload);
      }
    },
  };
}

const failureOf = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: (value) => {
          throw new Error(`Expected Effect failure, got ${JSON.stringify(value)}`);
        },
      }),
    ),
  );

describe("IPC runtime adapters", () => {
  it("round-trips a projects.get request through client and handlers", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    registerIpcHandlers(registry, transport.server, {
      "tileborne:projects:get": () =>
        Effect.succeed({
          project: manifest,
        }),
    });

    const client = createIpcClient(registry, transport.client);
    const response = await Effect.runPromise(client["tileborne:projects:get"](projectsGetRequest));

    expect(response).toEqual(projectsGetResponse);
    expect(transport.invokeCount).toBe(1);
    expect(transport.lastPayload).toEqual({ projectId });
  });

  it("validates requests on the client before touching transport", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    const client = createIpcClient(registry, transport.client);
    const invokeProjectOpenUnchecked = client["tileborne:projects:get"] as (
      request: unknown,
    ) => ReturnType<(typeof client)["tileborne:projects:get"]>;

    const error = await failureOf(
      invokeProjectOpenUnchecked({
        projectId: "not-a-project-id",
      }),
    );

    expect(error).toBeInstanceOf(IpcValidationError);
    expect(transport.invokeCount).toBe(0);
  });

  it("validates raw requests on the server before calling handlers", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    let handlerCalls = 0;
    registerIpcHandlers(registry, transport.server, {
      "tileborne:projects:get": () => {
        handlerCalls += 1;
        return Effect.succeed(projectsGetResponse);
      },
    });

    const raw = await Effect.runPromise(
      transport.client.invoke("tileborne:projects:get", {
        projectId: "not-a-project-id",
      }),
    );
    const decoded = Schema.decodeUnknownSync(IpcError)(raw);

    expect(decoded).toBeInstanceOf(IpcValidationError);
    expect(handlerCalls).toBe(0);
  });

  it("surfaces malformed handler responses as contract errors", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    registerIpcHandlers(registry, transport.server, {
      "tileborne:projects:get": () =>
        Effect.succeed({ bad: true } as unknown as typeof ProjectsGetContract.response.Type),
    });
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcContractError);
    expect(error._tag).toBe("IpcSerializationError");
  });

  it("surfaces malformed raw transport responses as decode errors", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    transport.server.handle("tileborne:projects:get", async () => ({ bad: true }));
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcDecodeError);
  });

  it("decodes contract error payloads into IpcContractError", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    registerIpcHandlers(registry, transport.server, {
      "tileborne:projects:get": () =>
        Effect.fail(
          new IpcPermissionDeniedError({
            channel: ProjectsGetContract.channel,
            message: "Project picker approval required",
            reason: Option.some("project-open"),
          }),
        ),
    });
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcContractError);
    expect(error._tag).toBe("IpcPermissionDeniedError");
  });

  it("maps contract timeouts to IpcTimeoutError", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([timeoutContract] as const);
    registerIpcHandlers(registry, transport.server, {
      "tileborne:test:timeout": () => Effect.sleep("50 millis").pipe(Effect.as({})),
    });
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:test:timeout"]({}));

    expect(error).toBeInstanceOf(IpcTimeoutError);
  });

  it("propagates transport failures when no handler is bound", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcTransportError);
  });

  it("unregister removes server handlers", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    const registered = registerIpcHandlers(registry, transport.server, {
      "tileborne:projects:get": () => Effect.succeed(projectsGetResponse),
    });
    const client = createIpcClient(registry, transport.client);

    await Effect.runPromise(client["tileborne:projects:get"](projectsGetRequest));
    registered.unregister();
    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcTransportError);
  });

  it("turns synchronous handler throws into handler errors", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    const handlers = {
      "tileborne:projects:get": () => {
        throw new Error("boom");
      },
    } as unknown as IpcHandlersOf<typeof registry>;
    registerIpcHandlers(registry, transport.server, handlers);
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcContractError);
    expect(error._tag).toBe("IpcHandlerThrewError");
  });

  it("turns unchecked handler defects into handler errors", async () => {
    const transport = new InMemoryIpcTransport();
    const registry = createRegistry([ProjectsGetContract] as const);
    registerIpcHandlers(registry, transport.server, {
      "tileborne:projects:get": () =>
        Effect.sync(() => {
          throw new Error("defect");
        }),
    } as unknown as IpcHandlersOf<typeof registry>);
    const client = createIpcClient(registry, transport.client);

    const error = await failureOf(client["tileborne:projects:get"](projectsGetRequest));

    expect(error).toBeInstanceOf(IpcContractError);
    expect(error._tag).toBe("IpcHandlerThrewError");
  });

  it("emits and subscribes to trigger-only event payloads", async () => {
    const transport = new InMemoryIpcTransport();
    const emitter = createEventEmitter(MainEventRegistry, transport.server);
    const subscriber = createEventSubscriber(MainEventRegistry, transport.client);
    const received: Array<unknown> = [];
    subscriber["tileborne:projects:changed"]((payload) => received.push(payload));

    await Effect.runPromise(emitter["tileborne:projects:changed"]({}));

    expect(received).toHaveLength(1);
    expect(Schema.encodeSync(TriggerEventPayload)(received[0])).toEqual({});
  });

  it("accepts empty trigger payloads", () => {
    const transport = new InMemoryIpcTransport();
    const subscriber = createEventSubscriber(MainEventRegistry, transport.client);
    const received: Array<unknown> = [];
    subscriber["tileborne:projects:changed"]((payload) => received.push(payload));

    transport.server.emit("tileborne:projects:changed", {});

    expect(received).toEqual([{}]);
  });

  it("unsubscribe removes event listeners", async () => {
    const transport = new InMemoryIpcTransport();
    const emitter = createEventEmitter(MainEventRegistry, transport.server);
    const subscriber = createEventSubscriber(MainEventRegistry, transport.client);
    const received: Array<unknown> = [];
    const unsubscribe = subscriber["tileborne:projects:changed"]((payload) => received.push(payload));

    unsubscribe();
    await Effect.runPromise(emitter["tileborne:projects:changed"]({}));

    expect(received).toEqual([]);
    expect(transport.listeners.has("tileborne:projects:changed")).toBe(false);
  });

  it("rejects invalid event payloads at the decode boundary", () => {
    const transport = new InMemoryIpcTransport();
    const subscriber = createEventSubscriber(MainEventRegistry, transport.client);
    subscriber["tileborne:projects:changed"](() => undefined);

    expect(() => {
      transport.server.emit("tileborne:projects:changed", null);
    }).toThrow(IpcDecodeError);
  });
});


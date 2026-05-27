import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeBuildId, makeProjectId } from "@tileborne/core";

import { IpcChannel } from "./channel.js";
import {
  AssetsListPacksContract,
  BuildsListBuildsContract,
  ExportsListExportsContract,
  JobsListContract,
  MainIpcRegistry,
  MapsListContract,
  PlaytestListContract,
  PluginsListContract,
  ProjectsListContract,
  RuntimeDeployListDeploymentsContract,
  RuntimeStartLocalHostContract,
  SupportListBundlesContract,
  SystemPingContract,
} from "./contracts/index.js";
import { IpcTransportError } from "./errors.js";
import { createRegistry } from "./registry.js";
import {
  createIpcClient,
  defineHandlers,
  registerIpcHandlers,
  type IpcClientTransport,
  type IpcServerTransport,
} from "./runtime/index.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const projectId = makeProjectId(UUID);
const buildId = makeBuildId(UUID);

class InMemoryIpcTransport {
  readonly handlers = new Map<string, (payload: unknown) => Promise<unknown>>();

  readonly client: IpcClientTransport = {
    invoke: (channel, payload) =>
      Effect.tryPromise({
        try: async () => {
          const handler = this.handlers.get(channel);
          if (handler === undefined) {
            throw new IpcTransportError({
              channel: Schema.decodeUnknownOption(IpcChannel)(channel),
              message: `No handler for ${channel}`,
              cause: Option.none(),
            });
          }
          return handler(payload);
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
    subscribe: () => () => undefined,
  };

  readonly server: IpcServerTransport = {
    handle: (channel, fn) => {
      this.handlers.set(channel, fn);
      return () => {
        this.handlers.delete(channel);
      };
    },
    emit: () => undefined,
  };
}

const domainCases = [
  {
    domain: "projects",
    contract: ProjectsListContract,
    request: {},
    response: { projects: [] },
    handler: () => Effect.succeed({ projects: [] }),
  },
  {
    domain: "maps",
    contract: MapsListContract,
    request: { projectId },
    response: { maps: [] },
    handler: () => Effect.succeed({ maps: [] }),
  },
  {
    domain: "assets",
    contract: AssetsListPacksContract,
    request: {},
    response: { packs: [] },
    handler: () => Effect.succeed({ packs: [] }),
  },
  {
    domain: "plugins",
    contract: PluginsListContract,
    request: {},
    response: { plugins: [] },
    handler: () => Effect.succeed({ plugins: [] }),
  },
  {
    domain: "jobs",
    contract: JobsListContract,
    request: {},
    response: { jobs: [] },
    handler: () => Effect.succeed({ jobs: [] }),
  },
  {
    domain: "builds",
    contract: BuildsListBuildsContract,
    request: { projectId },
    response: { builds: [] },
    handler: () => Effect.succeed({ builds: [] }),
  },
  {
    domain: "exports",
    contract: ExportsListExportsContract,
    request: { buildId },
    response: { exports: [] },
    handler: () => Effect.succeed({ exports: [] }),
  },
  {
    domain: "playtest",
    contract: PlaytestListContract,
    request: {},
    response: { sessions: [] },
    handler: () => Effect.succeed({ sessions: [] }),
  },
  {
    domain: "runtime",
    contract: RuntimeStartLocalHostContract,
    request: { port: 8787 },
    response: { baseUrl: "http://127.0.0.1:8787", signingKey: "local-handoff-signing-key-32-bytes-x" },
    handler: () =>
      Effect.succeed({
        baseUrl: "http://127.0.0.1:8787",
        signingKey: "local-handoff-signing-key-32-bytes-x",
      }),
  },
  {
    domain: "runtime-deploy",
    contract: RuntimeDeployListDeploymentsContract,
    request: { buildId },
    response: { deployments: [] },
    handler: () => Effect.succeed({ deployments: [] }),
  },
  {
    domain: "support",
    contract: SupportListBundlesContract,
    request: {},
    response: { bundles: [] },
    handler: () => Effect.succeed({ bundles: [] }),
  },
  {
    domain: "system",
    contract: SystemPingContract,
    request: {},
    response: { pong: true, ts: 1_714_000_000_000 },
    handler: () => Effect.succeed({ pong: true, ts: 1_714_000_000_000 }),
  },
] as const;

describe("main IPC registry domain composition", () => {
  it.each(domainCases)(
    "$domain round-trips a representative contract through client and handlers",
    async ({ contract, request, response, handler }) => {
      expect(MainIpcRegistry.byChannel[contract.channel]).toBe(contract);

      const decodedRequest = Schema.decodeUnknownSync(contract.request)(request);
      const decodedResponse = Schema.decodeUnknownSync(contract.response)(response);

      const transport = new InMemoryIpcTransport();
      const registry = createRegistry([contract] as const);
      registerIpcHandlers(
        registry,
        transport.server,
        defineHandlers(registry, {
          [contract.channel]: handler,
        }),
      );

      const client = createIpcClient(registry, transport.client);
      const channel = contract.channel as keyof typeof client & string;
      const result = await Effect.runPromise(client[channel](decodedRequest));

      expect(result).toEqual(decodedResponse);
    },
  );
});

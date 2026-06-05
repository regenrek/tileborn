import { MainEventRegistry, MainIpcRegistry } from "@tileborne/ipc-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  buildTilebornePreloadBridge,
  MAIN_EVENT_BRIDGE_CHANNELS,
  MAIN_IPC_BRIDGE_CHANNELS,
  toPreloadEventHandlerName,
  type PreloadIpcTransport,
} from "./browser-bridge.js";

const methodNameForChannel = (channel: string): { readonly domain: string; readonly method: string } => {
  const match = /^tileborne:([a-z][a-z0-9-]*):([a-z][a-zA-Z0-9-]*)$/.exec(channel);
  if (!match) {
    throw new Error(`Unexpected test channel: ${channel}`);
  }
  const [first = "", ...rest] = match[1]!.split("-");
  return {
    domain: `${first}${rest.map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join("")}`,
    method: match[2]!,
  };
};

describe("browser-safe preload bridge", () => {
  it("keeps the preload IPC manifest in lockstep with MainIpcRegistry", () => {
    expect(MAIN_IPC_BRIDGE_CHANNELS).toEqual(
      MainIpcRegistry.contracts.map((contract) => contract.channel),
    );
  });

  it("keeps the preload event manifest in lockstep with MainEventRegistry", () => {
    expect(MAIN_EVENT_BRIDGE_CHANNELS).toEqual(
      MainEventRegistry.events.map((event) => event.channel),
    );
  });

  it("exposes one promise method per IPC channel on the typed window.tileborne surface", async () => {
    const invoke = vi.fn(async (channel: string, payload: unknown) => ({ channel, payload }));
    const transport: PreloadIpcTransport = {
      invoke,
      subscribe: () => () => undefined,
    };
    const bridge = buildTilebornePreloadBridge(transport);

    for (const channel of MAIN_IPC_BRIDGE_CHANNELS) {
      const { domain, method } = methodNameForChannel(channel);
      const domainBridge = bridge[domain as keyof typeof bridge] as Record<
        string,
        ((payload: unknown) => Promise<unknown>) | undefined
      >;

      await expect(domainBridge[method]?.({ ok: true })).resolves.toEqual({
        channel,
        payload: { ok: true },
      });
    }

    expect(invoke).toHaveBeenCalledTimes(MAIN_IPC_BRIDGE_CHANNELS.length);
  });

  it("exposes one event subscriber per main event channel", () => {
    const subscribedChannels: string[] = [];
    const transport: PreloadIpcTransport = {
      invoke: async () => undefined,
      subscribe: (channel) => {
        subscribedChannels.push(channel);
        return () => undefined;
      },
    };
    const bridge = buildTilebornePreloadBridge(transport);

    for (const channel of MAIN_EVENT_BRIDGE_CHANNELS) {
      const handlerName = toPreloadEventHandlerName(channel);
      const subscribe = bridge.events[handlerName as keyof typeof bridge.events] as
        | ((handler: (payload: unknown) => void) => () => void)
        | undefined;
      expect(subscribe).toBeTypeOf("function");
      subscribe?.(() => undefined);
    }

    expect(subscribedChannels).toEqual(MAIN_EVENT_BRIDGE_CHANNELS);
  });

  it("rejects IPC error payloads so renderer invokeIpc keeps seeing failures", async () => {
    const transport: PreloadIpcTransport = {
      invoke: async () => ({
        _tag: "IpcValidationError",
        channel: "tileborne:projects:get",
        message: "Invalid IPC request",
        issues: ["bad request"],
      }),
      subscribe: () => () => undefined,
    };
    const bridge = buildTilebornePreloadBridge(transport);

    await expect(bridge.projects.get({ projectId: "bad-project-id" as never })).rejects.toMatchObject({
      _tag: "IpcValidationError",
      message: "Invalid IPC request",
    });
  });
});

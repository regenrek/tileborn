import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { World } from "../ecs/world.js";
import { Welcome } from "../net/protocol.js";
import { makePluginHost, type RuntimePluginLogger } from "./plugin-host.js";
import type { RuntimePlugin } from "./runtime-plugin.js";

const welcome = new Welcome({
  entityId: "entity-1",
  slot: 1,
  mapWidth: 128,
  mapHeight: 64,
  snapshotHz: 20,
  seed: "seed-1",
});

describe("PluginHost", () => {
  it("registers plugins in insertion order", async () => {
    const host = makePluginHost();
    await Effect.runPromise(host.register(plugin("a")));
    await Effect.runPromise(host.register(plugin("b")));
    await expect(Effect.runPromise(host.plugins())).resolves.toEqual([plugin("a"), plugin("b")]);
  });

  it("dispatches onTick to all plugins in insertion order", async () => {
    const calls: string[] = [];
    const host = makePluginHost();
    await Effect.runPromise(host.register(plugin("a", { onTick: () => Effect.sync(() => calls.push("a")) })));
    await Effect.runPromise(host.register(plugin("b", { onTick: () => Effect.sync(() => calls.push("b")) })));
    await Effect.runPromise(host.dispatchTick(new World(), 1 / 60, 1));
    await Effect.runPromise(host.dispatchTick(new World(), 1 / 60, 2));
    expect(calls).toEqual(["a", "b", "a", "b"]);
  });

  it("continues dispatching when one plugin hook fails", async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    const logger: RuntimePluginLogger = {
      error: (_message, fields) =>
        Effect.sync(() => {
          errors.push(String(fields?.pluginId));
        }),
    };
    const host = makePluginHost({ logger });
    await Effect.runPromise(host.register(plugin("bad", { onTick: () => Effect.sync(() => { throw new Error("boom"); }) })));
    await Effect.runPromise(host.register(plugin("good", { onTick: () => Effect.sync(() => calls.push("good")) })));
    await Effect.runPromise(host.dispatchTick(new World(), 1 / 60, 1));
    expect(calls).toEqual(["good"]);
    expect(errors).toEqual(["bad"]);
  });

  it("dispatches onMessage for inbound server messages", async () => {
    const calls: string[] = [];
    const host = makePluginHost();
    await Effect.runPromise(host.register(plugin("listener", { onMessage: (message) => Effect.sync(() => calls.push(message._tag)) })));
    await Effect.runPromise(host.dispatchMessage(welcome));
    expect(calls).toEqual(["Welcome"]);
  });

  it("dispatches lifecycle hooks", async () => {
    const calls: string[] = [];
    const host = makePluginHost();
    await Effect.runPromise(
      host.register(
        plugin("lifecycle", {
          onInit: () => Effect.sync(() => calls.push("init")),
          onShutdown: () => Effect.sync(() => calls.push("shutdown")),
        }),
      ),
    );
    await Effect.runPromise(host.dispatchInit());
    await Effect.runPromise(host.dispatchShutdown());
    expect(calls).toEqual(["init", "shutdown"]);
  });

  it("loads executable runtime plugins through the configured loader", async () => {
    const host = makePluginHost({
      loader: {
        loadExecutable: (pluginId) => Effect.succeed({ default: plugin(pluginId) }),
      },
    });
    const loaded = await Effect.runPromise(host.loadAndRegister("plugin.loaded"));
    expect(loaded.id).toBe("plugin.loaded");
    await expect(Effect.runPromise(host.plugins())).resolves.toEqual([plugin("plugin.loaded")]);
  });
});

const plugin = (id: string, hooks: Partial<RuntimePlugin> = {}): RuntimePlugin => ({
  id,
  ...hooks,
});

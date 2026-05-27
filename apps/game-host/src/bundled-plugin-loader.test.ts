import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { bundledPlugin, createBundledPluginLoader } from "./bundled-plugin-loader.js";

describe("createBundledPluginLoader", () => {
  it("registers the bundled BR adapter and emits live tick snapshots", async () => {
    const frames: Uint8Array[] = [];
    let replayFrames: readonly Uint8Array[] = [];
    const loader = createBundledPluginLoader({
      emitFrame: (frame) => {
        frames.push(frame);
      },
      setReplayFrames: (frames) => {
        replayFrames = frames;
      },
      getInput: (playerId) =>
        playerId === "player-1" ? { tick: 1, seq: 1, dir: 0, shoot: false } : undefined,
    });

    const executable = await Effect.runPromise(loader.loadExecutable(bundledPlugin.id));
    const plugin = "id" in executable ? executable : executable.default;
    if (!plugin?.onInit || !plugin.onTick) {
      throw new Error("bundled plugin did not expose runtime hooks");
    }

    await Effect.runPromise(plugin.onInit({ pluginId: plugin.id }));
    await Effect.runPromise(plugin.onTick({} as never, 1 / 20, 1));

    const messages = frames.map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame));
    const welcome = messages.find((message) => message._tag === "WelcomeSnapshot");
    const delta = messages.find((message) => message._tag === "DeltaSnapshot");

    expect(welcome?._tag).toBe("WelcomeSnapshot");
    expect(delta?._tag).toBe("DeltaSnapshot");
    const replayWelcome = replayFrames
      .map((frame) => BattleRoyaleProtocol.decodeServerMessage(frame))
      .find((message) => message._tag === "WelcomeSnapshot");
    expect(replayWelcome?._tag).toBe("WelcomeSnapshot");
    if (welcome?._tag === "WelcomeSnapshot" && delta?._tag === "DeltaSnapshot") {
      expect(welcome.players).toHaveLength(2);
      const initialPlayer = welcome.players.find((player) => player.id === "player-1");
      const movedPlayer = delta.updated.find((player) => player.id === "player-1");
      expect(initialPlayer).toBeDefined();
      expect(movedPlayer).toBeDefined();
      if (replayWelcome?._tag === "WelcomeSnapshot") {
        const replayPlayer = replayWelcome.players.find((player) => player.id === "player-1");
        expect(replayWelcome.tick).toBe(1);
        expect(replayPlayer?.x).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
      expect(movedPlayer?.x._tag).toBe("Some");
      if (movedPlayer?.x._tag === "Some") {
        expect(movedPlayer.x.value).toBeGreaterThan(initialPlayer?.x ?? 0);
      }
    }
  });
});

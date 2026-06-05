import { describe, expect, it } from "vitest";

import { createRuntimeAdapter } from "./runtime-adapter.js";
import type { ArenaPluginWorld, ArenaRuntimeInput } from "./types/runtime-plugin.js";
import { ArenaSnapshot, decodeArenaServerMessage } from "./wire-codec.js";

const world: ArenaPluginWorld = {
  createEntity: () => 0,
};

const snapshotFrom = (frame: Uint8Array): ArenaSnapshot => {
  const decoded = decodeArenaServerMessage(frame);
  if (decoded._tag !== "ArenaSnapshot") {
    throw new Error(`expected ArenaSnapshot, got ${decoded._tag}`);
  }
  return decoded;
};

describe("arena runtime adapter", () => {
  it("fires the arena weapon through simulation and damages the dummy", () => {
    const frames: Uint8Array[] = [];
    const input: ArenaRuntimeInput = {
      tick: 1,
      seq: 1,
      shoot: true,
      aimDeg: 0,
    };
    const runtime = createRuntimeAdapter({
      getPlayerInput: () => input,
      msgOut: { push: (frame) => frames.push(frame) },
      setReplayFrames: (replayFrames) => frames.push(...replayFrames),
      seed: 1,
    });

    runtime.onInit?.({ pluginId: runtime.id }, world);
    runtime.onTick?.(world, 1 / 20, 1);

    const snapshot = snapshotFrom(frames.at(-1) ?? new Uint8Array());
    const dummy = snapshot.entities.find((entity) => entity.id === "dummy-1");
    const player = snapshot.entities.find((entity) => entity.id === "player-1");

    expect(player?.health).toBe(100);
    expect(dummy?.health).toBe(85);
  });
});

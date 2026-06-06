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
    expect(player?.x).toBe(0);
    expect(player?.y).toBe(0);
    expect(player?.attacking).toBe(true);
    expect(player?.attackTick).toBe(1);
    expect(dummy?.health).toBe(85);
    expect(dummy?.hitTick).toBe(1);
  });

  it("paces movement snapshots instead of emitting every tick", () => {
    const frames: Uint8Array[] = [];
    const input: ArenaRuntimeInput = {
      tick: 1,
      seq: 1,
      dir: 0,
      shoot: false,
    };
    const runtime = createRuntimeAdapter({
      getPlayerInput: () => input,
      msgOut: { push: (frame) => frames.push(frame) },
      seed: 1,
    });

    runtime.onInit?.({ pluginId: runtime.id }, world);
    runtime.onTick?.(world, 1 / 20, 1);
    runtime.onTick?.(world, 1 / 20, 2);
    runtime.onTick?.(world, 1 / 20, 3);
    runtime.onTick?.(world, 1 / 20, 4);

    const snapshot = snapshotFrom(frames.at(-1) ?? new Uint8Array());
    const player = snapshot.entities.find((entity) => entity.id === "player-1");

    expect(frames.map((frame) => snapshotFrom(frame).tick)).toEqual([0, 2, 4]);
    expect(player?.x).toBeCloseTo(8);
    expect(player?.y).toBe(0);
  });

  it("does not refresh replay frames on every idle tick", () => {
    const replayFrames: Uint8Array[][] = [];
    const runtime = createRuntimeAdapter({
      setReplayFrames: (frames) => replayFrames.push([...frames]),
      seed: 1,
    });

    runtime.onInit?.({ pluginId: runtime.id }, world);
    for (let tick = 1; tick <= 9; tick += 1) {
      runtime.onTick?.(world, 1 / 20, tick);
    }
    expect(replayFrames.map((frames) => snapshotFrom(frames[0] ?? new Uint8Array()).tick)).toEqual([0]);

    runtime.onTick?.(world, 1 / 20, 10);

    expect(replayFrames.map((frames) => snapshotFrom(frames[0] ?? new Uint8Array()).tick)).toEqual([
      0,
      10,
    ]);
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { SimulationInputError } from "../errors.js";
import { runSimulationTick } from "./sim.js";

const runTick = (request: Parameters<typeof runSimulationTick>[0]) =>
  Effect.runPromise(runSimulationTick(request));

describe("runSimulationTick", () => {
  it("returns a tick event for valid input", async () => {
    const events = await runTick({ tick: 12, deltaSeconds: 1 / 60 });
    expect(events).toEqual([
      {
        kind: "tick",
        tick: 12,
        deltaSeconds: 1 / 60,
      },
    ]);
  });

  it("rejects negative ticks", async () => {
    await expect(runTick({ tick: -1, deltaSeconds: 0.016 })).rejects.toBeInstanceOf(SimulationInputError);
  });

  it("rejects non-finite deltaSeconds", async () => {
    await expect(runTick({ tick: 0, deltaSeconds: Number.NaN })).rejects.toBeInstanceOf(SimulationInputError);
  });
});

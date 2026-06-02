import {
  AssetLibraryReference,
  PlayerModelRef,
  makeClipId,
  makePackId,
  makeProjectId,
  makeProjectManifest,
} from "@tileborne/core";
import { describe, expect, it } from "vitest";

import {
  BATTLE_ROYALE_PLAYER_MODEL_POLICY,
  applyBattleRoyalePlayerModels,
  readBattleRoyalePlayerModels,
  removeBattleRoyalePlayerModel,
  upsertBattleRoyalePlayerModel,
} from "../roster.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

const baseProject = () => makeProjectManifest({ id: makeProjectId(UUID), name: "Demo" });

const model = (id: string): PlayerModelRef =>
  new PlayerModelRef({
    id,
    label: id.toUpperCase(),
    ref: new AssetLibraryReference({
      packId: makePackId(UUID),
      kind: "sprite",
      refId: `placeable:${id}`,
      clipId: makeClipId(UUID),
    }),
    anchor: { x: 0.5, y: 1 },
  });

describe("battle-royale-player-models", () => {
  it("reads an empty roster from a fresh project", () => {
    expect(readBattleRoyalePlayerModels(baseProject())).toEqual([]);
    expect(readBattleRoyalePlayerModels(undefined)).toEqual([]);
  });

  it("persists + round-trips a roster through project settings", () => {
    const next = applyBattleRoyalePlayerModels(baseProject(), [model("hero"), model("mage")]);
    const roundTripped = readBattleRoyalePlayerModels(next);
    expect(roundTripped.map((m) => m.id)).toEqual(["hero", "mage"]);
    expect(roundTripped[0]).toBeInstanceOf(PlayerModelRef);
    expect(roundTripped[0]?.anchor).toEqual({ x: 0.5, y: 1 });
  });

  it("upserts by id and removes by id", () => {
    let project = upsertBattleRoyalePlayerModel(baseProject(), model("hero"));
    project = upsertBattleRoyalePlayerModel(project, model("mage"));
    expect(readBattleRoyalePlayerModels(project).map((m) => m.id)).toEqual(["hero", "mage"]);

    const renamed = new PlayerModelRef({ ...model("hero"), label: "Renamed" });
    project = upsertBattleRoyalePlayerModel(project, renamed);
    expect(readBattleRoyalePlayerModels(project)).toHaveLength(2);
    expect(readBattleRoyalePlayerModels(project)[0]?.label).toBe("Renamed");

    project = removeBattleRoyalePlayerModel(project, "hero");
    expect(readBattleRoyalePlayerModels(project).map((m) => m.id)).toEqual(["mage"]);
  });

  it("exposes a selectable policy that resolves the project roster", () => {
    const project = applyBattleRoyalePlayerModels(baseProject(), [model("hero")]);
    expect(BATTLE_ROYALE_PLAYER_MODEL_POLICY.mode).toBe("selectable");
    const resolved = BATTLE_ROYALE_PLAYER_MODEL_POLICY.resolveModels({
      map: undefined as never,
      project,
    });
    expect(resolved.map((m) => m.id)).toEqual(["hero"]);
  });
});

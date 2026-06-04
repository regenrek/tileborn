import { BattleRoyaleProtocol } from "@tileborne/ipc-contracts";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  createBattleRoyaleProjector,
  createBattleRoyaleRenderManifest,
  PLAYER_TEXTURE_ASSET_ID,
  PROJECTILE_TEXTURE_ASSET_ID,
} from "./battle-royale-projector.js";

describe("BattleRoyaleProjector", () => {
  it("projects merged full states deterministically without internal mutation", () => {
    const projector = createBattleRoyaleProjector();
    const playerId = BattleRoyaleProtocol.makePlayerId("player-1");
    const projectileId = BattleRoyaleProtocol.makeProjectileId("projectile-1");
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 10, y: 20, health: 100 }],
      projectiles: [
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: projectileId,
          ownerPlayerId: playerId,
          weaponSlot: 0,
          x: 12,
          y: 22,
          vx: 1,
          vy: 0,
          rotation: 0.5,
          ttlMs: 1_000,
        }),
      ],
      zone: { cx: 32, cy: 32, radius: 64 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 1050,
      removed: [],
      updated: [{ id: playerId, x: Option.some(11), y: Option.none(), health: Option.none() }],
      projectilesUpdated: [
        new BattleRoyaleProtocol.ProjectileUpdate({
          id: projectileId,
          ownerPlayerId: Option.none(),
          weaponSlot: Option.none(),
          x: Option.some(13),
          y: Option.none(),
          vx: Option.none(),
          vy: Option.none(),
          rotation: Option.some(0.75),
          ttlMs: Option.none(),
        }),
      ],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const firstFullState = projector.mergeFrame?.(undefined, welcome);
    const nextFullState = projector.mergeFrame?.(firstFullState, delta);

    expect(projector.project(nextFullState)).toEqual(projector.project(nextFullState));
    expect(projector.project(nextFullState)).toEqual([
      expect.objectContaining({
        id: "br:player:player-1",
        x: 11,
        y: 20,
        layerIndex: 10,
      }),
      expect.objectContaining({
        id: "br:projectile:projectile-1",
        x: 13,
        y: 22,
        rotation: 0.75,
        anchor: { x: 0.5, y: 0.5 },
        layerIndex: 20,
      }),
    ]);
  });

  it("resolves a per-player modelId to a renderable model with animation", () => {
    const catalog = new Map([
      [
        "model:hero",
        {
          assetId: "playermodel:hero-atlas",
          frames: [
            { assetId: "playermodel:hero-atlas", uv: { x: 0, y: 0, w: 32, h: 32 }, durationMs: 100 },
            { assetId: "playermodel:hero-atlas", uv: { x: 32, y: 0, w: 32, h: 32 }, durationMs: 100 },
          ],
          loop: true,
          defaultDurationMs: 100,
          anchor: { x: 0.5, y: 1 },
        },
      ],
    ]);
    const projector = createBattleRoyaleProjector({ catalog });
    const playerId = BattleRoyaleProtocol.makePlayerId("player-1");
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 10, y: 20, health: 100, modelId: "model:hero" }],
      projectiles: [],
      zone: { cx: 32, cy: 32, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    const [entity] = projector.project(full);
    expect(entity?.assetId).toBe("playermodel:hero-atlas");
    expect(entity?.anchor).toEqual({ x: 0.5, y: 1 });
    expect(entity?.animation?.frames).toHaveLength(2);
    expect(entity?.animation?.loop).toBe(true);
  });

  it("falls back to the default player model when modelId is unknown/absent", () => {
    const projector = createBattleRoyaleProjector({ catalog: new Map() });
    const playerId = BattleRoyaleProtocol.makePlayerId("player-1");
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 0, y: 0, health: 100 }],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    const [entity] = projector.project(full);
    expect(entity?.assetId).toBe(PLAYER_TEXTURE_ASSET_ID);
    expect(entity?.animation).toBeUndefined();
  });

  it("uses the injected playerModelIds fallback when the snapshot omits modelId", () => {
    const catalog = new Map([
      [
        "model:hero",
        {
          assetId: "playermodel:hero-atlas",
          frames: [
            { assetId: "playermodel:hero-atlas", uv: { x: 0, y: 0, w: 32, h: 32 }, durationMs: 100 },
            { assetId: "playermodel:hero-atlas", uv: { x: 32, y: 0, w: 32, h: 32 }, durationMs: 100 },
          ],
          loop: true,
        },
      ],
    ]);
    const projector = createBattleRoyaleProjector({
      catalog,
      playerModelIds: new Map([["player-1", "model:hero"]]),
    });
    const playerId = BattleRoyaleProtocol.makePlayerId("player-1");
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 0, y: 0, health: 100 }],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    const [entity] = projector.project(full);
    expect(entity?.assetId).toBe("playermodel:hero-atlas");
  });

  it("applies defaultModelId to players without an explicit selection", () => {
    const catalog = new Map([
      [
        "model:hero",
        {
          assetId: "playermodel:hero-atlas",
          frames: [
            { assetId: "playermodel:hero-atlas", uv: { x: 0, y: 0, w: 32, h: 32 }, durationMs: 100 },
            { assetId: "playermodel:hero-atlas", uv: { x: 32, y: 0, w: 32, h: 32 }, durationMs: 100 },
          ],
          loop: true,
        },
      ],
    ]);
    const projector = createBattleRoyaleProjector({ catalog, defaultModelId: "model:hero" });
    const playerId = BattleRoyaleProtocol.makePlayerId("player-1");
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 1000,
      seed: 1,
      players: [{ id: playerId, x: 0, y: 0, health: 100 }],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 64 },
    });
    const full = projector.mergeFrame?.(undefined, welcome);
    const [entity] = projector.project(full);
    expect(entity?.assetId).toBe("playermodel:hero-atlas");
    expect(entity?.animation?.frames).toHaveLength(2);
  });

  it("exposes the plugin-owned render manifest", () => {
    const projector = createBattleRoyaleProjector();

    expect(projector.getRenderManifest?.()).toEqual({
      fixedZoom: 4,
      hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(createBattleRoyaleRenderManifest()).toEqual(projector.getRenderManifest?.());
  });

  it("uses namespaced plugin-bundled asset ids", () => {
    expect(PLAYER_TEXTURE_ASSET_ID).toBe("@tileborne-plugins/battle-royale:default-pet");
    expect(PROJECTILE_TEXTURE_ASSET_ID).toBe("@tileborne-plugins/battle-royale:projectile-bolt");
  });

  it("projects three players and two projectiles into renderable entities", () => {
    const projector = createBattleRoyaleProjector();
    const players = ["player-1", "player-2", "player-3"].map(BattleRoyaleProtocol.makePlayerId);
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 10,
      serverTimestampMs: 2_000,
      seed: 1,
      players: players.map((id, index) => ({
        id,
        x: index * 10,
        y: index * 20,
        health: 100,
      })),
      projectiles: [
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: BattleRoyaleProtocol.makeProjectileId("projectile-1"),
          ownerPlayerId: players[0]!,
          weaponSlot: 1,
          x: 1,
          y: 2,
          vx: 1,
          vy: 0,
          rotation: 0,
          ttlMs: 100,
        }),
        new BattleRoyaleProtocol.ProjectileSnapshot({
          id: BattleRoyaleProtocol.makeProjectileId("projectile-2"),
          ownerPlayerId: players[1]!,
          weaponSlot: 2,
          x: 3,
          y: 4,
          vx: 0,
          vy: 1,
          rotation: 1,
          ttlMs: 100,
        }),
      ],
      zone: { cx: 0, cy: 0, radius: 100 },
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const entities = projector.project(fullState);

    expect(entities).toHaveLength(5);
    expect(entities.filter((entity) => entity.id.startsWith("br:player:"))).toHaveLength(3);
    expect(entities.filter((entity) => entity.id.startsWith("br:projectile:"))).toHaveLength(2);
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "br:player:player-1", assetId: PLAYER_TEXTURE_ASSET_ID }),
        expect.objectContaining({
          id: "br:projectile:projectile-1",
          assetId: PROJECTILE_TEXTURE_ASSET_ID,
          anchor: { x: 0.5, y: 0.5 },
        }),
      ]),
    );
  });

  it("removes players from merged full state when delta marks them removed", () => {
    const projector = createBattleRoyaleProjector();
    const player1 = BattleRoyaleProtocol.makePlayerId("player-1");
    const player2 = BattleRoyaleProtocol.makePlayerId("player-2");
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 100,
      seed: 1,
      players: [
        { id: player1, x: 0, y: 0, health: 100 },
        { id: player2, x: 10, y: 10, health: 100 },
      ],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 150,
      removed: [player2],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const fullState = projector.mergeFrame?.(undefined, welcome);
    const nextState = projector.mergeFrame?.(fullState, delta);

    expect(projector.project(nextState).map((entity) => entity.id)).toEqual(["br:player:player-1"]);
  });

  it("returns server timestamp from welcome and delta frames", () => {
    const projector = createBattleRoyaleProjector();
    const welcome = new BattleRoyaleProtocol.WelcomeSnapshot({
      tick: 1,
      serverTimestampMs: 123,
      seed: 1,
      players: [],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const delta = new BattleRoyaleProtocol.DeltaSnapshot({
      tick: 2,
      serverTimestampMs: 173,
      removed: [],
      updated: [],
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    expect(projector.getFrameTimestamp?.(welcome)).toBe(123);
    expect(projector.getFrameTimestamp?.(delta)).toBe(173);
  });
});

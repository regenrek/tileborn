import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { parseTilesetManifest } from "../../../manifest/parse.js";
import { writeTilesetManifest } from "../../../manifest/write.js";
import { anchorNameToPivot, importSpriteSheet } from "../import.js";

const baseInput = {
  imagePath: "sprites/hero.png",
  imageWidth: 128,
  imageHeight: 32,
  slice: { cellWidth: 32, cellHeight: 32, columns: 4, rows: 1 },
  spriteName: "Hero",
  packName: "Hero Pack",
} as const;

describe("importSpriteSheet", () => {
  it("slices a grid sheet into a pack with a default clip", () => {
    const result = importSpriteSheet(baseInput);

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toBeDefined();
    const pack = result.value!.pack;
    expect(pack.tilesets[0]?.tiles).toHaveLength(4);
    expect(pack.placeables).toHaveLength(1);
    const placeable = pack.placeables![0]!;
    expect(placeable.clips).toHaveLength(1);
    expect(placeable.clips![0]!.name).toBe("default");
    expect(placeable.clips![0]!.frames).toHaveLength(4);
    expect(result.value!.frameCount).toBe(4);
  });

  it("is deterministic across identical inputs", () => {
    const first = importSpriteSheet(baseInput);
    const second = importSpriteSheet(baseInput);
    expect(String(second.value!.pack.id)).toBe(String(first.value!.pack.id));
    expect(second.value!.pack.placeables![0]!.id).toBe(first.value!.pack.placeables![0]!.id);
    expect(second.value!.pack.placeables![0]!.clips![0]!.id).toBe(
      first.value!.pack.placeables![0]!.clips![0]!.id,
    );
  });

  it("materializes authored clips with per-frame durations", () => {
    const result = importSpriteSheet({
      ...baseInput,
      clips: [
        { name: "idle", frameIndices: [0, 1], loop: true, frameDurationsMs: [150, 150] },
        { name: "run", frameIndices: [2, 3], loop: false, defaultDurationMs: 80 },
      ],
    });

    const placeable = result.value!.pack.placeables![0]!;
    expect(placeable.clips!.map((clip) => clip.name)).toEqual(["idle", "run"]);
    expect(Option.getOrUndefined(placeable.clips![0]!.frames[0]!.durationMs)).toBe(150);
    expect(placeable.clips![1]!.loop).toBe(false);
    expect(placeable.clips![1]!.defaultDurationMs).toBe(80);
  });

  it("derives frames and clips from an Aseprite sidecar", () => {
    const aseprite = {
      frames: [
        { frame: { x: 0, y: 0, w: 32, h: 32 }, duration: 120 },
        { frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 120 },
        { frame: { x: 64, y: 0, w: 32, h: 32 }, duration: 90 },
      ],
      meta: {
        frameTags: [
          { name: "idle", from: 0, to: 1, direction: "forward" },
          { name: "attack", from: 2, to: 2, direction: "forward" },
        ],
      },
    };

    const result = importSpriteSheet({ ...baseInput, aseprite });
    expect(result.diagnostics).toEqual([]);
    const placeable = result.value!.pack.placeables![0]!;
    expect(placeable.clips!.map((clip) => clip.name)).toEqual(["idle", "attack"]);
    expect(placeable.clips![0]!.frames).toHaveLength(2);
    expect(Option.getOrUndefined(placeable.clips![0]!.frames[0]!.durationMs)).toBe(120);
    expect(result.value!.pack.tilesets[0]?.tiles).toHaveLength(3);
  });

  it("produces a pack that round-trips through the manifest", () => {
    const result = importSpriteSheet({
      ...baseInput,
      clips: [{ name: "idle", frameIndices: [0, 1, 2, 3], loop: true }],
    });
    const written = writeTilesetManifest(result.value!.pack, {
      provenance: result.value!.provenance,
    });
    const reparsed = parseTilesetManifest(written);

    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.value?.placeables?.[0]?.clips?.[0]?.name).toBe("idle");
    expect(reparsed.value?.placeables?.[0]).toEqual(result.value!.pack.placeables![0]);
  });

  it("defaults the placeable anchor to top-left", () => {
    const placeable = importSpriteSheet(baseInput).value!.pack.placeables![0]!;
    expect(placeable.source.properties["tileborne.anchor"]).toBe("top-left");
    expect(placeable.source.properties["tileborne.anchorX"]).toBe(0);
    expect(placeable.source.properties["tileborne.anchorY"]).toBe(0);
  });

  it("persists the chosen anchor + pivot onto the placeable", () => {
    const placeable = importSpriteSheet({ ...baseInput, anchor: "center" }).value!.pack
      .placeables![0]!;
    expect(placeable.source.properties["tileborne.anchor"]).toBe("center");
    expect(placeable.source.properties["tileborne.anchorX"]).toBe(0.5);
    expect(placeable.source.properties["tileborne.anchorY"]).toBe(0.5);
  });

  it("persists player-model geometry metadata onto the placeable", () => {
    const placeable = importSpriteSheet({
      ...baseInput,
      playerModel: {
        renderScale: 1.5,
        hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
        muzzle: { x: 0.75, y: 0.45 },
      },
    }).value!.pack.placeables![0]!;

    expect(placeable.source.properties).toMatchObject({
      "tileborne.playerModel": true,
      "tileborne.player.renderScale": 1.5,
      "tileborne.player.hitboxX": 0.25,
      "tileborne.player.hitboxY": 0.1,
      "tileborne.player.hitboxW": 0.5,
      "tileborne.player.hitboxH": 0.85,
      "tileborne.player.muzzleX": 0.75,
      "tileborne.player.muzzleY": 0.45,
    });
  });

  it("rejects player-model geometry outside normalized bounds", () => {
    const result = importSpriteSheet({
      ...baseInput,
      playerModel: {
        renderScale: 0,
        hitbox: { x: 0.8, y: 0.1, width: 0.5, height: 0.85 },
        muzzle: { x: 1.2, y: 0.45 },
      },
    });
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Player model hitbox must stay inside normalized 0..1 bounds",
      "Player model muzzle must use normalized 0..1 coordinates",
      "Player model render scale must be greater than 0 and at most 8",
    ]);
  });

  it("maps named anchors to normalized pivots", () => {
    expect(anchorNameToPivot("top-left")).toEqual({ x: 0, y: 0 });
    expect(anchorNameToPivot("center")).toEqual({ x: 0.5, y: 0.5 });
    expect(anchorNameToPivot("bottom-left")).toEqual({ x: 0, y: 1 });
  });

  it("reports a diagnostic for invalid slice config", () => {
    const result = importSpriteSheet({
      ...baseInput,
      slice: { cellWidth: 0, cellHeight: 32 },
    });
    expect(result.value).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";

import { ChunkCoord, createRect, createTileCoord, createVec2, grid } from "./index.js";

describe("geometry", () => {
  it("constructs and compares Vec2", () => {
    const a = createVec2(1, 2);
    const b = createVec2(1, 2);
    expect(a.equals(b)).toBe(true);
    expect(a.add(createVec2(2, 3)).equals(createVec2(3, 5))).toBe(true);
  });

  it("translates and intersects Rect", () => {
    const a = createRect(0, 0, 10, 10);
    const b = createRect(5, 5, 10, 10);
    expect(a.intersects(b)).toBe(true);
    expect(a.translate(15, 0).intersects(b)).toBe(false);
    expect(a.equals(createRect(0, 0, 10, 10))).toBe(true);
  });

  it("maps tile coordinates to chunk coordinates", () => {
    const tile = createTileCoord(17, 33);
    const chunk = grid.tileToChunk(tile, 16);
    expect(chunk.equals(new ChunkCoord({ x: 1, y: 2 }))).toBe(true);
    expect(grid.tileInChunk(tile, 16).equals(createTileCoord(1, 1))).toBe(true);
  });
});

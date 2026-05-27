import { describe, expect, it } from "vitest";

import { allocateAssetIds } from "./pack-id-allocator.js";

describe("asset id allocator", () => {
  it("allocates deterministic ids across runs", () => {
    const candidates = ["tiles/water.png", "tiles/grass.png", "decor/tree.png"];

    expect([...allocateAssetIds("sha256:seed", candidates).entries()]).toEqual([
      ...allocateAssetIds("sha256:seed", candidates).entries(),
    ]);
  });

  it("is independent of candidate input order", () => {
    const left = allocateAssetIds("sha256:seed", ["b.png", "a.png"]);
    const right = allocateAssetIds("sha256:seed", ["a.png", "b.png"]);

    expect([...left.entries()]).toEqual([...right.entries()]);
  });

  it("changes only the edited path allocation", () => {
    const before = allocateAssetIds("sha256:seed", ["a.png", "b.png", "c.png"]);
    const after = allocateAssetIds("sha256:seed", ["a.png", "b2.png", "c.png"]);

    expect(after.get("a.png")).toBe(before.get("a.png"));
    expect(after.get("c.png")).toBe(before.get("c.png"));
    expect(after.get("b2.png")).not.toBe(before.get("b.png"));
  });

  it("emits core-shaped asset ids", () => {
    const [id] = allocateAssetIds("sha256:seed", ["a.png"]).values();

    expect(id).toMatch(/^asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

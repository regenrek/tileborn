import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import { meadowPack } from "../../manifest/__fixtures__/fixtures.js";
import { parseTilesetManifest } from "../../manifest/parse.js";
import { TerrainClass } from "../../schemas/index.js";
import { renderTileLayout, type RenderGridCell } from "../layout-snapshot.js";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));
const decodeTerrainClass = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

const meadowPackValue = parseTilesetManifest(meadowPack).value!;

const variantTileId = tileId("1");
const staticTileId = tileId("2");

const make4x4Grid = (): RenderGridCell[] => {
  const cells: RenderGridCell[] = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      cells.push({
        x,
        y,
        tileId: (x + y) % 2 === 0 ? variantTileId : staticTileId,
        ...((x + y) % 3 === 0 ? { flipH: true } : {}),
      });
    }
  }
  return cells;
};

describe("renderTileLayout", () => {
  it("produces a stable 4x4 layout snapshot without variants", () => {
    const snapshot = renderTileLayout(meadowPackValue, make4x4Grid(), {
      mapSeed: 1337,
      layerId: "ground",
    });

    expect(snapshot).toMatchSnapshot();
  });

  it("produces a stable 4x4 layout snapshot with variant resolution", () => {
    const snapshot = renderTileLayout(meadowPackValue, make4x4Grid(), {
      mapSeed: 1337,
      layerId: "ground",
      terrainClass: decodeTerrainClass("grass"),
      useVariants: true,
    });

    expect(snapshot).toMatchSnapshot();
  });

  it("sorts cells deterministically by y then x", () => {
    const shuffled = [...make4x4Grid()].reverse();
    const snapshot = renderTileLayout(meadowPackValue, shuffled);

    const keys = snapshot.cells.map((cell) => `${cell.x},${cell.y}`);
    expect(keys).toEqual([...keys].sort((left, right) => {
      const [lx, ly] = left.split(",").map(Number);
      const [rx, ry] = right.split(",").map(Number);
      return ly === ry ? lx! - rx! : ly! - ry!;
    }));
  });

  it("is stable across repeated runs", () => {
    const grid = make4x4Grid();
    const options = {
      mapSeed: 9001,
      layerId: "terrain",
      terrainClass: decodeTerrainClass("grass"),
      useVariants: true,
    };

    const first = renderTileLayout(meadowPackValue, grid, options);
    const second = renderTileLayout(meadowPackValue, grid, options);

    expect(second).toEqual(first);
  });
});

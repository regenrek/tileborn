import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeTileId, type Uuid } from "@tileborne/core";

import { BitmaskCollisionMask, PolygonCollisionMask } from "../../schemas/collision-mask.js";
import { TerrainClass } from "../../schemas/terrain-class.js";
import {
  collisionMaskFromManifest,
  compileCollisionFromLdtkIntGridValue,
  compileCollisionFromTiledObject,
} from "../collision.js";
import { compileTileMetadata, namespaceCustomProperties } from "../metadata-compile.js";
import { validateCollisionMask } from "../validate.js";

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, "0")}` as Uuid;

const tileId = (suffix: string) => makeTileId(uuid(suffix));

const decodeTerrainClass = (value: string) => Schema.decodeUnknownSync(TerrainClass)(value);

describe("compileCollisionFromTiledObject", () => {
  it("compiles a Tiled object polygon into collision polygon edges", () => {
    const mask = compileCollisionFromTiledObject({
      id: 1,
      x: 4,
      y: 6,
      polygon: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
      ],
    });

    expect(mask?._tag).toBe("polygon");
    if (mask?._tag !== "polygon") {
      throw new Error("expected polygon collision");
    }

    expect(mask.edges).toEqual([
      { x1: 4, y1: 6, x2: 12, y2: 6 },
      { x1: 12, y1: 6, x2: 12, y2: 14 },
      { x1: 12, y1: 14, x2: 4, y2: 6 },
    ]);
    expect(mask.blocksMovement).toBe(true);
  });
});

describe("compileCollisionFromLdtkIntGridValue", () => {
  it("maps blocked IntGrid values to a full-tile collision bitmask", () => {
    const blocked = compileCollisionFromLdtkIntGridValue(
      { value: 2, identifier: "water", blocked: true },
      { width: 2, height: 2 },
    );
    const passable = compileCollisionFromLdtkIntGridValue(
      { value: 1, identifier: "grass", blocked: false },
      { width: 2, height: 2 },
    );

    expect(blocked).toEqual(new BitmaskCollisionMask({ passable: 0, blocked: 15 }));
    expect(passable).toEqual(new BitmaskCollisionMask({ passable: 15, blocked: 0 }));
  });
});

describe("collisionMaskFromManifest", () => {
  it("round-trips explicit Tileborne manifest collision masks", () => {
    const manifestMask = new BitmaskCollisionMask({ passable: 10, blocked: 5 });
    expect(collisionMaskFromManifest(manifestMask)).toBe(manifestMask);
  });
});

describe("compileTileMetadata", () => {
  it("normalizes spawn anchor entities", () => {
    const result = compileTileMetadata({
      tileId: tileId("1"),
      path: "/tiles/0",
      cellSize: { width: 16, height: 16 },
      ldtk: {
        entity: {
          identifier: "PlayerSpawn",
          kind: "spawn",
          px: [16, 16],
          size: [16, 16],
        },
      },
      tiled: {
        objectgroupObjects: [
          {
            id: 2,
            x: 8,
            y: 8,
            width: 8,
            height: 8,
            class: "character",
          },
        ],
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.value.spawnAnchors).toEqual([
      { identifier: "character", x: 8, y: 8, width: 8, height: 8 },
      { identifier: "PlayerSpawn", x: 16, y: 16, width: 16, height: 16 },
    ]);
  });

  it("derives prop/object bounds from Tiled object groups", () => {
    const result = compileTileMetadata({
      tileId: tileId("2"),
      path: "/tiles/1",
      cellSize: { width: 32, height: 32 },
      tiled: {
        objectgroupObjects: [
          { id: 1, x: 4, y: 6, width: 8, height: 10 },
          { id: 2, x: 20, y: 12, width: 6, height: 4 },
        ],
      },
    });

    expect(result.value.bounds).toEqual({
      x: 4,
      y: 6,
      width: 22,
      height: 10,
    });
  });

  it("passes namespaced custom properties through without namespace collision", () => {
    const grouped = namespaceCustomProperties({
      "tileborne.pathCost": 3,
      "gameplay.pathCost": 5,
      plain: "falls-back-to-tiled-namespace",
    });

    expect(grouped).toEqual({
      tileborne: { pathCost: 3 },
      gameplay: { pathCost: 5 },
      tiled: { plain: "falls-back-to-tiled-namespace" },
    });

    const merged = namespaceCustomProperties({
      "tileborne.pathCost": 3,
      "gameplay.pathCost": 5,
      "tileborne.note": "first",
    });
    const withDuplicateAttempt = namespaceCustomProperties({
      ...Object.fromEntries(
        Object.entries(merged).flatMap(([namespace, values]) =>
          Object.entries(values).map(([name, value]) => [`${namespace}.${name}`, value]),
        ),
      ),
      note: "duplicate-namespace-falls-back-to-tiled",
    });

    expect(withDuplicateAttempt).toEqual({
      tileborne: { pathCost: 3, note: "first" },
      gameplay: { pathCost: 5 },
      tiled: { note: "duplicate-namespace-falls-back-to-tiled" },
    });

    const result = compileTileMetadata({
      tileId: tileId("3"),
      path: "/tiles/2",
      cellSize: { width: 16, height: 16 },
      manifest: {
        customProperties: {
          "tileborne.pathCost": 3,
          "gameplay.team": 1,
        },
      },
      tags: ["tiled:gameplay.team=2"],
    });

    expect(result.value.custom).toEqual({
      tileborne: { pathCost: 3 },
      gameplay: { team: 1 },
      tiled: { "gameplay.team": "2" },
    });
  });

  it("snapshots a full compiled per-tile metadata block", () => {
    const result = compileTileMetadata({
      tileId: tileId("4"),
      path: "/tiles/3",
      cellSize: { width: 32, height: 32 },
      terrainClass: decodeTerrainClass("grass"),
      manifest: {
        collisionMask: new BitmaskCollisionMask({ passable: 15, blocked: 0 }),
        customProperties: {
          "tileborne.pathCost": 2,
        },
      },
      tiled: {
        properties: [{ name: "gameplay.blocked", type: "bool", value: false }],
        objectgroupObjects: [
          {
            id: 1,
            x: 0,
            y: 0,
            width: 32,
            height: 32,
          },
        ],
      },
      ldtk: {
        intGridValue: { value: 1, identifier: "grass", blocked: false },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toMatchSnapshot();
  });
});

describe("validateCollisionMask", () => {
  it("returns a diagnostic for invalid collision mask size mismatch", () => {
    const diagnostics = validateCollisionMask(
      new BitmaskCollisionMask({ passable: 0, blocked: 0b111111 }),
      { width: 32, height: 32 },
      {
        tileId: String(tileId("5")),
        path: "/tiles/0/collisionMask",
        subgrid: { width: 2, height: 2 },
      },
    );

    expect(diagnostics).toEqual([
      {
        _tag: "CollisionMaskSizeMismatch",
        path: "/tiles/0/collisionMask",
        message: "Collision bitmask uses 6 bits but cell grid expects 4 cells (2x2)",
        severity: "error",
        tileId: String(tileId("5")),
        expected: 4,
        actual: 6,
      },
    ]);
  });

  it("reports polygon vertices outside tile bounds", () => {
    const diagnostics = validateCollisionMask(
      new PolygonCollisionMask({
        edges: [{ x1: 0, y1: 0, x2: 40, y2: 0 }],
        passable: false,
        blocksMovement: true,
        blocksProjectiles: true,
      }),
      { width: 32, height: 32 },
      { tileId: "tile:test", path: "/collisionMask" },
    );

    expect(diagnostics[0]?._tag).toBe("InvalidCollisionVertex");
  });
});

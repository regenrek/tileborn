import { describe, expect, it } from "vitest";

import { parseLdtkProject } from "../ldtk-parse.js";
import {
  externalLevelFile,
  externalLevelProject,
  minimalLdtkProject,
  PROJECT_PATH,
} from "./fixtures.js";

describe("parseLdtkProject", () => {
  it("compiles tileset definitions into a TilesetPack", () => {
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: minimalLdtkProject,
    });

    expect(result.pack.name).toBe("DemoWorld");
    expect(result.pack.tilesets).toHaveLength(1);
    expect(result.pack.tilesets[0]?.name).toBe("Terrain");
    expect(result.pack.tilesets[0]?.cellSize.width).toBe(16);
    expect(result.pack.tilesets[0]?.margin).toBe(1);
    expect(result.pack.tilesets[0]?.spacing).toBe(1);
    expect(result.pack.tilesets[0]?.tiles).toHaveLength(8);
    expect(result.pack.assets).toHaveLength(1);
    expect(result.pack.assets[0]?.path).toBe("terrain.png");
  });

  it("maps IntGrid values to terrain classes", () => {
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: minimalLdtkProject,
    });

    const intGridLayer = result.levels[0]?.layers.find((layer) => layer.type === "intgrid");
    expect(intGridLayer?.type).toBe("intgrid");
    if (intGridLayer?.type !== "intgrid") {
      throw new Error("expected intgrid layer");
    }

    expect(intGridLayer.intGridCsv).toEqual([1, 2, 1, 2]);
    expect(intGridLayer.values).toEqual([
      { value: 1, identifier: "grass", terrainClass: "grass" },
      { value: 2, identifier: "water", terrainClass: "water" },
    ]);
  });

  it("converts wang-style auto-layer rules into autotile rules", () => {
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: minimalLdtkProject,
    });

    const tileset = result.pack.tilesets[0];
    expect(tileset?.autotileRules).toHaveLength(1);
    expect(tileset?.autotileRules[0]?._tag).toBe("wang2edge");
    expect(tileset?.autotileRules[0]?.terrainClasses).toEqual(["grass", "water"]);
  });

  it("maps entities to spawn anchors and props", () => {
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: minimalLdtkProject,
    });

    const entitiesLayer = result.levels[0]?.layers.find((layer) => layer.type === "entities");
    expect(entitiesLayer?.type).toBe("entities");
    if (entitiesLayer?.type !== "entities") {
      throw new Error("expected entities layer");
    }

    expect(entitiesLayer.entities).toHaveLength(2);
    expect(entitiesLayer.entities[0]).toMatchObject({
      kind: "spawn",
      identifier: "PlayerSpawn",
      px: [16, 16],
    });
    expect(entitiesLayer.entities[1]).toMatchObject({
      kind: "prop",
      identifier: "Crate",
      px: [0, 0],
    });
  });

  it("records source provenance, tags, and enums", () => {
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: minimalLdtkProject,
    });

    expect(result.provenance).toEqual({
      ldtkVersion: "1.5.3",
      projectPath: PROJECT_PATH,
      projectIid: "proj-iid-1",
      identifier: "DemoWorld",
    });
    expect(result.projectTags).toEqual(["outdoor"]);
    expect(result.enums).toEqual([
      {
        identifier: "Biome",
        uid: 10,
        values: [{ id: "Grass", tileIds: [1] }],
      },
    ]);
  });

  it("resolves external level files through an injected reader", () => {
    const files = new Map<string, string>([
      ["levels/ExternalLevel.ldtkl", JSON.stringify(externalLevelFile)],
    ]);

    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: externalLevelProject,
      readFile: (relativePath) => {
        const text = files.get(relativePath);
        return text === undefined
          ? { ok: false, reason: `missing ${relativePath}` }
          : { ok: true, text };
      },
    });

    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.identifier).toBe("ExternalLevel");
    const tilesLayer = result.levels[0]?.layers.find((layer) => layer.type === "tiles");
    expect(tilesLayer?.type).toBe("tiles");
    if (tilesLayer?.type !== "tiles") {
      throw new Error("expected tiles layer");
    }
    expect(tilesLayer.cells).toHaveLength(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic._tag === "LdtkExternalLevelMissing")).toBe(
      false,
    );
  });

  it("blocks external level path traversal with LdtkExternalRefBlocked", () => {
    const traversalProject = {
      ...externalLevelProject,
      levels: [
        {
          ...externalLevelProject.levels[0],
          externalRelPath: "../outside/Secret.ldtkl",
        },
      ],
    };

    let readCount = 0;
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: traversalProject,
      readFile: () => {
        readCount += 1;
        return { ok: true, text: JSON.stringify(externalLevelFile) };
      },
    });

    expect(result.levels).toHaveLength(0);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "LdtkExternalRefBlocked",
          externalRelPath: "../outside/Secret.ldtkl",
        }),
      ]),
    );
    expect(readCount).toBe(0);
  });

  it("emits diagnostics for missing external levels and unmapped auto rules", () => {
    const missingExternal = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: externalLevelProject,
    });

    expect(missingExternal.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "LdtkExternalLevelMissing",
          externalRelPath: "levels/ExternalLevel.ldtkl",
        }),
      ]),
    );

    const unmapped = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: minimalLdtkProject,
    });

    expect(unmapped.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "LdtkUnmappedAutoRule",
          ruleUid: 2002,
          reason: "exotic-features",
        }),
      ]),
    );
  });

  it("rejects non-object project JSON", () => {
    const result = parseLdtkProject({
      projectPath: PROJECT_PATH,
      projectJson: null,
    });

    expect(result.levels).toHaveLength(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        _tag: "LdtkInvalidProject",
      }),
    ]);
  });
});

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
  RuntimeMapPackage,
  RuntimeMapPackageManifest,
  RuntimeObjectPlacement,
  makeRuntimeMapPackageId,
} from "./index.js";

const UUID = "12345678-1234-4234-8234-123456789abc";
const HASH = `sha256:${"a".repeat(64)}`;

const manifestJson = {
  packageId: `mappkg:${UUID}`,
  schemaVersion: RUNTIME_MAP_PACKAGE_SCHEMA_VERSION,
  projectId: `project:${UUID}`,
  mapId: `map:${UUID}`,
  activeMode: "@tileborne-plugins/example-mode",
  playerCapacity: 4,
  engineVersion: "0.1.0",
  createdAt: "2026-06-10T12:00:00.000Z",
  entryHashes: { map: HASH, catalog: HASH },
};

const mapJson = {
  id: `map:${UUID}`,
  schemaVersion: 1,
  size: { width: 8, height: 8 },
  tileSize: { width: 32, height: 32 },
  layers: [],
  objects: [],
  properties: { "@tileborne-plugins/example-mode": { maxPlayers: 4 } },
};

const packageJson = {
  manifest: manifestJson,
  map: mapJson,
  catalog: [
    {
      origin: { _tag: "plugin", pluginId: "@tileborne-plugins/example-mode" },
      objectType: {
        id: `gobj:${UUID}`,
        schemaVersion: 1,
        label: "Spawn Pad",
        family: "spawn",
        components: [],
        instanceDefaults: {},
      },
    },
    {
      origin: { _tag: "project" },
      objectType: {
        id: `gobj:${UUID.replace("1234567", "aaaaaaa")}`,
        schemaVersion: 1,
        label: "Custom Crate",
        family: "loot",
        components: [],
        instanceDefaults: {},
      },
    },
  ],
  placements: [
    {
      objectId: `object:${UUID}`,
      typeId: `gobj:${UUID}`,
      x: 3,
      y: 4,
      instanceProperties: { team: "alpha", weight: 1 },
    },
  ],
  settings: { "@tileborne-plugins/example-mode": { maxPlayers: 4 } },
  visuals: { playerModels: [], overlayVisuals: [], weaponVisuals: [] },
  assets: [{ path: "assets/ab/cdef.png", hash: HASH, assetId: `asset:${UUID}` }],
  modeData: { "@tileborne-plugins/example-mode": { zone: { phases: 3 } } },
};

describe("RuntimeMapPackage schema (ADR-0030)", () => {
  it("decodes and re-encodes a full package round-trip", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeMapPackage)(packageJson);
    expect(decoded.manifest.mapId).toBe(`map:${UUID}`);
    expect(decoded.catalog).toHaveLength(2);
    expect(decoded.placements[0]?.typeId).toBe(`gobj:${UUID}`);
    expect(decoded.modeData["@tileborne-plugins/example-mode"]).toEqual({
      zone: { phases: 3 },
    });

    const encoded = Schema.encodeSync(RuntimeMapPackage)(decoded);
    const twice = Schema.decodeUnknownSync(RuntimeMapPackage)(encoded);
    expect(Schema.encodeSync(RuntimeMapPackage)(twice)).toEqual(encoded);
  });

  it("tags catalog entry origins (unique ids, no-shadowing rule)", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeMapPackage)(packageJson);
    expect(decoded.catalog.map((entry) => entry.origin._tag)).toEqual(["plugin", "project"]);
  });

  it("rejects a manifest without a positive integer playerCapacity", () => {
    for (const playerCapacity of [undefined, 0, -1, 1.5]) {
      expect(() =>
        Schema.decodeUnknownSync(RuntimeMapPackageManifest)({
          ...manifestJson,
          playerCapacity,
        }),
      ).toThrow();
    }
  });

  it("placements carry no gameplay role — meaning comes from the catalog type", () => {
    const placement = Schema.decodeUnknownSync(RuntimeObjectPlacement)(
      packageJson.placements[0],
    );
    expect(Object.keys(Schema.encodeSync(RuntimeObjectPlacement)(placement)).sort()).toEqual([
      "instanceProperties",
      "objectId",
      "typeId",
      "x",
      "y",
    ]);
  });

  it("rejects a manifest with a malformed content hash", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeMapPackageManifest)({
        ...manifestJson,
        entryHashes: { map: "md5:nope" },
      }),
    ).toThrow();
  });

  it("rejects a malformed package id and accepts the maker", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeMapPackageManifest)({
        ...manifestJson,
        packageId: "mappkg:not-a-uuid",
      }),
    ).toThrow();
    expect(makeRuntimeMapPackageId(UUID)).toBe(`mappkg:${UUID}`);
  });
});

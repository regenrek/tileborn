import { gameObjectTypeIdForKey, makeCatalogId, type Uuid } from "@tileborne/core";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeGameObjectCatalog,
  mergeGameObjectCatalogs,
  type CatalogContributionInput,
} from "./catalog-registry.js";

const CATALOG_A = "0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f60" as Uuid;
const CATALOG_B = "0b1e7e6e-9c4a-4f1e-8a2b-2f1c3d4e5f61" as Uuid;

const catalogJson = (catalogUuid: Uuid, key: string) => ({
  id: makeCatalogId(catalogUuid),
  schemaVersion: 1,
  objectTypes: [
    {
      id: gameObjectTypeIdForKey(key),
      schemaVersion: 1,
      label: key,
      family: "gameplay",
      category: "gameplay",
      layerHint: "objects",
      components: [{ _tag: "spawn-point", data: {} }],
      instanceDefaults: {},
    },
  ],
  lootTables: [],
  items: [],
});

describe("decodeGameObjectCatalog", () => {
  it("decodes a valid content pack", () => {
    const result = decodeGameObjectCatalog("c1", catalogJson(CATALOG_A, "spawn-point"));
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("fails on invalid data", () => {
    const result = decodeGameObjectCatalog("c1", { id: "not-a-catalog" });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("mergeGameObjectCatalogs", () => {
  const contribution = (catalogUuid: Uuid, key: string): CatalogContributionInput => {
    const decoded = decodeGameObjectCatalog(key, catalogJson(catalogUuid, key));
    if (Result.isFailure(decoded)) {
      throw new Error("fixture failed to decode");
    }
    return { contributionId: key, catalog: decoded.success };
  };

  it("merges distinct catalogs", () => {
    const result = mergeGameObjectCatalogs([
      contribution(CATALOG_A, "spawn-point"),
      contribution(CATALOG_B, "loot-crate"),
    ]);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.objectTypes).toHaveLength(2);
      expect(result.success.byId.size).toBe(2);
    }
  });

  it("detects duplicate object-type ids across catalogs", () => {
    const result = mergeGameObjectCatalogs([
      contribution(CATALOG_A, "spawn-point"),
      contribution(CATALOG_B, "spawn-point"),
    ]);
    expect(Result.isFailure(result)).toBe(true);
  });
});

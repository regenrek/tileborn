import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeCatalogId, makeGameObjectTypeId, makeLootTableId, type Uuid } from "../ids.js";
import {
  CatalogValidationError,
  GameObjectCatalog,
  GameObjectType,
  LootSourceComponent,
  VisualRefComponent,
  gameObjectTypeIdForKey,
  validateCatalog,
} from "./index.js";

const UUID_A = "550e8400-e29b-41d4-a716-446655440000" as Uuid;
const UUID_B = "550e8400-e29b-41d4-a716-446655440001" as Uuid;

const typeWith = (
  id = makeGameObjectTypeId(UUID_A),
  components: GameObjectType["components"] = [],
): GameObjectType =>
  new GameObjectType({
    id,
    schemaVersion: 1,
    label: "Test type",
    family: "obstacle" as GameObjectType["family"],
    category: Option.none(),
    layerHint: Option.none(),
    components,
    instanceDefaults: {},
  });

describe("gameObjectTypeIdForKey", () => {
  it("is deterministic and produces a valid gobj id", () => {
    const a = gameObjectTypeIdForKey("spawn-point");
    const b = gameObjectTypeIdForKey("spawn-point");
    expect(a).toBe(b);
    expect(a).toMatch(
      /^gobj:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(gameObjectTypeIdForKey("loot-crate")).not.toBe(a);
  });
});

describe("GameObjectCatalog schema", () => {
  it("round-trips a catalog with components", () => {
    const catalog = new GameObjectCatalog({
      id: makeCatalogId(UUID_A),
      schemaVersion: 1,
      objectTypes: [
        typeWith(makeGameObjectTypeId(UUID_A), [
          new VisualRefComponent({
            placeableId: Option.none(),
            assetId: Option.none(),
            width: 32,
            height: 32,
            anchors: {},
          }),
        ]),
      ],
      lootTables: Option.none(),
      items: Option.none(),
    });
    const encoded = Schema.encodeUnknownSync(GameObjectCatalog)(catalog);
    const decoded = Schema.decodeUnknownSync(GameObjectCatalog)(encoded);
    expect(decoded.objectTypes[0]?.components[0]?._tag).toBe("visual-ref");
  });
});

describe("validateCatalog", () => {
  it("accepts a coherent catalog", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [typeWith()],
        lootTables: Option.none(),
        items: Option.none(),
      }),
    );
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("flags duplicate object type ids", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [typeWith(makeGameObjectTypeId(UUID_A)), typeWith(makeGameObjectTypeId(UUID_A))],
        lootTables: Option.none(),
        items: Option.none(),
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(CatalogValidationError);
      expect(result.failure.issues.join("\n")).toContain("duplicate object type id");
    }
  });

  it("flags an unresolved loot-table reference", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [
          typeWith(makeGameObjectTypeId(UUID_B), [
            new LootSourceComponent({
              lootTableId: Option.some(makeLootTableId(UUID_A)),
              interactionMode: "tap",
              grants: {},
            }),
          ]),
        ],
        lootTables: Option.none(),
        items: Option.none(),
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
  });

  it("resolves a loot-table reference via deps", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [
          typeWith(makeGameObjectTypeId(UUID_B), [
            new LootSourceComponent({
              lootTableId: Option.some(makeLootTableId(UUID_A)),
              interactionMode: "tap",
              grants: {},
            }),
          ]),
        ],
        lootTables: Option.none(),
        items: Option.none(),
      }),
      { resolveLootTable: () => true },
    );
    expect(Result.isSuccess(result)).toBe(true);
  });
});

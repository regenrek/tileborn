import { Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeAssetId,
  makeCatalogId,
  makeGameObjectTypeId,
  makeItemDefinitionId,
  makeLootTableId,
  makeWeaponDefinitionId,
  type Uuid,
} from "../ids.js";
import {
  CatalogValidationError,
  GameObjectCatalog,
  GameObjectType,
  ItemDefinition,
  ItemGrant,
  LootSourceComponent,
  VisualRefComponent,
  WeaponGrant,
  gameObjectTypeIdForKey,
  validateCatalog,
} from "./index.js";

const UUID_A = "550e8400-e29b-41d4-a716-446655440000" as Uuid;
const UUID_B = "550e8400-e29b-41d4-a716-446655440001" as Uuid;
const UUID_C = "550e8400-e29b-41d4-a716-446655440002" as Uuid;
const UUID_D = "550e8400-e29b-41d4-a716-446655440003" as Uuid;

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

describe("validateCatalog pickup → grant join (ADR-0023 C)", () => {
  const ITEM_ID = makeItemDefinitionId(UUID_C);
  const WEAPON_ID = makeWeaponDefinitionId(UUID_D);
  const ASSET_ID = makeAssetId(UUID_C);

  const itemDef = (
    id = ITEM_ID,
    grants: ItemDefinition["grants"] = undefined,
  ): ItemDefinition =>
    new ItemDefinition({
      id,
      label: "Test item",
      category: Option.none(),
      grants,
      data: {},
    });

  it("accepts a pickup that grants a known in-pack item id and a resolvable weapon id", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [
          typeWith(makeGameObjectTypeId(UUID_B), [
            new LootSourceComponent({
              lootTableId: Option.none(),
              interactionMode: "auto",
              grants: {},
              grantRefs: [
                new ItemGrant({ itemId: ITEM_ID }),
                new WeaponGrant({ weaponId: WEAPON_ID }),
              ],
            }),
          ]),
        ],
        lootTables: Option.none(),
        items: Option.some([itemDef()]),
      }),
      { resolveWeapon: (id) => id === WEAPON_ID },
    );
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("flags a dangling item grant id with a typed unknown-reference issue", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [
          typeWith(makeGameObjectTypeId(UUID_B), [
            new LootSourceComponent({
              lootTableId: Option.none(),
              interactionMode: "auto",
              grants: {},
              grantRefs: [new ItemGrant({ itemId: ITEM_ID })],
            }),
          ]),
        ],
        lootTables: Option.none(),
        items: Option.none(),
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(CatalogValidationError);
      expect(result.failure.issues.join("\n")).toContain("references unknown item");
      expect(result.failure.issues.join("\n")).toContain("loot-source.grantRefs.item");
    }
  });

  it("flags a dangling weapon grant id when no weapon resolver is supplied", () => {
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [
          typeWith(makeGameObjectTypeId(UUID_B), [
            new LootSourceComponent({
              lootTableId: Option.none(),
              interactionMode: "auto",
              grants: {},
              grantRefs: [new WeaponGrant({ weaponId: WEAPON_ID })],
            }),
          ]),
        ],
        lootTables: Option.none(),
        items: Option.none(),
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.issues.join("\n")).toContain("references unknown weapon");
    }
  });

  it("validates an ItemDefinition that grants a weapon id by reference", () => {
    const ok = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [],
        lootTables: Option.none(),
        items: Option.some([itemDef(ITEM_ID, new WeaponGrant({ weaponId: WEAPON_ID }))]),
      }),
      { resolveWeapon: () => true },
    );
    expect(Result.isSuccess(ok)).toBe(true);

    const dangling = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [],
        lootTables: Option.none(),
        items: Option.some([itemDef(ITEM_ID, new WeaponGrant({ weaponId: WEAPON_ID }))]),
      }),
    );
    expect(Result.isFailure(dangling)).toBe(true);
    if (Result.isFailure(dangling)) {
      expect(dangling.failure.issues.join("\n")).toContain("item.grants.weapon");
    }
  });

  it("allows the same asset to be reused as a visual-ref and on a pickup that grants a weapon", () => {
    // Asset/pickup decoupling: one AssetId backs both the world sprite (visual-ref)
    // and the pickup, while the granted weapon is a separate id. None is hard-bound.
    const result = validateCatalog(
      new GameObjectCatalog({
        id: makeCatalogId(UUID_A),
        schemaVersion: 1,
        objectTypes: [
          typeWith(makeGameObjectTypeId(UUID_B), [
            new VisualRefComponent({
              placeableId: Option.none(),
              assetId: Option.some(ASSET_ID),
              width: 32,
              height: 32,
              anchors: {},
            }),
            new LootSourceComponent({
              lootTableId: Option.none(),
              interactionMode: "tap",
              grants: {},
              grantRefs: [new WeaponGrant({ weaponId: WEAPON_ID })],
            }),
          ]),
        ],
        lootTables: Option.none(),
        items: Option.none(),
      }),
      { resolveAsset: (id) => id === ASSET_ID, resolveWeapon: (id) => id === WEAPON_ID },
    );
    expect(Result.isSuccess(result)).toBe(true);
  });
});

import { Schema } from "effect";

import { CatalogId, GameObjectTypeId, ItemDefinitionId, LootTableId } from "../ids.js";
import { JsonObject } from "../project/index.js";
import { GameObjectComponent } from "./components.js";

/**
 * Open family classification (branded string, NOT a closed enum) so that
 * plugins introduce new families without engine edits. e.g. "obstacle", "loot".
 */
export const FamilyTag = Schema.String.pipe(Schema.brand("FamilyTag"));
export type FamilyTag = typeof FamilyTag.Type;

/** Open editor-grouping category (branded string, NOT a closed enum). */
export const CategoryTag = Schema.String.pipe(Schema.brand("CategoryTag"));
export type CategoryTag = typeof CategoryTag.Type;

/**
 * A neutral, component-based object-type definition: the typed registry entry
 * that sits behind a placed `MapObject`. Carries structure + identity + static
 * authoring data only — never numeric gameplay balance.
 */
export class GameObjectType extends Schema.Class<GameObjectType>("GameObjectType")({
  id: GameObjectTypeId,
  schemaVersion: Schema.Int,
  label: Schema.String,
  family: FamilyTag,
  category: Schema.OptionFromUndefinedOr(CategoryTag),
  /** Soft hint for default editor layer placement; not authoritative ordering. */
  layerHint: Schema.OptionFromUndefinedOr(Schema.String),
  components: Schema.Array(GameObjectComponent),
  /** Per-type authoring defaults applied to `MapObject.properties` overrides. */
  instanceDefaults: JsonObject,
}) {}

/**
 * Data shape for a loot-table *definition* (content data only; no numeric
 * gameplay balance — that is owned by ADR-0018 / plugin data and referenced by
 * id). The `entries` bag is plugin-defined open data.
 */
export class LootTable extends Schema.Class<LootTable>("LootTable")({
  id: LootTableId,
  label: Schema.String,
  entries: Schema.Array(JsonObject),
}) {}

/**
 * Data shape for an item *definition* (content data only). Combat tuning numbers
 * live in ADR-0018 / plugin data and reference this by id; they are not part of
 * the catalog structure.
 */
export class ItemDefinition extends Schema.Class<ItemDefinition>("ItemDefinition")({
  id: ItemDefinitionId,
  label: Schema.String,
  category: Schema.OptionFromUndefinedOr(CategoryTag),
  data: JsonObject,
}) {}

/** A plugin-shipped (or engine-shipped) content pack of catalog definitions. */
export class GameObjectCatalog extends Schema.Class<GameObjectCatalog>("GameObjectCatalog")({
  id: CatalogId,
  schemaVersion: Schema.Int,
  objectTypes: Schema.Array(GameObjectType),
  lootTables: Schema.OptionFromUndefinedOr(Schema.Array(LootTable)),
  items: Schema.OptionFromUndefinedOr(Schema.Array(ItemDefinition)),
}) {}

export const GameObjectTypeSchema = GameObjectType;
export const GameObjectCatalogSchema = GameObjectCatalog;
export const LootTableSchema = LootTable;
export const ItemDefinitionSchema = ItemDefinition;

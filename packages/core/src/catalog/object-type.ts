import { Schema } from "effect";

import { CatalogId, GameObjectTypeId, ItemDefinitionId, LootTableId } from "../ids.js";
import { AuthoringFieldSchema } from "../authoring/field-schema.js";
import { JsonObject } from "../project/index.js";
import { GameObjectComponent, GrantRef, OpenTag } from "./components.js";

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
 *
 * Catalog Option fields use `OptionFromOptional` (missing key ⇄ `Option.none`)
 * so authored types survive JSON persistence (project fragment, exported
 * packs, the entity-editor wire) without requiring placeholder values.
 */
export class GameObjectType extends Schema.Class<GameObjectType>("GameObjectType")({
  id: GameObjectTypeId,
  schemaVersion: Schema.Int,
  label: Schema.String,
  family: FamilyTag,
  category: Schema.OptionFromOptional(CategoryTag),
  /** Soft hint for default editor layer placement; not authoritative ordering. */
  layerHint: Schema.OptionFromOptional(Schema.String),
  components: Schema.Array(GameObjectComponent),
  /** Validated, schema-driven per-instance properties rendered by the generic editor. */
  instanceFields: Schema.optional(Schema.Array(AuthoringFieldSchema)),
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
 *
 * `equippableSlot` (open tag, ADR-0023 C) names the slot this item occupies when
 * equipped; it stays an open branded string so plugins introduce slots without
 * engine edits. `grants` is the optional typed join for an item that, when
 * collected/equipped, confers another item or a weapon *by id* (e.g. a holster
 * item that grants a weapon). The render identity stays decoupled via the
 * owning object-type's {@link VisualRefComponent}.
 */
export class ItemDefinition extends Schema.Class<ItemDefinition>("ItemDefinition")({
  id: ItemDefinitionId,
  label: Schema.String,
  category: Schema.OptionFromOptional(CategoryTag),
  equippableSlot: Schema.optional(OpenTag),
  grants: Schema.optional(GrantRef),
  data: JsonObject,
}) {}

/** A plugin-shipped (or engine-shipped) content pack of catalog definitions. */
export class GameObjectCatalog extends Schema.Class<GameObjectCatalog>("GameObjectCatalog")({
  id: CatalogId,
  schemaVersion: Schema.Int,
  objectTypes: Schema.Array(GameObjectType),
  lootTables: Schema.OptionFromOptional(Schema.Array(LootTable)),
  items: Schema.OptionFromOptional(Schema.Array(ItemDefinition)),
}) {}

/**
 * Project manifest `settings` key under which the project-authored catalog
 * content document is persisted (ADR-0025 D4). Legacy values are serialized
 * {@link GameObjectCatalog}s; current values compose that canonical catalog
 * with simulation-owned weapon entries and immutable provenance. The key stays
 * stable so editor, playtest and ship build read the SAME source.
 */
export const PROJECT_CATALOG_FRAGMENT_SETTINGS_KEY = "tileborne:catalogFragment";

export const GameObjectTypeSchema = GameObjectType;
export const GameObjectCatalogSchema = GameObjectCatalog;
export const LootTableSchema = LootTable;
export const ItemDefinitionSchema = ItemDefinition;

import { Schema } from "effect";

import { AssetId, ItemDefinitionId, LootTableId, PlaceableId, WeaponDefinitionId } from "../ids.js";
import { JsonObject } from "../project/index.js";

/**
 * Open classification tag (branded string, NOT a closed literal union) so that
 * plugins extend object semantics without engine edits.
 */
export const OpenTag = Schema.String.pipe(Schema.brand("CatalogOpenTag"));
export type OpenTag = typeof OpenTag.Type;

/** A 2D anchor point in object-local pixel space (e.g. "hand", "muzzle"). */
export class Anchor2D extends Schema.Class<Anchor2D>("Anchor2D")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

/**
 * One rectangular part of a collision footprint, in object-local tile/pixel
 * units. Pure geometry + neutral blocking flags; carries no numeric balance.
 */
export class CollisionFootprintPart extends Schema.Class<CollisionFootprintPart>(
  "CollisionFootprintPart",
)({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  blocksMovement: Schema.Boolean,
  blocksProjectiles: Schema.Boolean,
  blocksVision: Schema.Boolean,
}) {}

/** How the footprint was authored. */
export const CollisionFootprintSource = Schema.Literals(["manual", "tiled", "generated"]);
export type CollisionFootprintSource = typeof CollisionFootprintSource.Type;

/** Where the object sits in the collision/physics world. */
export class CollisionFootprintComponent extends Schema.TaggedClass<CollisionFootprintComponent>()(
  "collision-footprint",
  {
    source: CollisionFootprintSource,
    reviewed: Schema.Boolean,
    parts: Schema.Array(CollisionFootprintPart),
  },
) {}

/**
 * Binds gameplay semantics to a render identity (sdk-tileset Placeable /
 * AssetId). Holds no frames/clips — those stay with the Placeable.
 */
export class VisualRefComponent extends Schema.TaggedClass<VisualRefComponent>()("visual-ref", {
  placeableId: Schema.OptionFromUndefinedOr(PlaceableId),
  assetId: Schema.OptionFromUndefinedOr(AssetId),
  width: Schema.Number,
  height: Schema.Number,
  anchors: Schema.Record(Schema.String, Anchor2D),
}) {}

/** A spawn location marker (player start, POI, …). */
export class SpawnPointComponent extends Schema.TaggedClass<SpawnPointComponent>()("spawn-point", {
  data: JsonObject,
}) {}

/**
 * A pickup grant that references an {@link ItemDefinitionId} *by id* — never an
 * embedded item. The referenced definition is a `catalog.items` entry (or
 * resolves via an injected cross-pack resolver at validation time).
 */
export class ItemGrant extends Schema.TaggedClass<ItemGrant>()("item-grant", {
  itemId: ItemDefinitionId,
}) {}

/**
 * A pickup grant that references a {@link WeaponDefinitionId} *by id* — never an
 * embedded weapon. The weapon definition itself (firing structure + plugin
 * balance data) is owned by ADR-0018 weapon content and resolved by id at
 * validation time; the catalog only carries the reference.
 */
export class WeaponGrant extends Schema.TaggedClass<WeaponGrant>()("weapon-grant", {
  weaponId: WeaponDefinitionId,
}) {}

/**
 * The typed "pickup grants `<id>`" reference (ADR-0023 section C): what an
 * object/item confers on collection, always *by id* (item or weapon), never an
 * inline definition. The render identity is referenced independently through
 * {@link VisualRefComponent}, so the same asset is reusable as a plain sprite,
 * an equipped weapon visual, and a world pickup with no gameplay role hard-bound
 * to it. Runtime grant application (and any balance numbers) belong to ADR-0018
 * / the inventory-loot runtime, not the catalog structure.
 */
export const GrantRef = Schema.Union([ItemGrant, WeaponGrant]);
export type GrantRef = ItemGrant | WeaponGrant;

/** How a loot source is collected. */
export const LootInteractionMode = Schema.Literals(["auto", "tap", "hold"]);
export type LootInteractionMode = typeof LootInteractionMode.Type;

/**
 * An object that grants loot when interacted with.
 *
 * `grantRefs` is the first-class, typed pickup → item/weapon join (ADR-0023 C):
 * each entry references what collecting the pickup grants, *by id*. `grants`
 * remains the open per-instance authoring toggle bag and carries no id refs.
 */
export class LootSourceComponent extends Schema.TaggedClass<LootSourceComponent>()("loot-source", {
  lootTableId: Schema.OptionFromUndefinedOr(LootTableId),
  interactionMode: LootInteractionMode,
  grants: Schema.Record(Schema.String, Schema.Boolean),
  grantRefs: Schema.optional(Schema.Array(GrantRef)),
}) {}

/** An object that can be destroyed, optionally dropping a loot table. */
export class BreakableComponent extends Schema.TaggedClass<BreakableComponent>()("breakable", {
  hp: Schema.Number,
  dropTableId: Schema.OptionFromUndefinedOr(LootTableId),
}) {}

/** A world hazard (harm zone, trap, …); shape is mode-defined. */
export class HazardComponent extends Schema.TaggedClass<HazardComponent>()("hazard", {
  data: JsonObject,
}) {}

/** An interactable object (door, switch, terminal, …). */
export class InteractableComponent extends Schema.TaggedClass<InteractableComponent>()(
  "interactable",
  {
    kind: OpenTag,
    radiusPx: Schema.Number,
    parameters: JsonObject,
  },
) {}

/** An object that can be equipped into a slot, with attach anchors. */
export class EquippableComponent extends Schema.TaggedClass<EquippableComponent>()("equippable", {
  slot: OpenTag,
  anchors: Schema.Record(Schema.String, Anchor2D),
}) {}

/**
 * The tagged-union of catalog components. Engine-closed at the structural level
 * (these variants), open at the content level via each variant's data bags and
 * open tags.
 */
export const GameObjectComponent = Schema.Union([
  CollisionFootprintComponent,
  VisualRefComponent,
  SpawnPointComponent,
  LootSourceComponent,
  BreakableComponent,
  HazardComponent,
  InteractableComponent,
  EquippableComponent,
]);
export type GameObjectComponent =
  | CollisionFootprintComponent
  | VisualRefComponent
  | SpawnPointComponent
  | LootSourceComponent
  | BreakableComponent
  | HazardComponent
  | InteractableComponent
  | EquippableComponent;

/** All component tags as a readonly tuple (for iteration / validation). */
export const GAME_OBJECT_COMPONENT_TAGS = [
  "collision-footprint",
  "visual-ref",
  "spawn-point",
  "loot-source",
  "breakable",
  "hazard",
  "interactable",
  "equippable",
] as const;

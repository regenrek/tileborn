import { Effect, Schema } from 'effect';

import {
  AttachmentAnchorMap,
  AttachmentAnchorName,
  WELL_KNOWN_ATTACHMENT_ANCHORS,
} from '../asset/anchors.js';
import { RenderProfile } from '../asset/render-profile.js';
import {
  AssetId,
  GameObjectTypeId,
  ItemDefinitionId,
  LootTableId,
  PlaceableId,
  WeaponDefinitionId,
} from '../ids.js';
import { JsonObject } from '../project/index.js';

/**
 * Open classification tag (branded string, NOT a closed literal union) so that
 * plugins extend object semantics without engine edits.
 */
export const OpenTag = Schema.String.pipe(Schema.brand('CatalogOpenTag'));
export type OpenTag = typeof OpenTag.Type;

/**
 * One rectangular part of a collision footprint, in object-local tile/pixel
 * units. Pure geometry + neutral blocking flags; carries no numeric balance.
 */
export class CollisionFootprintPart extends Schema.Class<CollisionFootprintPart>(
  'CollisionFootprintPart',
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
export const CollisionFootprintSource = Schema.Literals(['manual', 'tiled', 'generated']);
export type CollisionFootprintSource = typeof CollisionFootprintSource.Type;

/** Where the object sits in the collision/physics world. */
export class CollisionFootprintComponent extends Schema.TaggedClass<CollisionFootprintComponent>()(
  'collision-footprint',
  {
    source: CollisionFootprintSource,
    reviewed: Schema.Boolean,
    parts: Schema.Array(CollisionFootprintPart),
  },
) {}

/**
 * Binds gameplay semantics to a render identity (sdk-tileset Placeable /
 * AssetId). Holds no frames/clips — those stay with the Placeable.
 *
 * `anchors` is THE entity anchor map (ADR-0028: anchors live ONLY here;
 * normalized 0..1 sprite-local `AttachmentAnchor`s, e.g. "grip", "muzzle").
 * `renderProfile` + `rotationOffsetDeg` make the entity render-complete.
 */
export class VisualRefComponent extends Schema.TaggedClass<VisualRefComponent>()('visual-ref', {
  placeableId: Schema.OptionFromOptional(PlaceableId),
  assetId: Schema.OptionFromOptional(AssetId),
  width: Schema.Number,
  height: Schema.Number,
  anchors: AttachmentAnchorMap.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
    Schema.withConstructorDefault(Effect.succeed({})),
  ),
  renderProfile: Schema.optional(RenderProfile),
  /** Degrees to rotate the sprite when it is not authored facing right. */
  rotationOffsetDeg: Schema.optional(Schema.Number),
}) {}

/** A spawn location marker (player start, POI, …). */
export class SpawnPointComponent extends Schema.TaggedClass<SpawnPointComponent>()('spawn-point', {
  data: JsonObject,
}) {}

/**
 * A pickup grant that references an {@link ItemDefinitionId} *by id* — never an
 * embedded item. The referenced definition is a `catalog.items` entry (or
 * resolves via an injected cross-pack resolver at validation time).
 */
export class ItemGrant extends Schema.TaggedClass<ItemGrant>()('item-grant', {
  itemId: ItemDefinitionId,
}) {}

/**
 * A pickup grant that references a {@link WeaponDefinitionId} *by id* — never an
 * embedded weapon. The weapon definition itself (firing structure + plugin
 * balance data) is owned by ADR-0018 weapon content and resolved by id at
 * validation time; the catalog only carries the reference.
 */
export class WeaponGrant extends Schema.TaggedClass<WeaponGrant>()('weapon-grant', {
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
export const LootInteractionMode = Schema.Literals(['auto', 'tap', 'hold']);
export type LootInteractionMode = typeof LootInteractionMode.Type;

/**
 * An object that grants loot when interacted with.
 *
 * `grantRefs` is the first-class, typed pickup → item/weapon join (ADR-0023 C):
 * each entry references what collecting the pickup grants, *by id*. `grants`
 * remains the open per-instance authoring toggle bag and carries no id refs.
 */
export class LootSourceComponent extends Schema.TaggedClass<LootSourceComponent>()('loot-source', {
  lootTableId: Schema.OptionFromOptional(LootTableId),
  interactionMode: LootInteractionMode,
  grants: Schema.Record(Schema.String, Schema.Boolean),
  grantRefs: Schema.optional(Schema.Array(GrantRef)),
}) {}

/** An object that can be destroyed, optionally dropping a loot table. */
export class BreakableComponent extends Schema.TaggedClass<BreakableComponent>()('breakable', {
  hp: Schema.Number,
  dropTableId: Schema.OptionFromOptional(LootTableId),
}) {}

/** A world hazard (harm zone, trap, …); shape is mode-defined. */
export class HazardComponent extends Schema.TaggedClass<HazardComponent>()('hazard', {
  data: JsonObject,
}) {}

/** An interactable object (door, switch, terminal, …). */
export class InteractableComponent extends Schema.TaggedClass<InteractableComponent>()(
  'interactable',
  {
    kind: OpenTag,
    radiusPx: Schema.Number,
    parameters: JsonObject,
  },
) {}

/**
 * An object that can be equipped into a slot. `attachAnchor` NAMES the anchor
 * (in the entity's `visual-ref.anchors` map) by which the object attaches to
 * its holder — it is a reference, not a second anchor map (ADR-0028 §1).
 */
export class EquippableComponent extends Schema.TaggedClass<EquippableComponent>()('equippable', {
  slot: OpenTag,
  attachAnchor: AttachmentAnchorName.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(WELL_KNOWN_ATTACHMENT_ANCHORS.grip)),
    Schema.withConstructorDefault(Effect.succeed(WELL_KNOWN_ATTACHMENT_ANCHORS.grip)),
  ),
}) {}

/**
 * Claims a runtime-global overlay slot (e.g. "shield", "shadow", "hazard"):
 * "this entity provides the visual for overlay slot X". The entity's own
 * `visual-ref` is the render identity; slots are open tags owned by the
 * consuming game mode. Project-authored claimants take precedence over
 * plugin-shipped ones — duplicating a plugin's overlay entity into the project
 * and editing it is how users reskin a mode's default overlays.
 */
export class OverlayVisualComponent extends Schema.TaggedClass<OverlayVisualComponent>()(
  'overlay-visual',
  {
    slot: OpenTag,
  },
) {}

/**
 * The weapon identity join (ADR-0028 §4a): "this entity IS weapon X". Links
 * the entity to its ADR-0018 balance definition by id and references the
 * companion visual entities (plain entities with `visual-ref`) that render
 * the weapon's projectile, muzzle flash, impact VFX, and world pickup. VFX
 * timing lives on the referencing side. No numeric gameplay balance here.
 */
export class WeaponRefComponent extends Schema.TaggedClass<WeaponRefComponent>()('weapon-ref', {
  weaponId: WeaponDefinitionId,
  projectileEntityId: Schema.optional(GameObjectTypeId),
  muzzleFlashEntityId: Schema.optional(GameObjectTypeId),
  impactVfxEntityId: Schema.optional(GameObjectTypeId),
  pickupEntityId: Schema.optional(GameObjectTypeId),
  muzzleFlashDurationMs: Schema.optional(Schema.Number),
  impactVfxDurationMs: Schema.optional(Schema.Number),
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
  OverlayVisualComponent,
  WeaponRefComponent,
]);
export type GameObjectComponent =
  | CollisionFootprintComponent
  | VisualRefComponent
  | SpawnPointComponent
  | LootSourceComponent
  | BreakableComponent
  | HazardComponent
  | InteractableComponent
  | EquippableComponent
  | OverlayVisualComponent
  | WeaponRefComponent;

/** All component tags as a readonly tuple (for iteration / validation). */
export const GAME_OBJECT_COMPONENT_TAGS = [
  'collision-footprint',
  'visual-ref',
  'spawn-point',
  'loot-source',
  'breakable',
  'hazard',
  'interactable',
  'equippable',
  'overlay-visual',
  'weapon-ref',
] as const;

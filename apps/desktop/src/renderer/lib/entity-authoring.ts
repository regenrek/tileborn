import {
  AttachmentAnchor,
  BreakableComponent,
  CollisionFootprintComponent,
  EquippableComponent,
  GameObjectType,
  type GameObjectComponent,
  HazardComponent,
  InteractableComponent,
  LootSourceComponent,
  OverlayVisualComponent,
  PlaceableId,
  SpawnPointComponent,
  VisualAnchorPoint,
  VisualRefComponent,
  WeaponRefComponent,
  makeGameObjectTypeId,
  makeWeaponDefinitionId,
  type CategoryTag,
  type FamilyTag,
  type OpenTag,
  type Uuid,
} from '@tileborne/core';
import { Option, Schema } from 'effect';

/**
 * Pure authoring helpers for the Entity Editor (ADR-0028): build, duplicate,
 * and patch project-authored `GameObjectType`s. All persistence goes through
 * `catalog:upsertType` / `catalog:removeType`; this module never talks IPC.
 */

export type ComponentTag = GameObjectComponent['_tag'];

/** Component tags the editor offers as addable capabilities, with UI labels. */
export const CAPABILITY_OPTIONS: readonly { readonly tag: ComponentTag; readonly label: string }[] =
  [
    { tag: 'visual-ref', label: 'Visual (sprite)' },
    { tag: 'collision-footprint', label: 'Collision footprint' },
    { tag: 'equippable', label: 'Equippable' },
    { tag: 'weapon-ref', label: 'Weapon' },
    { tag: 'loot-source', label: 'Loot source / pickup' },
    { tag: 'breakable', label: 'Breakable' },
    { tag: 'hazard', label: 'Hazard' },
    { tag: 'interactable', label: 'Interactable' },
    { tag: 'spawn-point', label: 'Spawn point' },
    { tag: 'overlay-visual', label: 'Overlay visual (shield / shadow / hazard)' },
  ];

export const capabilityLabel = (tag: ComponentTag): string =>
  CAPABILITY_OPTIONS.find((option) => option.tag === tag)?.label ?? tag;

const randomUuid = (): Uuid => crypto.randomUUID() as Uuid;

const asFamily = (value: string): FamilyTag => value as FamilyTag;
const asOpenTag = (value: string): OpenTag => value as OpenTag;
const asCategory = (value: string): CategoryTag => value as CategoryTag;

export interface CreateEntityInput {
  readonly label: string;
  readonly family: string;
}

/** A fresh project-authored entity: empty components, fresh `gobj:` id. */
export const createProjectEntity = (input: CreateEntityInput): GameObjectType =>
  new GameObjectType({
    id: makeGameObjectTypeId(randomUuid()),
    schemaVersion: 1,
    label: input.label,
    family: asFamily(input.family.length === 0 ? 'object' : input.family),
    category: Option.some(asCategory('custom')),
    layerHint: Option.some('objects'),
    components: [],
    instanceDefaults: {},
  });

/**
 * Copy a (typically plugin-owned, read-only) entity into an editable
 * project-authored entity with a fresh id.
 */
export const duplicateAsProjectEntity = (source: GameObjectType): GameObjectType =>
  new GameObjectType({
    id: makeGameObjectTypeId(randomUuid()),
    schemaVersion: source.schemaVersion,
    label: `${source.label} (copy)`,
    family: source.family,
    category: source.category,
    layerHint: source.layerHint,
    components: [...source.components],
    ...(source.instanceFields === undefined ? {} : { instanceFields: [...source.instanceFields] }),
    instanceDefaults: source.instanceDefaults,
  });

export const entityWithLabel = (entity: GameObjectType, label: string): GameObjectType =>
  new GameObjectType({ ...entity, label });

export const entityWithFamily = (entity: GameObjectType, family: string): GameObjectType =>
  new GameObjectType({ ...entity, family: asFamily(family) });

export const componentOf = <Tag extends ComponentTag>(
  entity: GameObjectType,
  tag: Tag,
): Extract<GameObjectComponent, { readonly _tag: Tag }> | undefined =>
  entity.components.find(
    (component): component is Extract<GameObjectComponent, { readonly _tag: Tag }> =>
      component._tag === tag,
  );

/** Replace the component with the same tag, or append when absent. */
export const entityWithComponent = (
  entity: GameObjectType,
  component: GameObjectComponent,
): GameObjectType =>
  new GameObjectType({
    ...entity,
    components: [
      ...entity.components.filter((existing) => existing._tag !== component._tag),
      component,
    ],
  });

export const entityWithoutComponent = (
  entity: GameObjectType,
  tag: ComponentTag,
): GameObjectType =>
  new GameObjectType({
    ...entity,
    components: entity.components.filter((component) => component._tag !== tag),
  });

/** A sensible empty default for each addable capability. */
export const defaultComponentForTag = (tag: ComponentTag): GameObjectComponent => {
  switch (tag) {
    case 'visual-ref':
      return new VisualRefComponent({
        placeableId: Option.none(),
        assetId: Option.none(),
        width: 48,
        height: 48,
      });
    case 'collision-footprint':
      return new CollisionFootprintComponent({ source: 'manual', reviewed: false, parts: [] });
    case 'spawn-point':
      return new SpawnPointComponent({ data: {} });
    case 'loot-source':
      return new LootSourceComponent({
        lootTableId: Option.none(),
        interactionMode: 'auto',
        grants: {},
      });
    case 'breakable':
      return new BreakableComponent({ hp: 100, dropTableId: Option.none() });
    case 'hazard':
      return new HazardComponent({ data: {} });
    case 'interactable':
      return new InteractableComponent({ kind: asOpenTag('generic'), radiusPx: 32, parameters: {} });
    case 'equippable':
      return new EquippableComponent({ slot: asOpenTag('primary') });
    case 'overlay-visual':
      return new OverlayVisualComponent({ slot: asOpenTag('shield') });
    case 'weapon-ref':
      // Fresh placeholder weapon id: the author replaces it; until then the
      // validation report carries a navigable unknown-reference issue.
      return new WeaponRefComponent({ weaponId: makeWeaponDefinitionId(randomUuid()) });
  }
};

export interface VisualRefPatch {
  readonly placeableId?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly rotationOffsetDeg?: number | undefined;
  readonly anchors?: Record<string, AttachmentAnchor> | undefined;
}

const decodePlaceableId = (value: string): Option.Option<PlaceableId> =>
  Schema.decodeUnknownOption(PlaceableId)(value);

export const visualRefWithPatch = (
  visualRef: VisualRefComponent,
  patch: VisualRefPatch,
): VisualRefComponent =>
  new VisualRefComponent({
    placeableId:
      patch.placeableId === undefined ? visualRef.placeableId : decodePlaceableId(patch.placeableId),
    assetId: visualRef.assetId,
    width: patch.width ?? visualRef.width,
    height: patch.height ?? visualRef.height,
    anchors: patch.anchors ?? visualRef.anchors,
    ...(visualRef.renderProfile === undefined ? {} : { renderProfile: visualRef.renderProfile }),
    ...((patch.rotationOffsetDeg ?? visualRef.rotationOffsetDeg) === undefined
      ? {}
      : { rotationOffsetDeg: patch.rotationOffsetDeg ?? visualRef.rotationOffsetDeg }),
  });

export interface AnchorPatch {
  readonly point?: { readonly x: number; readonly y: number } | undefined;
  readonly rotationDeg?: number | undefined;
  readonly zOffset?: number | undefined;
}

export const anchorWithPatch = (
  anchor: AttachmentAnchor | undefined,
  patch: AnchorPatch,
): AttachmentAnchor =>
  new AttachmentAnchor({
    point: new VisualAnchorPoint(patch.point ?? anchor?.point ?? { x: 0.5, y: 0.5 }),
    rotationDeg: patch.rotationDeg ?? anchor?.rotationDeg ?? 0,
    zOffset: patch.zOffset ?? anchor?.zOffset ?? 0,
  });

/** Valid anchor names are slugs (core `AttachmentAnchorName` contract). */
export const isValidAnchorName = (name: string): boolean =>
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name);

export const visualRefWithAnchor = (
  visualRef: VisualRefComponent,
  name: string,
  patch: AnchorPatch,
): VisualRefComponent =>
  visualRefWithPatch(visualRef, {
    anchors: {
      ...visualRef.anchors,
      [name]: anchorWithPatch(visualRef.anchors[name], patch),
    },
  });

export const visualRefWithoutAnchor = (
  visualRef: VisualRefComponent,
  name: string,
): VisualRefComponent => {
  const anchors = { ...visualRef.anchors };
  delete anchors[name];
  return visualRefWithPatch(visualRef, { anchors });
};

/** Serialize an entity for the `catalog:upsertType` wire (`objectTypeJson`). */
export const encodeEntity = (entity: GameObjectType): unknown =>
  JSON.parse(JSON.stringify(Schema.encodeUnknownSync(GameObjectType)(entity) ?? null));

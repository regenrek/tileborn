import {
  CollisionFootprintComponent,
  CollisionFootprintPart,
  GameObjectType,
  LootSourceComponent,
  MapObject,
  makeGameObjectTypeId,
  makeLayerId,
  makeObjectId,
  type CategoryTag,
  type FamilyTag,
} from '@tileborne/core';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY,
  findCollisionFootprint,
  footprintAllowsInstanceAdjust,
  mergeFootprintOffset,
  positionedFootprintRects,
  readFootprintOffset,
} from './catalog-collision-footprint';

const TYPE_ID = makeGameObjectTypeId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const LAYER_ID = makeLayerId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const OBJECT_ID = makeObjectId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

const part = (overrides: Partial<ConstructorParameters<typeof CollisionFootprintPart>[0]> = {}) =>
  new CollisionFootprintPart({
    x: 0,
    y: 0,
    width: 16,
    height: 16,
    blocksMovement: true,
    blocksProjectiles: false,
    blocksVision: false,
    ...overrides,
  });

const footprintComponent = (
  overrides: Partial<ConstructorParameters<typeof CollisionFootprintComponent>[0]> = {},
) =>
  new CollisionFootprintComponent({
    source: 'manual',
    reviewed: true,
    parts: [part()],
    ...overrides,
  });

const objectTypeWith = (components: GameObjectType['components']) =>
  new GameObjectType({
    id: TYPE_ID,
    schemaVersion: 1,
    label: 'Crate',
    family: 'prop' as FamilyTag,
    category: Option.some('containers' as CategoryTag),
    layerHint: Option.none(),
    components,
    instanceDefaults: {},
  });

const placedObject = (properties: MapObject['properties'] = {}) =>
  new MapObject({
    id: OBJECT_ID,
    kind: TYPE_ID,
    x: 100,
    y: 200,
    width: Option.none(),
    height: Option.none(),
    layerId: LAYER_ID,
    properties,
  });

describe('findCollisionFootprint', () => {
  it('returns the collision-footprint component when the type carries one', () => {
    const footprint = footprintComponent();
    expect(findCollisionFootprint(objectTypeWith([footprint]))).toBe(footprint);
  });

  it('returns undefined when the type carries no collision footprint', () => {
    const lootOnly = new LootSourceComponent({
      lootTableId: Option.none(),
      interactionMode: 'tap',
      grants: {},
    });
    expect(findCollisionFootprint(objectTypeWith([lootOnly]))).toBeUndefined();
  });
});

describe('footprintAllowsInstanceAdjust', () => {
  it('permits adjustment for hand-authored (manual) footprints', () => {
    expect(footprintAllowsInstanceAdjust(footprintComponent({ source: 'manual' }))).toBe(true);
  });

  it('treats machine-derived footprints as read-only', () => {
    expect(footprintAllowsInstanceAdjust(footprintComponent({ source: 'tiled' }))).toBe(false);
    expect(footprintAllowsInstanceAdjust(footprintComponent({ source: 'generated' }))).toBe(false);
  });
});

describe('readFootprintOffset / mergeFootprintOffset', () => {
  it('defaults to a zero offset for an untouched instance', () => {
    expect(readFootprintOffset(placedObject())).toEqual({ x: 0, y: 0 });
  });

  it('round-trips a persisted offset through the properties bag', () => {
    const next = mergeFootprintOffset(placedObject(), { x: 4, y: -8 });
    expect(next[COLLISION_FOOTPRINT_OFFSET_PROPERTY_KEY]).toEqual({ x: 4, y: -8 });
    expect(readFootprintOffset(placedObject(next))).toEqual({ x: 4, y: -8 });
  });

  it('does not mutate the source object properties', () => {
    const object = placedObject();
    mergeFootprintOffset(object, { x: 1, y: 1 });
    expect(object.properties).toEqual({});
  });
});

describe('positionedFootprintRects', () => {
  it('places each part into world pixel space relative to the object origin', () => {
    const rects = positionedFootprintRects(placedObject(), [
      part({ x: 2, y: 3, width: 16, height: 24 }),
    ]);
    expect(rects).toEqual([
      {
        x: 102,
        y: 203,
        width: 16,
        height: 24,
        blocksMovement: true,
        blocksProjectiles: false,
        blocksVision: false,
      },
    ]);
  });

  it('shifts the whole footprint by the per-instance offset', () => {
    const object = placedObject(mergeFootprintOffset(placedObject(), { x: 10, y: -5 }));
    const [rect] = positionedFootprintRects(object, [part({ x: 0, y: 0 })]);
    expect(rect).toMatchObject({ x: 110, y: 195 });
  });

  it('renders nothing for an object whose type carries no footprint parts', () => {
    expect(positionedFootprintRects(placedObject(), [])).toEqual([]);
  });
});

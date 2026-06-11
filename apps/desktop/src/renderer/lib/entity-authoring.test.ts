import { GameObjectType, VisualRefComponent } from '@tileborne/core';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_OPTIONS,
  componentOf,
  createProjectEntity,
  defaultComponentForTag,
  duplicateAsProjectEntity,
  encodeEntity,
  entityWithComponent,
  entityWithoutComponent,
  isValidAnchorName,
  visualRefWithAnchor,
  visualRefWithPatch,
  visualRefWithoutAnchor,
} from './entity-authoring';

describe('entity-authoring', () => {
  it('creates a fresh project entity with a gobj id and empty components', () => {
    const entity = createProjectEntity({ label: 'Crate', family: 'obstacle' });
    expect(String(entity.id)).toMatch(/^gobj:[0-9a-f-]{36}$/);
    expect(entity.label).toBe('Crate');
    expect(String(entity.family)).toBe('obstacle');
    expect(entity.components).toHaveLength(0);
  });

  it('duplicates an entity with a fresh id and copy label', () => {
    const source = createProjectEntity({ label: 'Plugin Tree', family: 'obstacle' });
    const withVisual = entityWithComponent(source, defaultComponentForTag('visual-ref'));
    const copy = duplicateAsProjectEntity(withVisual);
    expect(copy.id).not.toBe(withVisual.id);
    expect(copy.label).toBe('Plugin Tree (copy)');
    expect(copy.components).toHaveLength(1);
  });

  it('upserts and removes components by tag', () => {
    const entity = createProjectEntity({ label: 'Crate', family: 'obstacle' });
    const withVisual = entityWithComponent(entity, defaultComponentForTag('visual-ref'));
    const replaced = entityWithComponent(
      withVisual,
      visualRefWithPatch(componentOf(withVisual, 'visual-ref')!, { width: 64 }),
    );
    expect(replaced.components).toHaveLength(1);
    expect(componentOf(replaced, 'visual-ref')?.width).toBe(64);
    expect(entityWithoutComponent(replaced, 'visual-ref').components).toHaveLength(0);
  });

  it('provides a constructible default for every capability option', () => {
    for (const option of CAPABILITY_OPTIONS) {
      const component = defaultComponentForTag(option.tag);
      expect(component._tag).toBe(option.tag);
    }
  });

  it('manages visual-ref anchors (add, patch, remove)', () => {
    const visualRef = defaultComponentForTag('visual-ref') as VisualRefComponent;
    const withGrip = visualRefWithAnchor(visualRef, 'grip', { point: { x: 0.3, y: 0.7 } });
    expect(withGrip.anchors['grip']?.point).toMatchObject({ x: 0.3, y: 0.7 });
    expect(withGrip.anchors['grip']?.rotationDeg).toBe(0);

    const rotated = visualRefWithAnchor(withGrip, 'grip', { rotationDeg: 45 });
    expect(rotated.anchors['grip']?.point).toMatchObject({ x: 0.3, y: 0.7 });
    expect(rotated.anchors['grip']?.rotationDeg).toBe(45);

    expect(visualRefWithoutAnchor(rotated, 'grip').anchors['grip']).toBeUndefined();
  });

  it('patches placeableId only with a valid branded id', () => {
    const visualRef = defaultComponentForTag('visual-ref') as VisualRefComponent;
    const valid = visualRefWithPatch(visualRef, {
      placeableId: 'placeable:550e8400-e29b-41d4-a716-446655440000',
    });
    expect(Option.isSome(valid.placeableId)).toBe(true);
    const invalid = visualRefWithPatch(visualRef, { placeableId: 'not-an-id' });
    expect(Option.isNone(invalid.placeableId)).toBe(true);
  });

  it('validates anchor names as slugs', () => {
    expect(isValidAnchorName('grip')).toBe(true);
    expect(isValidAnchorName('muzzle-tip')).toBe(true);
    expect(isValidAnchorName('Grip')).toBe(false);
    expect(isValidAnchorName('')).toBe(false);
  });

  it('encodeEntity round-trips through the GameObjectType schema', () => {
    const entity = entityWithComponent(
      createProjectEntity({ label: 'Crate', family: 'obstacle' }),
      visualRefWithAnchor(defaultComponentForTag('visual-ref') as VisualRefComponent, 'grip', {
        point: { x: 0.25, y: 0.5 },
      }),
    );
    const json = encodeEntity(entity);
    const decoded = Schema.decodeUnknownSync(GameObjectType)(json);
    expect(decoded.label).toBe('Crate');
    expect(componentOf(decoded, 'visual-ref')?.anchors['grip']?.point).toMatchObject({
      x: 0.25,
      y: 0.5,
    });
  });
});

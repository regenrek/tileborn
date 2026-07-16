import type { TileborneMap } from '@tileborne/core';
import type { CatalogValidationIssue } from '@tileborne/ipc-contracts';
import { describe, expect, it } from 'vitest';

import { groupValidationIssues, resolveValidationNavigation } from '@/lib/catalog-validation';

const issue = (
  input: Partial<CatalogValidationIssue> & Pick<CatalogValidationIssue, 'kind' | 'message'>,
) => input as CatalogValidationIssue;

const TYPE_A = 'gameObjectType:aaaa' as CatalogValidationIssue['objectTypeId'];
const TYPE_B = 'gameObjectType:bbbb' as CatalogValidationIssue['objectTypeId'];

const mapWith = (objects: readonly { id: string; kind: string }[]): TileborneMap =>
  ({ objects }) as unknown as TileborneMap;

describe('groupValidationIssues', () => {
  it('buckets issues by kind in the canonical order, only emitting non-empty groups', () => {
    const groups = groupValidationIssues([
      issue({ kind: 'coherence', message: 'soft note' }),
      issue({ kind: 'duplicate-type', message: 'dup 1' }),
      issue({ kind: 'duplicate-type', message: 'dup 2' }),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(['duplicate-type', 'coherence']);
    const duplicates = groups[0]!;
    expect(duplicates.label).toBe('Duplicate types');
    expect(duplicates.issues.map((each) => each.message)).toEqual(['dup 1', 'dup 2']);
  });

  it('returns an empty list when there are no issues', () => {
    expect(groupValidationIssues([])).toEqual([]);
  });
});

describe('resolveValidationNavigation', () => {
  it('targets a placed object of the referenced type when one exists', () => {
    const target = resolveValidationNavigation(
      issue({ kind: 'unknown-reference', message: 'missing loot table', objectTypeId: TYPE_A }),
      mapWith([
        { id: 'object:other', kind: TYPE_B as string },
        { id: 'object:match', kind: TYPE_A as string },
      ]),
    );
    expect(target).toEqual({ kind: 'object', objectId: 'object:match', objectTypeId: TYPE_A });
  });

  it('falls back to surfacing the type in the palette when no object is placed', () => {
    const target = resolveValidationNavigation(
      issue({ kind: 'duplicate-type', message: 'duplicate', objectTypeId: TYPE_A }),
      mapWith([{ id: 'object:other', kind: TYPE_B as string }]),
    );
    expect(target).toEqual({ kind: 'palette', objectTypeId: TYPE_A });
  });

  it('reports no navigation for an issue without an object type id', () => {
    const target = resolveValidationNavigation(
      issue({ kind: 'coherence', message: 'bare note' }),
      mapWith([{ id: 'object:other', kind: TYPE_A as string }]),
    );
    expect(target).toEqual({ kind: 'none' });
  });

  it('falls back to the palette when no map is loaded', () => {
    const target = resolveValidationNavigation(
      issue({ kind: 'unknown-reference', message: 'missing', objectTypeId: TYPE_A }),
      undefined,
    );
    expect(target).toEqual({ kind: 'palette', objectTypeId: TYPE_A });
  });
});

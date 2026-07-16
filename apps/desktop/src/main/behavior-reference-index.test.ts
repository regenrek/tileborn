import { AssetBehaviorReference, makeAssetId, type Uuid } from '@tileborne/core';
import { describe, expect, it, vi } from 'vitest';

import { BehaviorReferenceIndex } from './behavior-reference-index.js';

const uuid = (index: number): Uuid =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` as Uuid;

describe('BehaviorReferenceIndex', () => {
  it('deduplicates source work across concurrent searches and pages over 2,000+ assets', async () => {
    const index = new BehaviorReferenceIndex();
    const loader = vi.fn(async () => Array.from({ length: 2_050 }, (_, item) => {
      const assetId = makeAssetId(uuid(item + 1));
      return {
        id: String(assetId),
        label: `Asset ${String(item).padStart(4, '0')}`,
        reference: new AssetBehaviorReference({ assetId }),
      };
    }));

    const pages = await Promise.all(Array.from({ length: 20 }, (_, request) =>
      index.query('project-1', 'asset', {
        query: request % 2 === 0 ? 'Asset' : 'Asset 1',
        offset: request * 32,
        limit: 32,
      }, loader),
    ));

    expect(loader).toHaveBeenCalledTimes(1);
    expect(pages.every(({ options }) => options.length <= 32)).toBe(true);

    index.invalidate('project-1', 'asset');
    await index.query('project-1', 'asset', { limit: 32 }, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

import { AssetBehaviorReference, makeAssetId, type Uuid } from '@tileborne/core';
import { describe, expect, it, vi } from 'vitest';

import { BehaviorReferenceIndex } from './behavior-reference-index.js';

const uuid = (index: number): Uuid =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` as Uuid;

describe('BehaviorReferenceIndex', () => {
  it('deduplicates source work across concurrent searches and pages over 2,000+ assets', async () => {
    const index = new BehaviorReferenceIndex();
    const loader = vi.fn(async () =>
      Array.from({ length: 2_050 }, (_, item) => {
        const assetId = makeAssetId(uuid(item + 1));
        return {
          id: String(assetId),
          label: `Asset ${String(item).padStart(4, '0')}`,
          reference: new AssetBehaviorReference({ assetId }),
        };
      }),
    );

    const pages = await Promise.all(
      Array.from({ length: 20 }, (_, request) =>
        index.query(
          'project-1',
          'asset',
          {
            query: request % 2 === 0 ? 'Asset' : 'Asset 1',
            offset: request * 32,
            limit: 32,
          },
          loader,
        ),
      ),
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(pages.every(({ options }) => options.length <= 32)).toBe(true);

    index.invalidate('project-1', 'asset');
    await index.query('project-1', 'asset', { limit: 32 }, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('owns bounded reference resolution without exposing the full cached index', async () => {
    const resolvedCounts: number[] = [];
    const index = new BehaviorReferenceIndex({
      onResolutionCompleted: ({ records }) => resolvedCounts.push(records),
    });
    const options = Array.from({ length: 128 }, (_, item) => {
      const assetId = makeAssetId(uuid(item + 1));
      return {
        id: String(assetId),
        label: `Asset ${item}`,
        reference: new AssetBehaviorReference({ assetId }),
      };
    });

    const result = await index.resolve(
      'project-1',
      'asset',
      Array.from({ length: 64 }, (_, index) => options[index]!.reference),
      async () => options,
    );

    expect(result.options).toHaveLength(64);
    expect(result.missing).toHaveLength(0);
    expect(resolvedCounts).toEqual([64]);
    await expect(
      index.resolve(
        'project-1',
        'asset',
        Array.from({ length: 65 }, (_, index) => options[index]!.reference),
        async () => options,
      ),
    ).rejects.toThrow('At most 64');
  });
});

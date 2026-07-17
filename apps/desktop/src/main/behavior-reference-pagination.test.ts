import { describe, expect, it } from 'vitest';

import {
  BEHAVIOR_REFERENCE_MAX_PAGE_SIZE,
  paginateBehaviorReferenceOptions,
} from './behavior-reference-pagination.js';

describe('paginateBehaviorReferenceOptions', () => {
  const options = Array.from({ length: 2_050 }, (_, index) => ({
    id: `asset-${String(index).padStart(4, '0')}`,
    label: `Asset ${String(index).padStart(4, '0')}`,
  }));

  it('keeps 2,000+ option responses bounded by the hard page limit', () => {
    const page = paginateBehaviorReferenceOptions(options, { limit: 2_000 });

    expect(page.total).toBe(2_050);
    expect(page.limit).toBe(BEHAVIOR_REFERENCE_MAX_PAGE_SIZE);
    expect(page.options).toHaveLength(BEHAVIOR_REFERENCE_MAX_PAGE_SIZE);
  });

  it('searches before paging and returns stable offsets', () => {
    const page = paginateBehaviorReferenceOptions(options, {
      query: 'Asset 20',
      offset: 4,
      limit: 8,
    });

    expect(page.total).toBe(50);
    expect(page.options).toHaveLength(8);
    expect(page.options[0]?.id).toBe('asset-2004');
  });
});

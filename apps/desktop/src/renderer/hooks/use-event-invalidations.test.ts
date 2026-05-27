import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/lib/query-client';

import { isMapsListQuery } from './use-event-invalidations.js';

describe('isMapsListQuery', () => {
  it('matches map list queries without matching open map detail queries', () => {
    expect(isMapsListQuery(queryKeys.maps.list('project-1'))).toBe(true);
    expect(isMapsListQuery(queryKeys.maps.detail('project-1', 'map-1'))).toBe(false);
  });
});

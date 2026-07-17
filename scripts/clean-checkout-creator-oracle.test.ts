import { describe, expect, it } from 'vitest';

import { assertClean, assertLocalLinks } from './clean-checkout-creator-oracle.mjs';

describe('clean-checkout creator Oracle provenance', () => {
  it('fails closed for dirty checkout phases', () => {
    expect(() => assertClean('', 'initial')).not.toThrow();
    expect(() => assertClean(' M package.json', 'post-build')).toThrow(/post-build.*dirty/s);
  });

  it('rejects workspace dependency links that escape the checkout', () => {
    expect(() =>
      assertLocalLinks('/checkout', [
        { path: 'apps/desktop/node_modules/@tileborne/core', target: '/checkout/packages/core' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertLocalLinks('/checkout', [
        { path: 'apps/desktop/node_modules/@tileborne/core', target: '/other/packages/core' },
      ]),
    ).toThrow(/escape checkout/);
  });
});

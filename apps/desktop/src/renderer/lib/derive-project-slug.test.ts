import { describe, expect, it } from 'vitest';

import { deriveProjectSlug } from './derive-project-slug';

describe('deriveProjectSlug', () => {
  it('slugifies names for folder preview', () => {
    expect(deriveProjectSlug('My Cool Game')).toBe('my-cool-game');
    expect(deriveProjectSlug('  ')).toBe('untitled-project');
    expect(deriveProjectSlug('Tileborne!!!')).toBe('tileborne');
  });
});

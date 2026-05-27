import { describe, expect, it } from 'vitest';

import {
  fuzzyMatchIndices,
  highlightFuzzyMatch,
  rankRecentCommands,
} from './command-palette-utils.js';

describe('command palette utils', () => {
  it('matches fuzzy subsequences case-insensitively', () => {
    expect(fuzzyMatchIndices('Generate map', 'gm')).toEqual([0, 9]);
    expect(fuzzyMatchIndices('Generate map', 'xyz')).toBeNull();
  });

  it('highlights matched characters in labels', () => {
    const highlighted = highlightFuzzyMatch('Settings', 'set');
    expect(highlighted).not.toBe('Settings');
  });

  it('ranks recent commands ahead of stale frequent ones', () => {
    const ranked = rankRecentCommands(
      ['map.generate', 'view.home'],
      { 'view.settings': 20, 'map.generate': 3 },
      4,
    );
    expect(ranked[0]).toBe('map.generate');
    expect(ranked).toContain('view.home');
  });
});

import { REQUIRED_PLAYER_MODEL_CLIP_KEYS } from '@tileborne/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAYER_MODEL_GEOMETRY,
  missingPlayerModelClipNames,
  toPlayerModelImportMetadata,
} from './sprite-player-model-controls';

describe('sprite player-model controls helpers', () => {
  it('reports missing required production player-model clips', () => {
    expect(missingPlayerModelClipNames([])).toEqual([...REQUIRED_PLAYER_MODEL_CLIP_KEYS]);
    expect(missingPlayerModelClipNames(['Idle', 'walk', 'run', 'shoot', 'reload', 'hit', 'death', 'dash', 'pickup'])).toEqual([]);
  });

  it('maps editor geometry controls to the sprite import player-model payload', () => {
    expect(toPlayerModelImportMetadata(DEFAULT_PLAYER_MODEL_GEOMETRY)).toEqual({
      renderScale: 1,
      hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
      muzzle: { x: 0.75, y: 0.45 },
    });
  });
});

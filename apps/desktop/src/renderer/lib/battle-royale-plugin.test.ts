import { describe, expect, it } from 'vitest';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale/constants';

import { BATTLE_ROYALE_PLUGIN_ID } from './battle-royale-plugin';

describe('battle-royale-plugin', () => {
  it('exports the canonical plugin id without a renderer-local install path', () => {
    expect(BATTLE_ROYALE_PLUGIN_ID).toBe(PLUGIN_ID);
  });
});

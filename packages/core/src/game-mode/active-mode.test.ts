import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PluginId } from '../ids.js';
import { ActiveGameMode, GameModeId, gameModeIdFromPluginId } from './active-mode.js';

const BR_PLUGIN_ID = Schema.decodeUnknownSync(PluginId)('@tileborne-plugins/battle-royale');

describe('game-mode/active-mode', () => {
  it('brands a plugin id into an open GameModeId', () => {
    const modeId = gameModeIdFromPluginId(BR_PLUGIN_ID);
    expect(modeId).toBe('@tileborne-plugins/battle-royale');
    expect(Schema.decodeUnknownSync(GameModeId)(modeId)).toBe(modeId);
  });

  it('round-trips an ActiveGameMode selection', () => {
    const modeId = gameModeIdFromPluginId(BR_PLUGIN_ID);
    const active = new ActiveGameMode({ modeId });
    const encoded = Schema.encodeSync(ActiveGameMode)(active);
    expect(encoded).toEqual({ modeId: '@tileborne-plugins/battle-royale' });
    const decoded = Schema.decodeUnknownSync(ActiveGameMode)(encoded);
    expect(decoded.modeId).toBe(modeId);
  });

  it('keeps GameModeId open (any non-empty string brands)', () => {
    const decoded = Schema.decodeUnknownSync(GameModeId)('some.future/genre-plugin');
    expect(decoded).toBe('some.future/genre-plugin');
  });
});

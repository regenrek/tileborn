import { PLUGIN_ID } from '@tileborne/plugin-battle-royale';
import { describe, expect, it } from 'vitest';

import { BATTLE_ROYALE_PLUGIN_ID, resolvePlaytestPlugin } from './playtest-plugin-bridge';

describe('playtest-plugin-bridge', () => {
  it('resolves the canonical battle royale manifest id and exposes decoding', () => {
    const plugin = resolvePlaytestPlugin(PLUGIN_ID);

    expect(BATTLE_ROYALE_PLUGIN_ID).toBe(PLUGIN_ID);
    expect(plugin).toBeDefined();

    const frame = plugin?.createInitialFrame({
      tick: 1,
      players: [{ playerId: 'player-1', x: 10, y: 20, health: 100 }],
      zone: { cx: 32, cy: 32, radius: 64 },
    });
    const bytes = plugin?.encodeServerFrame(frame);
    const decoded = bytes ? plugin?.decodeServerFrame(bytes) : undefined;

    expect(plugin?.serverFrameToView(decoded)).toMatchObject({
      kind: 'initial',
      tick: 1,
      players: [{ playerId: 'player-1', x: 10, y: 20, health: 100 }],
    });
  });

  it('exposes the plugin render manifest (fixedZoom + hudInsets) on the bridge result', () => {
    const plugin = resolvePlaytestPlugin(PLUGIN_ID);
    expect(plugin?.manifest).toEqual({
      fixedZoom: 4,
      hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  });
});

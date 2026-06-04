import { CORE_ACTIONS, InputMap } from '@tileborne/core';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BATTLE_ROYALE_PLUGIN_ID,
  EXAMPLE_ARENA_PLUGIN_ID,
  KNOWN_PLAYTEST_MODE_IDS,
  resolvePlaytestPlugin,
} from './playtest-plugin-bridge';

describe('playtest-plugin-bridge', () => {
  it('resolves modes from a registry (no hardcoded switch) and returns undefined for unknown ids', () => {
    expect(KNOWN_PLAYTEST_MODE_IDS).toContain(BATTLE_ROYALE_PLUGIN_ID);
    expect(resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID)).toBeDefined();
    expect(resolvePlaytestPlugin('@tileborne-plugins/not-installed')).toBeUndefined();
  });

  it('resolves a NON-battle-royale mode (the example arena) to a projector', () => {
    expect(KNOWN_PLAYTEST_MODE_IDS).toContain(EXAMPLE_ARENA_PLUGIN_ID);
    const arena = resolvePlaytestPlugin(EXAMPLE_ARENA_PLUGIN_ID);
    expect(arena).toBeDefined();
    expect(arena?.projector).toBeDefined();
    // Arena binds melee to mouse-0 only (no Space) — a distinct, decoded map.
    expect(arena?.inputCaptureProfile.usesMouseButtons).toBe(true);
    expect(arena?.inputCaptureProfile.boundKeyCodes.has('Space')).toBe(false);
    expect(arena?.inputCaptureProfile.boundKeyCodes.has('ShiftLeft')).toBe(true);
  });

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

  it('uses the BR plugin defaults when no user overlay is injected (Space + mouse bound)', () => {
    const plugin = resolvePlaytestPlugin(PLUGIN_ID);
    expect(plugin?.inputCaptureProfile.boundKeyCodes.has('Space')).toBe(true);
    expect(plugin?.inputCaptureProfile.usesMouseButtons).toBe(true);
  });

  it('applies an injected user overlay (PrimaryAction Space→KeyF) to the effective map', () => {
    // Headline ADR-0024 remap: rebind PrimaryAction off Space onto a different
    // key. The overlay is a partial InputMap; resolveEffectiveInputMap layers it
    // non-destructively so PrimaryAction now binds ONLY the new trigger while the
    // unremapped Move/Reload/etc. keep their plugin defaults.
    const overlay = Schema.decodeUnknownSync(InputMap)({
      id: 'user-overlay',
      actions: [{ action: CORE_ACTIONS.PrimaryAction, valueKind: 'digital' }],
      schemeDefaults: {
        'keyboard-mouse': [
          {
            _tag: 'InputBinding',
            action: CORE_ACTIONS.PrimaryAction,
            trigger: { _tag: 'key', code: 'KeyF' },
          },
        ],
      },
    });

    const plugin = resolvePlaytestPlugin(PLUGIN_ID, { userInputOverlay: overlay });
    const scheme = plugin?.controlScheme;
    const bindings = scheme === undefined ? [] : (plugin?.inputMap.schemeDefaults[scheme] ?? []);
    const primary = bindings.filter((binding) => binding.action === CORE_ACTIONS.PrimaryAction);

    // PrimaryAction now resolves to the remapped key only (Space + mouse dropped).
    expect(primary).toHaveLength(1);
    expect(primary[0]?.trigger._tag).toBe('key');
    expect(plugin?.inputCaptureProfile.boundKeyCodes.has('KeyF')).toBe(true);
    expect(plugin?.inputCaptureProfile.boundKeyCodes.has('Space')).toBe(false);
    expect(plugin?.inputCaptureProfile.usesMouseButtons).toBe(false);
    // Unremapped Move keeps its default WASD bindings.
    expect(bindings.some((binding) => binding.action === CORE_ACTIONS.Move)).toBe(true);
  });
});

import { CORE_ACTIONS, CORE_HUD_WIDGETS, HudLayout, InputMap } from '@tileborne/core';
import {
  PLUGIN_ID,
  requiredBattleRoyaleRenderableAssetIds,
} from '@tileborne/plugin-battle-royale/renderer';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  BATTLE_ROYALE_PLUGIN_ID,
  BATTLE_ROYALE_RENDERER_CAPABILITY_ID,
  EXAMPLE_ARENA_PLUGIN_ID,
  EXAMPLE_ARENA_RENDERER_CAPABILITY_ID,
  KNOWN_PLAYTEST_MODE_IDS,
  resolvePlaytestPlugin,
} from './playtest-plugin-bridge';

describe('playtest-plugin-bridge', () => {
  it('resolves modes only by renderer capability and rejects plugin ids or unknown ids', () => {
    expect(KNOWN_PLAYTEST_MODE_IDS).toContain(BATTLE_ROYALE_PLUGIN_ID);
    expect(resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID)).toBeDefined();
    expect(() => resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID)).toThrow(/capability/);
    expect(() => resolvePlaytestPlugin('@tileborne-plugins/not-installed')).toThrow(/capability/);
    expect(() => resolvePlaytestPlugin(undefined)).toThrow(/capabilities\.renderer/);
  });

  it('resolves a NON-battle-royale mode (the example arena) to a projector', () => {
    expect(KNOWN_PLAYTEST_MODE_IDS).toContain(EXAMPLE_ARENA_PLUGIN_ID);
    const arena = resolvePlaytestPlugin(EXAMPLE_ARENA_RENDERER_CAPABILITY_ID);
    expect(arena).toBeDefined();
    expect(arena?.projector).toBeDefined();
    // Arena binds melee to mouse-0 only (no Space) — a distinct, decoded map.
    expect(arena?.inputCaptureProfile.usesMouseButtons).toBe(true);
    expect(arena?.inputCaptureProfile.boundKeyCodes.has('Space')).toBe(false);
    expect(arena?.inputCaptureProfile.boundKeyCodes.has('ShiftLeft')).toBe(true);
  });

  it('resolves the canonical battle royale manifest id and exposes decoding', () => {
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID);

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
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID);
    expect(plugin?.manifest).toEqual({
      fixedZoom: 4,
      hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  });

  it('fails playtest resolution before mount if a BR projector asset is missing', () => {
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID);
    const registered = new Set(plugin?.bundledAssets.map((asset) => String(asset.assetId)) ?? []);

    expect(requiredBattleRoyaleRenderableAssetIds().filter((assetId) => !registered.has(assetId))).toEqual([]);
  });

  it('uses the BR plugin defaults when no user overlay is injected (Space + mouse bound)', () => {
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID);
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

    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID, { userInputOverlay: overlay });
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

  it('exposes the BR default HUD layout when no user HUD overlay is injected', () => {
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID);
    const byId = new Map(
      (plugin?.hudLayout.widgets ?? []).map((widget) => [widget.id as string, widget]),
    );
    expect(plugin?.hudLayout.id).toBe('br-default-hud');
    expect(byId.get('minimap')?.anchor).toBe('top-right');
    expect(byId.get('weapon-panel')?.anchor).toBe('bottom-center');
  });

  it('prefers a manifest-discovered HUD layout over the bundled code default', () => {
    const manifestLayout = Schema.decodeUnknownSync(HudLayout)({
      id: 'manifest-hud',
      widgets: [
        {
          id: 'minimap',
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: 'bottom-left',
          order: 0,
          enabled: true,
        },
      ],
    });

    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID, { manifestHudLayout: manifestLayout });
    expect(plugin?.hudLayout.id).toBe('manifest-hud');
    expect(plugin?.hudLayout.widgets).toHaveLength(1);
    expect(plugin?.hudLayout.widgets[0]?.anchor).toBe('bottom-left');
  });

  it('layers the project HUD overlay between the plugin default and the player overlay', () => {
    const projectLayout = Schema.decodeUnknownSync(HudLayout)({
      id: 'project-hud',
      widgets: [
        // Designer moves the minimap to the bottom-right for this project.
        {
          id: 'minimap',
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: 'bottom-right',
          order: 0,
          enabled: true,
        },
        // Designer hides the scoreboard project-wide.
        {
          id: 'scoreboard',
          kind: CORE_HUD_WIDGETS.Scoreboard,
          anchor: 'top-right',
          order: 1,
          enabled: false,
        },
      ],
    });
    const playerOverlay = Schema.decodeUnknownSync(HudLayout)({
      id: 'player-hud',
      widgets: [
        // Player moves the minimap again — the player layer wins over project.
        {
          id: 'minimap',
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: 'top-left',
          order: 0,
          enabled: true,
        },
      ],
    });

    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID, {
      projectHudLayout: projectLayout,
      userHudOverlay: playerOverlay,
    });
    const widgets = plugin?.hudLayout.widgets ?? [];
    expect(widgets.find((widget) => widget.id === 'minimap')?.anchor).toBe('top-left');
    expect(widgets.find((widget) => widget.id === 'scoreboard')?.enabled).toBe(false);
  });

  it('applies an injected user HUD overlay (move minimap, hide scoreboard) to the effective layout', () => {
    const overlay = Schema.decodeUnknownSync(HudLayout)({
      id: 'user-hud',
      widgets: [
        {
          id: 'minimap',
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: 'bottom-right',
          order: 0,
          enabled: true,
        },
        {
          id: 'scoreboard',
          kind: CORE_HUD_WIDGETS.Scoreboard,
          anchor: 'top-right',
          order: 2,
          enabled: false,
        },
      ],
    });

    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID, { userHudOverlay: overlay });
    const byId = new Map(
      (plugin?.hudLayout.widgets ?? []).map((widget) => [widget.id as string, widget]),
    );
    expect(byId.get('minimap')?.anchor).toBe('bottom-right');
    expect(byId.get('scoreboard')?.enabled).toBe(false);
    // Untouched defaults stay in place.
    expect(byId.get('weapon-panel')?.anchor).toBe('bottom-center');
  });
});

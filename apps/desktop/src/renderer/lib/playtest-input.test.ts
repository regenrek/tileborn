// @vitest-environment jsdom

import { CORE_ACTIONS, InputMap, controlScheme, CONTROL_SCHEMES } from '@tileborne/core';
import {
  battleRoyaleDefaultInputMap,
  resolveBattleRoyaleInputIntent,
} from '@tileborne/plugin-battle-royale/renderer';
import { resolveEffectiveInputMap } from '@tileborne/plugin-api';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachPlaytestInputCapture,
  deriveInputCaptureProfile,
  type ResolvedInputIntent,
} from './playtest-input';
import {
  BATTLE_ROYALE_RENDERER_CAPABILITY_ID,
  resolvePlaytestPlugin,
} from './playtest-plugin-bridge';
import { clearUserInputOverlay, saveUserInputOverlay } from './playtest-user-bindings';

const SCHEME = controlScheme(CONTROL_SCHEMES.KeyboardMouse);

/** A user overlay rebinding PrimaryAction off Space/mouse onto a single key. */
const primaryActionOverlay = (code: string): InputMap =>
  Schema.decodeUnknownSync(InputMap)({
    id: 'user-overlay',
    actions: [{ action: CORE_ACTIONS.PrimaryAction, valueKind: 'digital' }],
    schemeDefaults: {
      'keyboard-mouse': [
        {
          _tag: 'InputBinding',
          action: CORE_ACTIONS.PrimaryAction,
          trigger: { _tag: 'key', code },
        },
      ],
    },
  });

describe('deriveInputCaptureProfile', () => {
  it('collects bound key codes and detects mouse-button bindings from the BR default map', () => {
    const profile = deriveInputCaptureProfile(battleRoyaleDefaultInputMap(), SCHEME);
    // PrimaryAction is bound to Space AND mouse-0 (the headline remap target).
    expect(profile.boundKeyCodes.has('Space')).toBe(true);
    expect(profile.boundKeyCodes.has('KeyW')).toBe(true);
    expect(profile.boundKeyCodes.has('Digit1')).toBe(true);
    expect(profile.usesMouseButtons).toBe(true);
  });
});

describe('attachPlaytestInputCapture (neutral pipeline, no hardcoded SHOOT_KEY)', () => {
  let handle: { dispose(): void } | undefined;

  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    document.body.innerHTML = '';
  });

  const attach = (): { intents: ResolvedInputIntent[]; container: HTMLDivElement } => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const intents: ResolvedInputIntent[] = [];
    const inputMap = battleRoyaleDefaultInputMap();
    handle = attachPlaytestInputCapture({
      container,
      inputMap,
      controlScheme: SCHEME,
      profile: deriveInputCaptureProfile(inputMap, SCHEME),
      resolveIntent: (actions, context) => resolveBattleRoyaleInputIntent(actions, context),
      onIntent: (intent) => intents.push(intent),
    });
    return { intents, container };
  };

  it('resolves PrimaryAction (shoot) from the Space key binding', () => {
    const { intents } = attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(intents.at(-1)?.shoot).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    expect(intents.at(-1)?.shoot).toBe(false);
  });

  it('resolves PrimaryAction (shoot) from the mouse-button binding — same action, no key literal', () => {
    const { intents, container } = attach();
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(intents.at(-1)?.shoot).toBe(true);
    container.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    expect(intents.at(-1)?.shoot).toBe(false);
  });

  it('clears PrimaryAction when the mouse is released OUTSIDE the viewport (release is global)', () => {
    const { intents, container } = attach();
    // Press starts in the viewport...
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(intents.at(-1)?.shoot).toBe(true);
    // ...but the button is released anywhere on the window (not the container).
    // The window-level release must still clear PrimaryAction so BR stops
    // shooting; otherwise the press sticks forever.
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(intents.at(-1)?.shoot).toBe(false);
  });

  it('releases held mouse buttons and keys on window blur', () => {
    const { intents, container } = attach();
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)).toMatchObject({ shoot: true, dir: 0 });

    window.dispatchEvent(new FocusEvent('blur'));
    expect(intents.at(-1)?.shoot).toBe(false);
    expect(intents.at(-1)?.dir).toBeUndefined();

    const releasedCount = intents.length;
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(intents).toHaveLength(releasedCount);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)?.dir).toBe(0);
  });

  it('does not release held inputs for a focused blur event', () => {
    const { intents, container } = attach();
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)).toMatchObject({ shoot: true, dir: 0 });

    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const beforeCount = intents.length;
    window.dispatchEvent(new FocusEvent('blur'));
    focused.mockRestore();

    expect(intents).toHaveLength(beforeCount);
    expect(intents.at(-1)).toMatchObject({ shoot: true, dir: 0 });
  });

  it('releases held mouse buttons and keys when the document becomes hidden', () => {
    const { intents, container } = attach();
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)).toMatchObject({ shoot: true, dir: 0 });

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    hidden.mockRestore();

    expect(intents.at(-1)?.shoot).toBe(false);
    expect(intents.at(-1)?.dir).toBeUndefined();

    const releasedCount = intents.length;
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(intents).toHaveLength(releasedCount);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)?.dir).toBe(0);
  });

  it('ignores a window mouse release for a button that was never pressed in-viewport', () => {
    const { intents, container } = attach();
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const beforeCount = intents.length;
    // A stray release for an unbound/unheld button must not emit a spurious
    // intent (and must not clear the held button-0 press).
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    expect(intents.length).toBe(beforeCount);
    expect(intents.at(-1)?.shoot).toBe(true);
  });

  it('quantizes WASD movement to the 8-way direction the wire intent expects', () => {
    const { intents } = attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)?.dir).toBe(0); // east
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(intents.at(-1)?.dir).toBe(7); // north-east
  });

  it('emits a swap slot once on the Digit key just-press', () => {
    const { intents } = attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3' }));
    expect(intents.at(-1)?.swapSlot).toBe(3);
    // A subsequent unrelated input no longer re-sends the slot (just-pressed edge).
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)?.swapSlot).toBeUndefined();
  });
});

describe('attachPlaytestInputCapture (user remap overlay applied — ADR-0024 headline)', () => {
  let handle: { setEffectiveMap(map: InputMap): void; dispose(): void } | undefined;

  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    document.body.innerHTML = '';
  });

  const attachWithMap = (
    inputMap: InputMap,
  ): { intents: ResolvedInputIntent[]; container: HTMLDivElement } => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const intents: ResolvedInputIntent[] = [];
    handle = attachPlaytestInputCapture({
      container,
      inputMap,
      controlScheme: SCHEME,
      profile: deriveInputCaptureProfile(inputMap, SCHEME),
      resolveIntent: (actions, context) => resolveBattleRoyaleInputIntent(actions, context),
      onIntent: (intent) => intents.push(intent),
    });
    return { intents, container };
  };

  it('fires PrimaryAction on the REBOUND trigger (KeyF), not the old default (Space)', () => {
    // The persisted overlay rebinds PrimaryAction Space→KeyF; the effective map is
    // pluginDefault ⊕ overlay. The resolver must now fire shoot on KeyF and ignore
    // the old Space binding entirely.
    const effective = resolveEffectiveInputMap(
      battleRoyaleDefaultInputMap(),
      primaryActionOverlay('KeyF'),
    );
    const { intents } = attachWithMap(effective);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    // Space is no longer bound to anything, so it produces no shoot.
    expect(intents.at(-1)?.shoot ?? false).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    expect(intents.at(-1)?.shoot).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
    expect(intents.at(-1)?.shoot).toBe(false);
  });

  it('live re-applies a new effective map via setEffectiveMap without recreating capture', () => {
    // Start on defaults (Space fires), then live-swap to the KeyF overlay map.
    const { intents } = attachWithMap(battleRoyaleDefaultInputMap());
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(intents.at(-1)?.shoot).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));

    const effective = resolveEffectiveInputMap(
      battleRoyaleDefaultInputMap(),
      primaryActionOverlay('KeyF'),
    );
    handle?.setEffectiveMap(effective);

    // Space no longer fires; the rebound KeyF does — proving the swap re-derived
    // the capture profile and the resolver mapping live.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(intents.at(-1)?.shoot ?? false).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    expect(intents.at(-1)?.shoot).toBe(true);
  });
});

/** Minimal in-memory `Storage` so the bridge's localStorage path is deterministic. */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('persisted overlay applied on capture attach (bridge owner integration)', () => {
  let handle: { dispose(): void } | undefined;

  beforeEach(() => {
    // The bridge resolves the persisted overlay through the bare-global
    // `localStorage` (no injection seam through `resolvePlaytestPlugin`); stub a
    // fresh in-memory store so the save→load path is deterministic here.
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    clearUserInputOverlay();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('attaches the LATEST persisted overlay (Space→KeyF) the way usePlaytestInputBridge does', () => {
    // ADR-0024 remap-apply policy: a remap saved by the Controls UI applies on
    // the NEXT playtest session. This proves the integration the bridge owner
    // (`usePlaytestInputBridge`) relies on: a persisted overlay is loaded +
    // applied on capture-attach. Persist a Space→KeyF rebind the way the
    // Controls UI would, through the SHARED localStorage overlay key.
    saveUserInputOverlay(primaryActionOverlay('KeyF'));

    // Mirror the bridge owner exactly: resolve the plugin WITHOUT injecting an
    // overlay (the production path), so `resolvePlaytestPlugin` loads the latest
    // persisted overlay itself, then attach capture to its effective input map.
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_RENDERER_CAPABILITY_ID);
    if (plugin === undefined) {
      throw new Error('expected the battle royale playtest plugin to resolve');
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const intents: ResolvedInputIntent[] = [];
    handle = attachPlaytestInputCapture({
      container,
      inputMap: plugin.inputMap,
      controlScheme: plugin.controlScheme,
      profile: plugin.inputCaptureProfile,
      resolveIntent: (actions, context) => plugin.resolveInputIntent(actions, context),
      onIntent: (intent) => intents.push(intent),
    });

    // The OLD default trigger (Space) no longer fires shoot; the persisted KeyF
    // rebind does — proving the saved overlay was applied at attach time.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(intents.at(-1)?.shoot ?? false).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    expect(intents.at(-1)?.shoot).toBe(true);
  });
});

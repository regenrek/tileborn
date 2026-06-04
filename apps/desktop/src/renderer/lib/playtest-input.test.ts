// @vitest-environment jsdom

import { controlScheme, CONTROL_SCHEMES } from '@tileborne/core';
import {
  battleRoyaleDefaultInputMap,
  resolveBattleRoyaleInputIntent,
} from '@tileborne/plugin-battle-royale';
import { afterEach, describe, expect, it } from 'vitest';

import {
  attachPlaytestInputCapture,
  deriveInputCaptureProfile,
  type ResolvedInputIntent,
} from './playtest-input';

const SCHEME = controlScheme(CONTROL_SCHEMES.KeyboardMouse);

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

  it('emits a weapon slot once on the Digit key just-press', () => {
    const { intents } = attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3' }));
    expect(intents.at(-1)?.weaponSlot).toBe(3);
    // A subsequent unrelated input no longer re-sends the slot (just-pressed edge).
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(intents.at(-1)?.weaponSlot).toBeUndefined();
  });
});

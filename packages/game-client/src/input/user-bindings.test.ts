import {
  CONTROL_SCHEMES,
  CORE_ACTIONS,
  InputMap,
  RawTrigger,
  controlScheme,
  makeActionId,
} from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  USER_INPUT_OVERLAY_STORAGE_KEY,
  createLocalStorageBindingsStore,
  effectiveBindingsForAction,
  rebindActionTrigger,
  resetActionInScheme,
  triggerLabel,
} from './user-bindings.js';

const SCHEME = controlScheme(CONTROL_SCHEMES.KeyboardMouse);
const PRIMARY = makeActionId(CORE_ACTIONS.PrimaryAction);
const MOVE = makeActionId(CORE_ACTIONS.Move);

/** A minimal plugin-default map: PrimaryAction→Space (digital), Move→KeyD (analog2d). */
const baseMap = (): InputMap =>
  Schema.decodeUnknownSync(InputMap)({
    id: 'plugin-default',
    actions: [
      { action: CORE_ACTIONS.PrimaryAction, valueKind: 'digital' },
      { action: CORE_ACTIONS.Move, valueKind: 'analog2d' },
    ],
    schemeDefaults: {
      'keyboard-mouse': [
        {
          _tag: 'InputBinding',
          action: CORE_ACTIONS.PrimaryAction,
          trigger: { _tag: 'key', code: 'Space' },
        },
        {
          _tag: 'InputBinding',
          action: CORE_ACTIONS.Move,
          trigger: { _tag: 'key', code: 'KeyD' },
          axisRole: 'x+',
        },
      ],
    },
  });

const keyTrigger = (code: string): RawTrigger =>
  Schema.decodeUnknownSync(RawTrigger)({ _tag: 'key', code });
const mouseTrigger = (button: number): RawTrigger =>
  Schema.decodeUnknownSync(RawTrigger)({ _tag: 'mouseButton', button });

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

describe('rebindActionTrigger (non-destructive overlay)', () => {
  it('rebinds PrimaryAction to a new key without disturbing Move', () => {
    const base = baseMap();
    const overlay = rebindActionTrigger({
      base,
      overlay: undefined,
      scheme: SCHEME,
      action: PRIMARY,
      trigger: keyTrigger('KeyF'),
    });

    const primary = effectiveBindingsForAction(base, overlay, SCHEME, PRIMARY);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.trigger._tag).toBe('key');
    expect(primary[0]?.trigger._tag === 'key' ? primary[0].trigger.code : undefined).toBe('KeyF');

    // Move still resolves to its default binding (overlay is non-destructive).
    const move = effectiveBindingsForAction(base, overlay, SCHEME, MOVE);
    expect(move.some((binding) => binding.trigger._tag === 'key')).toBe(true);
  });

  it('supports rebinding PrimaryAction to a mouse button (the headline example)', () => {
    const base = baseMap();
    const overlay = rebindActionTrigger({
      base,
      overlay: undefined,
      scheme: SCHEME,
      action: PRIMARY,
      trigger: mouseTrigger(0),
    });
    const primary = effectiveBindingsForAction(base, overlay, SCHEME, PRIMARY);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.trigger._tag).toBe('mouseButton');
  });
});

describe('resetActionInScheme', () => {
  it('restores the default and returns undefined once the overlay is empty', () => {
    const base = baseMap();
    const overlay = rebindActionTrigger({
      base,
      overlay: undefined,
      scheme: SCHEME,
      action: PRIMARY,
      trigger: keyTrigger('KeyF'),
    });

    const reset = resetActionInScheme({ overlay, scheme: SCHEME, action: PRIMARY });
    expect(reset).toBeUndefined();

    // With no overlay, the effective binding is the plugin default (Space).
    const primary = effectiveBindingsForAction(base, reset, SCHEME, PRIMARY);
    expect(primary[0]?.trigger._tag === 'key' ? primary[0].trigger.code : undefined).toBe('Space');
  });
});

describe('createLocalStorageBindingsStore', () => {
  it('persists + reloads the overlay through the shared key as canonical InputMap JSON', () => {
    const storage = new MemoryStorage();
    const store = createLocalStorageBindingsStore({ storage });
    const overlay = rebindActionTrigger({
      base: baseMap(),
      overlay: undefined,
      scheme: SCHEME,
      action: PRIMARY,
      trigger: keyTrigger('KeyF'),
    });

    store.save(overlay);
    expect(storage.getItem(USER_INPUT_OVERLAY_STORAGE_KEY)).not.toBeNull();

    // A FRESH store over the same storage (simulating a reload) sees the overlay.
    const reloaded = createLocalStorageBindingsStore({ storage }).load();
    expect(reloaded).toEqual(overlay);

    store.clear();
    expect(createLocalStorageBindingsStore({ storage }).load()).toBeUndefined();
  });

  it('treats a corrupt or missing stored overlay as absent (never blocks input)', () => {
    const storage = new MemoryStorage();

    // Missing: nothing stored → no overlay (resolver uses plugin defaults).
    expect(createLocalStorageBindingsStore({ storage }).load()).toBeUndefined();

    // Corrupt JSON must not throw — a broken overlay can never block input.
    storage.setItem(USER_INPUT_OVERLAY_STORAGE_KEY, '{ not valid json');
    expect(createLocalStorageBindingsStore({ storage }).load()).toBeUndefined();

    // Valid JSON that does not decode against the InputMap schema is also absent.
    storage.setItem(USER_INPUT_OVERLAY_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(createLocalStorageBindingsStore({ storage }).load()).toBeUndefined();
  });
});

describe('triggerLabel', () => {
  it('humanizes raw triggers for display', () => {
    expect(triggerLabel(keyTrigger('Space'))).toBe('Space');
    expect(triggerLabel(keyTrigger('KeyF'))).toBe('F');
    expect(triggerLabel(mouseTrigger(0))).toBe('Mouse Left');
    expect(triggerLabel(Schema.decodeUnknownSync(RawTrigger)({ _tag: 'pointer' }))).toBe('Pointer');
  });
});

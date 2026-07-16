import { CONTROL_SCHEMES, CORE_ACTIONS, InputMap, controlScheme } from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  USER_INPUT_OVERLAY_STORAGE_KEY,
  clearUserInputOverlay,
  loadUserInputOverlay,
  saveUserInputOverlay,
} from './playtest-user-bindings';

/** Minimal in-memory `Storage` so the persistence layer is testable without a DOM. */
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

const overlayRebindingPrimaryActionTo = (code: string): InputMap =>
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

describe('playtest-user-bindings persistence', () => {
  it('returns undefined when nothing is stored / storage is unavailable', () => {
    expect(loadUserInputOverlay(new MemoryStorage())).toBeUndefined();
    expect(loadUserInputOverlay(undefined)).toBeUndefined();
  });

  it('round-trips a remap overlay through the canonical InputMap schema encoding', () => {
    const storage = new MemoryStorage();
    const overlay = overlayRebindingPrimaryActionTo('KeyF');

    saveUserInputOverlay(overlay, storage);

    // Persisted under the versioned, shared key as JSON of the InputMap encoding.
    expect(storage.getItem(USER_INPUT_OVERLAY_STORAGE_KEY)).not.toBeNull();
    const loaded = loadUserInputOverlay(storage);
    expect(loaded).toEqual(overlay);
  });

  it('persists across a "reload": a fresh load from the same storage sees the overlay', () => {
    const storage = new MemoryStorage();
    saveUserInputOverlay(overlayRebindingPrimaryActionTo('KeyF'), storage);

    // Simulate a reload: discard any in-memory state and re-read the same store.
    const reloaded = loadUserInputOverlay(storage);
    const primary = reloaded?.schemeDefaults[controlScheme(CONTROL_SCHEMES.KeyboardMouse)]?.find(
      (binding) => binding.action === CORE_ACTIONS.PrimaryAction,
    );
    expect(primary?.trigger._tag).toBe('key');
    expect(primary?.trigger._tag === 'key' ? primary.trigger.code : undefined).toBe('KeyF');
  });

  it('clears the overlay (reset-to-defaults falls back to plugin defaults)', () => {
    const storage = new MemoryStorage();
    saveUserInputOverlay(overlayRebindingPrimaryActionTo('KeyF'), storage);
    clearUserInputOverlay(storage);
    expect(loadUserInputOverlay(storage)).toBeUndefined();
  });

  it('treats a corrupt stored value as absent rather than throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(USER_INPUT_OVERLAY_STORAGE_KEY, '{ not valid json');
    expect(loadUserInputOverlay(storage)).toBeUndefined();

    storage.setItem(USER_INPUT_OVERLAY_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadUserInputOverlay(storage)).toBeUndefined();
  });
});

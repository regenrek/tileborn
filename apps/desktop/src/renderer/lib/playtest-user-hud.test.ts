import { CORE_HUD_WIDGETS, HudLayout } from '@tileborne/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  USER_HUD_OVERLAY_STORAGE_KEY,
  clearUserHudOverlay,
  loadUserHudOverlay,
  saveUserHudOverlay,
} from './playtest-user-hud';

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

const overlayMovingMinimapTo = (anchor: string): HudLayout =>
  Schema.decodeUnknownSync(HudLayout)({
    id: 'user-hud',
    widgets: [{ id: 'minimap', kind: CORE_HUD_WIDGETS.Minimap, anchor, order: 0, enabled: true }],
  });

describe('playtest-user-hud persistence', () => {
  it('returns undefined when nothing is stored / storage is unavailable', () => {
    expect(loadUserHudOverlay(new MemoryStorage())).toBeUndefined();
    expect(loadUserHudOverlay(undefined)).toBeUndefined();
  });

  it('round-trips a HUD overlay through the canonical HudLayout schema encoding', () => {
    const storage = new MemoryStorage();
    const overlay = overlayMovingMinimapTo('bottom-right');

    saveUserHudOverlay(overlay, storage);

    expect(storage.getItem(USER_HUD_OVERLAY_STORAGE_KEY)).not.toBeNull();
    expect(loadUserHudOverlay(storage)).toEqual(overlay);
  });

  it('clears the overlay (reset-to-defaults falls back to the plugin layout)', () => {
    const storage = new MemoryStorage();
    saveUserHudOverlay(overlayMovingMinimapTo('bottom-right'), storage);
    clearUserHudOverlay(storage);
    expect(loadUserHudOverlay(storage)).toBeUndefined();
  });

  it('treats a corrupt stored value as absent rather than throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(USER_HUD_OVERLAY_STORAGE_KEY, '{ not valid json');
    expect(loadUserHudOverlay(storage)).toBeUndefined();

    storage.setItem(USER_HUD_OVERLAY_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadUserHudOverlay(storage)).toBeUndefined();
  });
});

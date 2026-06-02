import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_BATTLE_ROYALE_MODELS } from "../models.js";
import {
  readSelectedModelId,
  resolveSelectedModelId,
  writeSelectedModelId,
} from "../loadout.js";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(): string | null {
    return null;
  }
  get length(): number {
    return this.store.size;
  }
}

describe("battle royale loadout selection", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("defaults to the first roster model when nothing is persisted", () => {
    expect(resolveSelectedModelId()).toBe(DEFAULT_BATTLE_ROYALE_MODELS[0]?.id);
    expect(readSelectedModelId()).toBeUndefined();
  });

  it("persists and resolves a valid selection across reads", () => {
    writeSelectedModelId("tank");
    expect(readSelectedModelId()).toBe("tank");
    expect(resolveSelectedModelId()).toBe("tank");
  });

  it("falls back to the default when the persisted model is no longer in the roster", () => {
    writeSelectedModelId("ghost");
    expect(resolveSelectedModelId()).toBe(DEFAULT_BATTLE_ROYALE_MODELS[0]?.id);
  });
});

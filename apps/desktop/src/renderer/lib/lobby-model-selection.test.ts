import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readLobbyModelSelection,
  resolveSelectedModelId,
  writeLobbyModelSelection,
} from './lobby-model-selection';

const PROJECT = 'project:demo';

// The desktop test runner uses the node environment (no real localStorage), so
// install a minimal in-memory stub to exercise the persistence logic directly.
const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe('lobby-model-selection', () => {
  it('persists and reads the per-project selection', () => {
    expect(readLobbyModelSelection(PROJECT)).toBeUndefined();
    writeLobbyModelSelection(PROJECT, 'model:hero');
    expect(readLobbyModelSelection(PROJECT)).toBe('model:hero');
  });

  it('resolves the persisted pick when still in the roster, else the first model', () => {
    writeLobbyModelSelection(PROJECT, 'model:mage');
    expect(resolveSelectedModelId(PROJECT, ['model:hero', 'model:mage'])).toBe('model:mage');
    expect(resolveSelectedModelId(PROJECT, ['model:hero', 'model:rogue'])).toBe('model:hero');
    expect(resolveSelectedModelId(PROJECT, [])).toBeUndefined();
  });
});

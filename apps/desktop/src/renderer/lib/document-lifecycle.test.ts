// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  documentLifecycle,
  installGracefulAppClose,
  requestDocumentClose,
  useDocumentLifecycle,
  type DocumentRegistration,
} from './document-lifecycle';

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: memoryStorage(),
});

const registration = (overrides: Partial<DocumentRegistration> = {}): DocumentRegistration => ({
  id: 'map:project-1:map-1',
  label: 'Starter Arena',
  kind: 'map',
  save: vi.fn().mockResolvedValue(undefined),
  discard: vi.fn(),
  snapshot: () => ({ title: 'recovery' }),
  recover: vi.fn(),
  ...overrides,
});

describe('document lifecycle', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    documentLifecycle.resetForTests();
  });

  it('tracks dirty, saving and saved without reporting a failed write as success', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk full'));
    documentLifecycle.register(registration({ save }));
    documentLifecycle.markDirty('map:project-1:map-1');

    await expect(documentLifecycle.save('map:project-1:map-1')).resolves.toBe(false);
    expect(documentLifecycle.get('map:project-1:map-1')).toMatchObject({
      status: 'error',
      error: 'disk full',
      hasRecovery: true,
    });
  });

  it('offers save, explicit discard, and cancel before a dirty close', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn();
    documentLifecycle.register(registration({ save, discard }));
    documentLifecycle.markDirty('map:project-1:map-1');
    expect(
      await requestDocumentClose(
        'map:project-1:map-1',
        vi.fn(() => true),
      ),
    ).toBe(true);
    expect(save).toHaveBeenCalledOnce();

    documentLifecycle.markDirty('map:project-1:map-1');
    const discardAnswers = [false, true];
    expect(
      await requestDocumentClose(
        'map:project-1:map-1',
        vi.fn(() => discardAnswers.shift()!),
      ),
    ).toBe(true);
    expect(discard).toHaveBeenCalledOnce();

    documentLifecycle.markDirty('map:project-1:map-1');
    expect(
      await requestDocumentClose(
        'map:project-1:map-1',
        vi.fn(() => false),
      ),
    ).toBe(false);
    expect(documentLifecycle.get('map:project-1:map-1')?.status).toBe('dirty');
  });

  it('reopens an atomic recovery snapshot and clears it after save', async () => {
    const first = registration();
    documentLifecycle.register(first);
    documentLifecycle.markDirty(first.id);
    await Promise.resolve();

    documentLifecycle.resetForTests();
    const recover = vi.fn();
    documentLifecycle.register(registration({ recover }));
    expect(documentLifecycle.get(first.id)?.status).toBe('recovery');
    await expect(documentLifecycle.recover(first.id)).resolves.toBe(true);
    expect(recover).toHaveBeenCalledWith({ title: 'recovery' });
    expect(documentLifecycle.get(first.id)?.status).toBe('dirty');
    await documentLifecycle.save(first.id);

    documentLifecycle.resetForTests();
    documentLifecycle.register(registration());
    expect(documentLifecycle.get(first.id)?.status).toBe('clean');
  });

  it('rehydrates recovery when navigating away and back without resetting the process registry', async () => {
    const recover = vi.fn();
    const first = renderHook(() =>
      useDocumentLifecycle({
        ...registration(),
        dirty: true,
        recoveryVersion: 'draft-v1',
        snapshot: () => ({ title: 'same-process draft' }),
      }),
    );
    await waitFor(() => expect(documentLifecycle.get('map:project-1:map-1')?.status).toBe('dirty'));
    first.unmount();

    const remounted = renderHook(() =>
      useDocumentLifecycle({
        ...registration({ recover }),
        dirty: false,
        recoveryVersion: 'durable-v1',
      }),
    );
    await waitFor(() => expect(recover).toHaveBeenCalledWith({ title: 'same-process draft' }));
    expect(documentLifecycle.get('map:project-1:map-1')).toMatchObject({
      status: 'dirty',
      hasRecovery: true,
    });
    remounted.unmount();
  });

  it('persists the latest snapshot across multiple dirty edits', async () => {
    const first = renderHook(
      ({ draft }) =>
        useDocumentLifecycle({
          ...registration(),
          dirty: true,
          recoveryVersion: draft,
          snapshot: () => ({ title: draft }),
        }),
      { initialProps: { draft: 'draft-v1' } },
    );
    await waitFor(() => expect(documentLifecycle.get('map:project-1:map-1')?.revision).toBe(1));
    first.rerender({ draft: 'draft-v2' });
    await waitFor(() => expect(documentLifecycle.get('map:project-1:map-1')?.revision).toBe(2));
    first.unmount();

    documentLifecycle.resetForTests();
    const recover = vi.fn();
    documentLifecycle.register(registration({ recover }));
    await expect(documentLifecycle.recover('map:project-1:map-1')).resolves.toBe(true);
    expect(recover).toHaveBeenCalledWith({ title: 'draft-v2' });
  });

  it('blocks graceful app close when a confirmed save fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('read only disk'));
    documentLifecycle.register(registration({ save }));
    documentLifecycle.markDirty('map:project-1:map-1');
    let onCloseRequested: ((request: { requestId: string }) => void) | undefined;
    const resolveClose = vi.fn();
    const uninstall = installGracefulAppClose(
      {
        onCloseRequested: (handler) => {
          onCloseRequested = handler;
          return vi.fn();
        },
        resolveClose,
      },
      vi.fn(() => true),
    );

    onCloseRequested?.({ requestId: 'close-1' });
    await vi.waitFor(() =>
      expect(resolveClose).toHaveBeenCalledWith({
        requestId: 'close-1',
        allow: false,
      }),
    );
    expect(documentLifecycle.get('map:project-1:map-1')).toMatchObject({
      status: 'error',
      error: 'read only disk',
      hasRecovery: true,
    });
    uninstall();
  });
});

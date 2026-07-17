// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createStartupStatusStore } from '../shared/startup-status.js';

describe('createStartupStatusStore', () => {
  it('records task timing and publishes snapshots', () => {
    let nowMs = Date.parse('2026-05-25T12:00:00.000Z');
    const store = createStartupStatusStore({ now: () => new Date(nowMs) });
    const snapshots: unknown[] = [];
    const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot));

    store.beginTask('app-ready');
    nowMs += 25;
    store.completeTask('app-ready');
    unsubscribe();

    const task = store.getSnapshot().tasks.find((candidate) => candidate.id === 'app-ready');
    expect(task).toMatchObject({
      status: 'completed',
      durationMs: 25,
    });
    expect(snapshots).toHaveLength(2);
  });

  it('marks optional task failures as degraded without failing required startup', () => {
    const store = createStartupStatusStore();

    store.beginTask('plugin-seed');
    store.failTask('plugin-seed', 'timed-out', 'timed out after 15000ms');

    const snapshot = store.getSnapshot();
    expect(snapshot.state).toBe('degraded');
    expect(snapshot.errors).toEqual([
      expect.objectContaining({
        taskId: 'plugin-seed',
        status: 'timed-out',
        message: 'timed out after 15000ms',
      }),
    ]);
  });

  it('marks required task failures as failed', () => {
    const store = createStartupStatusStore();

    store.beginTask('ipc-registration');
    store.failTask('ipc-registration', 'failed', 'handler registration failed');

    expect(store.getSnapshot().state).toBe('failed');
  });
});

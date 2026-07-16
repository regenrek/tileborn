import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentRecoveryStore } from './document-recovery-store';
import type { AppRecoveryStorageRecord } from '../shared/app-lifecycle';

const roots: string[] = [];

const record = (revision = 1): AppRecoveryStorageRecord => ({
  schemaVersion: 1,
  documentId: 'game-content:project:one',
  kind: 'project-content',
  label: 'Gameplay content draft',
  revision,
  updatedAt: `2026-07-16T00:00:0${revision}.000Z`,
  snapshot: { label: `Potion ${revision}` },
});

const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tileborne-document-recovery-'));
  roots.push(root);
  return path.join(root, 'recovery', 'documents.json');
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('main-owned document recovery store', () => {
  it('acknowledges an upsert only after an atomic registry survives a new owner', async () => {
    const filePath = await fixture();
    await createDocumentRecoveryStore(filePath).commit({
      mutations: [{ _tag: 'upsert', record: record() }],
    });

    await expect(createDocumentRecoveryStore(filePath).load()).resolves.toEqual({
      records: [record()],
    });
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 1 });
  });

  it('serializes updates and durably removes deleted recovery', async () => {
    const filePath = await fixture();
    const store = createDocumentRecoveryStore(filePath);
    await Promise.all([
      store.commit({ mutations: [{ _tag: 'upsert', record: record(1) }] }),
      store.commit({ mutations: [{ _tag: 'upsert', record: record(2) }] }),
    ]);
    await store.commit({
      mutations: [{ _tag: 'delete', documentId: record().documentId }],
    });

    await expect(createDocumentRecoveryStore(filePath).load()).resolves.toEqual({ records: [] });
  });
});

import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inventoryArtifact, snapshotShippedArtifact } from './shipped-artifact-evidence.mjs';

describe('shipped artifact evidence', () => {
  it('copies a deterministic complete snapshot and binds every byte', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'shipped-artifact-evidence-')),
    );
    const source = path.join(root, 'source');
    const evidence = path.join(root, 'evidence');
    await mkdir(path.join(source, 'maps'), { recursive: true });
    await mkdir(evidence);
    await writeFile(path.join(source, 'worker.js'), 'export default {}\n');
    await writeFile(path.join(source, 'maps', 'map.json'), '{"id":"map:one"}\n');
    const snapshot = await snapshotShippedArtifact({
      sourceDirectory: source,
      evidenceRoot: evidence,
    });
    expect(snapshot.files.map((file) => file.path)).toEqual(['maps/map.json', 'worker.js']);
    expect(await inventoryArtifact(path.join(evidence, snapshot.directory))).toEqual({
      files: snapshot.files,
      treeSha256: snapshot.treeSha256,
    });
    expect(await readFile(path.join(evidence, snapshot.directory, 'worker.js'), 'utf8')).toBe(
      'export default {}\n',
    );
  });

  it('rejects symlinks instead of allowing checkout/runtime escapes', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'shipped-artifact-symlink-')),
    );
    await writeFile(path.join(root, 'outside'), 'secret');
    const source = path.join(root, 'source');
    await mkdir(source);
    await symlink(path.join(root, 'outside'), path.join(source, 'escape'));
    await expect(inventoryArtifact(source)).rejects.toThrow('symlink escapes root');
  });
});

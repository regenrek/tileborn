import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  inventoryRuntimeClosure,
  validateBuildArtifact,
} from './external-shipped-artifact-oracle.mjs';

describe('external shipped artifact Oracle integrity', () => {
  it('validates the durable record and rejects a shipped-file mutation', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'external-ship-oracle-')),
    );
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'worker.js'), 'worker');
    const fileHash = `sha256:${await import('node:crypto').then(({ createHash }) => createHash('sha256').update('worker').digest('hex'))}`;
    const manifest = { buildId: 'sha256:runtime' };
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    const manifestHash = `sha256:${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(JSON.stringify(manifest)).digest('hex'))}`;
    const payload = {
      buildId: 'sha256:build',
      runtimeBuildId: manifest.buildId,
      files: ['manifest.json', 'worker.js'],
      fileHashes: { 'manifest.json': manifestHash, 'worker.js': fileHash },
    };
    const canonical = (value: unknown): string => {
      if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
      if (typeof value === 'number') return value.toString();
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
    };
    const integrityHash = `sha256:${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(canonical(payload)).digest('hex'))}`;
    await writeFile(path.join(root, 'build-artifact.json'), JSON.stringify({ ...payload, integrityHash }));
    await expect(validateBuildArtifact(root)).resolves.toMatchObject({ record: { buildId: payload.buildId } });
    await writeFile(path.join(root, 'worker.js'), 'tampered');
    await expect(validateBuildArtifact(root)).rejects.toThrow('checksum mismatch: worker.js');
    expect(await readFile(path.join(root, 'worker.js'), 'utf8')).toBe('tampered');
  });

  it('allows only runtime-closure-internal symlink targets', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'external-runtime-closure-')),
    );
    await mkdir(path.join(root, 'bin'));
    await writeFile(path.join(root, 'bin', 'runtime'), 'runtime');
    await symlink('bin/runtime', path.join(root, 'runtime'));
    await expect(inventoryRuntimeClosure(root)).resolves.toMatchObject({ symlinks: [{ path: 'runtime', target: 'bin/runtime' }] });
    await symlink('/etc/hosts', path.join(root, 'escape'));
    await expect(inventoryRuntimeClosure(root)).rejects.toThrow('runtime symlink escapes closure');
  });
});

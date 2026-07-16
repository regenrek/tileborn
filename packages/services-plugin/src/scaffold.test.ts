import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { hashPluginDirectory } from './filesystem.js';
import { PluginInstallerLayer, PluginInstallerService } from './index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const withDir = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tileborne-plugin-scaffold-'));
  tempDirs.push(dir);
  process.env['TILEBORNE_HOME'] = await mkdtemp(path.join(tmpdir(), 'tileborne-plugin-home-'));
  return run(dir);
};

describe('PluginInstallerService scaffold', () => {
  it('creates expected plugin scaffold files', () =>
    withDir(async (cwd) => {
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const installer = yield* PluginInstallerService;
          return yield* installer.create('demo-plugin', undefined, cwd);
        }).pipe(Effect.provide(PluginInstallerLayer)),
      );
      expect(created.directory).toBe(path.join(cwd, 'demo-plugin'));
      await expect(
        readFile(path.join(created.directory, 'tileborne-plugin.json'), 'utf8'),
      ).resolves.toContain('@tileborne-plugins/demo-plugin');
      await expect(readFile(path.join(created.directory, 'README.md'), 'utf8')).resolves.toContain(
        'demo-plugin',
      );
    }));

  it('packs a plugin directory with stable integrity metadata', () =>
    withDir(async (cwd) => {
      const source = path.join(cwd, 'pack-me');
      await Effect.runPromise(
        Effect.gen(function* () {
          const installer = yield* PluginInstallerService;
          yield* installer.create('pack-me', undefined, cwd);
        }).pipe(Effect.provide(PluginInstallerLayer)),
      );
      const out = path.join(cwd, 'dist', 'pack-me.tbpack');
      const packed = await Effect.runPromise(
        Effect.gen(function* () {
          const installer = yield* PluginInstallerService;
          return yield* installer.pack(source, out);
        }).pipe(Effect.provide(PluginInstallerLayer)),
      );
      const expected = await hashPluginDirectory(source);
      expect(packed.integrity).toBe(expected);
      await expect(readFile(`${out}.meta.json`, 'utf8')).resolves.toContain(expected);
    }));
});

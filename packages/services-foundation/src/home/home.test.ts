import { lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { HomeService, HomeServiceLive } from './index.js';
import { withTempHome } from '../test-utils.js';

describe('HomeService', () => {
  it('initializes the home directory tree', () =>
    withTempHome(async (home) => {
      const paths = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* HomeService;
          return service.paths;
        }).pipe(Effect.provide(HomeServiceLive)),
      );

      expect(paths.root).toBe(home);
      await expect(lstat(paths.plugins)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(lstat(paths.assets)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(lstat(paths.projects)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(lstat(paths.cache)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(lstat(paths.logs)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    }));

  it('is idempotent when run more than once', () =>
    withTempHome(async () => {
      const paths = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* HomeService;
          const first = yield* service.init();
          const second = yield* service.init();
          return [first, second] as const;
        }).pipe(Effect.provide(HomeServiceLive)),
      );

      expect(paths[0]).toEqual(paths[1]);
    }));

  it('rejects a file at TILEBORNE_HOME', () =>
    withTempHome(async (home) => {
      const fileHome = path.join(home, 'not-a-directory');
      await writeFile(fileHome, 'not a directory');
      process.env['TILEBORNE_HOME'] = fileHome;

      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* HomeService;
            return yield* service.init();
          }).pipe(Effect.provide(HomeServiceLive)),
        ),
      ).rejects.toMatchObject({ _tag: 'HomeSecurityError' });
    }));

  it('rejects TILEBORNE_HOME when it is a symlink', () =>
    withTempHome(async (home) => {
      const target = await mkdtemp(path.join(tmpdir(), 'tileborne-home-target-'));
      const linkedHome = path.join(home, 'linked-home');
      await symlink(target, linkedHome, 'dir');
      process.env['TILEBORNE_HOME'] = linkedHome;

      try {
        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const service = yield* HomeService;
              return yield* service.init();
            }).pipe(Effect.provide(HomeServiceLive)),
          ),
        ).rejects.toMatchObject({ _tag: 'HomeSecurityError' });
      } finally {
        await rm(target, { recursive: true, force: true });
      }
    }));
});

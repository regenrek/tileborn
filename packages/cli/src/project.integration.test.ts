import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AppServicesLayer, ProjectService } from '@tileborne/services-app';
import { Effect, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

const PROJECT_MANIFEST_FILE = 'project.json';

const withTempHome = async <A>(run: (home: string) => Promise<A>): Promise<A> => {
  const previous = process.env['TILEBORNE_HOME'];
  const home = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-test-'));
  process.env['TILEBORNE_HOME'] = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env['TILEBORNE_HOME'];
    } else {
      process.env['TILEBORNE_HOME'] = previous;
    }
    await rm(home, { recursive: true, force: true });
  }
};

type AppRuntime = ReturnType<typeof ManagedRuntime.make<typeof AppServicesLayer>>;

describe('ProjectService integration', () => {
  let runtime: AppRuntime | undefined;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
      runtime = undefined;
    }
  });

  it('init creates a project under TILEBORNE_HOME/projects', async () => {
    await withTempHome(async (home) => {
      runtime = ManagedRuntime.make(AppServicesLayer);
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.init({ slug: 'demo-proj' });
        }),
      );
      expect(result.path).toBe(path.join(home, 'projects', 'demo-proj'));
      const raw = await readFile(path.join(result.path, PROJECT_MANIFEST_FILE), 'utf8');
      expect(raw).toContain('"name": "demo-proj"');
    });
  });

  it('init --here writes manifest in cwd', async () => {
    await withTempHome(async () => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-here-'));
      const previous = process.cwd();
      process.chdir(projectDir);
      runtime = ManagedRuntime.make(AppServicesLayer);
      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const projects = yield* ProjectService;
            return yield* projects.init({ slug: 'here-proj', here: true });
          }),
        );
        expect(result.path).toBe(projectDir);
        await expect(
          readFile(path.join(projectDir, PROJECT_MANIFEST_FILE), 'utf8'),
        ).resolves.toContain('here-proj');
      } finally {
        process.chdir(previous);
        await rm(projectDir, { recursive: true, force: true });
      }
    });
  });

  it('info reads an initialized project', async () => {
    await withTempHome(async () => {
      runtime = ManagedRuntime.make(AppServicesLayer);
      const created = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.init({ slug: 'info-proj' });
        }),
      );
      const info = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.info(created.path);
        }),
      );
      expect(info.manifest.name).toBe('info-proj');
      expect(info.entries).toContain(PROJECT_MANIFEST_FILE);
    });
  });

  it('upgrade reports unchanged schema at latest version', async () => {
    await withTempHome(async () => {
      runtime = ManagedRuntime.make(AppServicesLayer);
      const created = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.init({ slug: 'upgrade-proj' });
        }),
      );
      const upgraded = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.upgrade(created.path);
        }),
      );
      expect(upgraded.changed).toBe(false);
      expect(upgraded.toVersion).toBe(1);
    });
  });

  it('clean removes cache directories', async () => {
    await withTempHome(async () => {
      runtime = ManagedRuntime.make(AppServicesLayer);
      const created = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.init({ slug: 'clean-proj' });
        }),
      );
      const cleaned = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.clean(created.path);
        }),
      );
      expect(cleaned.removed.length).toBeGreaterThan(0);
    });
  });

  it('rejects invalid slugs', async () => {
    await withTempHome(async () => {
      runtime = ManagedRuntime.make(AppServicesLayer);
      const exit = await runtime.runPromiseExit(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.init({ slug: 'Bad_Slug' });
        }),
      );
      expect(exit._tag).toBe('Failure');
    });
  });
});

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectManifest } from '@tileborne/core';
import { Effect, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { AppServicesLayer } from '../index.js';
import {
  ProjectService,
  readProjectLock,
  readVerifiedProjectAtRoot,
  restoreProjectManifestBackupAtRoot,
  writeProjectWithLock,
} from './index.js';

const compatibilityFixtures = path.resolve(
  import.meta.dirname,
  '../../../test-fixtures/fixtures/projects/schema-compatibility',
);

type FixtureName = 'legacy-v0' | 'current-v1' | 'future-v2' | 'invalid-version' | 'corrupt';
type AppRuntime = ReturnType<typeof ManagedRuntime.make<typeof AppServicesLayer>>;

describe.sequential('project manifest durability fixtures', () => {
  let runtime: AppRuntime | undefined;
  let temporaryRoot: string | undefined;
  let previousHome: string | undefined;

  const stageFixture = async (name: FixtureName) => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-project-durability-'));
    const projectRoot = path.join(temporaryRoot, 'project');
    const home = path.join(temporaryRoot, 'home');
    await mkdir(projectRoot, { recursive: true });
    const raw = await readFile(path.join(compatibilityFixtures, name, 'project.json'), 'utf8');
    await writeFile(path.join(projectRoot, 'project.json'), raw, 'utf8');
    previousHome = process.env['TILEBORNE_HOME'];
    process.env['TILEBORNE_HOME'] = home;
    runtime = ManagedRuntime.make(AppServicesLayer);
    return { projectRoot, raw };
  };

  const upgrade = (projectRoot: string) =>
    runtime!.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService;
        return yield* projects.upgrade(projectRoot);
      }),
    );

  afterEach(async () => {
    await runtime?.dispose();
    runtime = undefined;
    if (previousHome === undefined) {
      delete process.env['TILEBORNE_HOME'];
    } else {
      process.env['TILEBORNE_HOME'] = previousHome;
    }
    previousHome = undefined;
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { recursive: true, force: true });
      temporaryRoot = undefined;
    }
  });

  it('backs up exact legacy bytes before ordered v0→v1 migration and verifies restore', async () => {
    const { projectRoot, raw } = await stageFixture('legacy-v0');
    const result = await upgrade(projectRoot);

    expect(result).toMatchObject({ changed: true, fromVersion: 0, toVersion: 1 });
    expect(result.backupPath).toMatch(
      /^\.tileborne\/backups\/project-manifest\/project-v0-[a-f0-9]{64}\.json$/,
    );
    const backupPath = result.backupPath!;
    await expect(readFile(path.join(projectRoot, backupPath), 'utf8')).resolves.toBe(raw);

    const migratedRaw = await readFile(path.join(projectRoot, 'project.json'), 'utf8');
    const migrated = JSON.parse(migratedRaw) as Record<string, unknown>;
    expect(migrated['schemaVersion']).toBe(1);
    expect(migrated['settings']).toEqual({ migrationSentinel: 'preserve-legacy-source' });
    await expect(Effect.runPromise(readVerifiedProjectAtRoot(projectRoot))).resolves.toMatchObject({
      schemaVersion: 1,
      name: 'Legacy Project',
    });

    await Effect.runPromise(restoreProjectManifestBackupAtRoot(projectRoot, backupPath));
    await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(raw);
    await expect(Effect.runPromise(readVerifiedProjectAtRoot(projectRoot))).resolves.toMatchObject({
      schemaVersion: 1,
      name: 'Legacy Project',
    });

    const repeated = await upgrade(projectRoot);
    expect(repeated.backupPath).toBe(backupPath);
    await expect(readFile(path.join(projectRoot, backupPath), 'utf8')).resolves.toBe(raw);
  });

  it('leaves the committed current fixture byte-for-byte unchanged without a backup', async () => {
    const { projectRoot, raw } = await stageFixture('current-v1');
    const result = await upgrade(projectRoot);

    expect(result).toMatchObject({ changed: false, fromVersion: 1, toVersion: 1 });
    expect(result.backupPath).toBeUndefined();
    await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(raw);
    await expect(access(path.join(projectRoot, '.tileborne/backups'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['future-v2' as const, 'ProjectMigrationError'],
    ['invalid-version' as const, 'ProjectMigrationError'],
    ['corrupt' as const, 'ProjectValidationError'],
  ])('refuses the committed %s fixture without source loss', async (fixture, errorTag) => {
    const { projectRoot, raw } = await stageFixture(fixture);

    await expect(upgrade(projectRoot)).rejects.toMatchObject({ _tag: errorTag });
    await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(raw);
    await expect(access(path.join(projectRoot, '.tileborne/backups'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([null, -1, 1.5, true, {}, []])(
    'refuses explicit invalid schemaVersion %j without bytes or backup side effects',
    async (schemaVersion) => {
      const { projectRoot, raw } = await stageFixture('invalid-version');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const adversarialRaw = `${JSON.stringify({ ...parsed, schemaVersion }, null, 2)}\n`;
      await writeFile(path.join(projectRoot, 'project.json'), adversarialRaw, 'utf8');

      await expect(upgrade(projectRoot)).rejects.toMatchObject({
        _tag: 'ProjectMigrationError',
      });
      await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(
        adversarialRaw,
      );
      await expect(access(path.join(projectRoot, '.tileborne/backups'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('refuses restore traversal without touching the project or outside bytes', async () => {
    const { projectRoot } = await stageFixture('legacy-v0');
    await upgrade(projectRoot);
    const migratedRaw = await readFile(path.join(projectRoot, 'project.json'), 'utf8');
    const outside = path.join(path.dirname(projectRoot), 'outside.json');
    await writeFile(outside, 'outside-sentinel', 'utf8');

    await expect(
      Effect.runPromise(restoreProjectManifestBackupAtRoot(projectRoot, '../outside.json')),
    ).rejects.toMatchObject({ _tag: 'ProjectMigrationError' });
    await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(
      migratedRaw,
    );
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside-sentinel');
  });

  it('refuses a modified backup without touching migrated source bytes', async () => {
    const { projectRoot } = await stageFixture('legacy-v0');
    const result = await upgrade(projectRoot);
    const migratedRaw = await readFile(path.join(projectRoot, 'project.json'), 'utf8');
    await writeFile(
      path.join(projectRoot, result.backupPath!),
      migratedRaw.replace('Legacy Project', 'Tampered Project'),
      'utf8',
    );

    await expect(
      Effect.runPromise(restoreProjectManifestBackupAtRoot(projectRoot, result.backupPath!)),
    ).rejects.toMatchObject({ _tag: 'ProjectMigrationError' });
    await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(
      migratedRaw,
    );
  });

  it('restores manifest and matching integrity lock after a legitimate post-upgrade edit', async () => {
    const { projectRoot, raw } = await stageFixture('legacy-v0');
    const result = await upgrade(projectRoot);
    const upgraded = await Effect.runPromise(readVerifiedProjectAtRoot(projectRoot));
    const currentLock = await Effect.runPromise(
      readProjectLock(path.join(projectRoot, 'project.lock.json')),
    );
    const edited = new ProjectManifest({ ...upgraded, name: 'Edited After Upgrade' });
    await Effect.runPromise(writeProjectWithLock(projectRoot, edited, currentLock.maps));
    await expect(Effect.runPromise(readVerifiedProjectAtRoot(projectRoot))).resolves.toMatchObject({
      name: 'Edited After Upgrade',
    });

    await Effect.runPromise(restoreProjectManifestBackupAtRoot(projectRoot, result.backupPath!));

    await expect(readFile(path.join(projectRoot, 'project.json'), 'utf8')).resolves.toBe(raw);
    await expect(Effect.runPromise(readVerifiedProjectAtRoot(projectRoot))).resolves.toMatchObject({
      name: 'Legacy Project',
      schemaVersion: 1,
    });
  });
});

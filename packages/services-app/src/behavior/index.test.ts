import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BehaviorInvocation,
  NestedBehaviorReference,
  ProjectId,
  ReferenceBehaviorValue,
} from '@tileborne/core';
import { Effect, Fiber, Layer, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { FoundationLayer } from '@tileborne/services-foundation';

import { ServicesAppLayer } from '../index.js';
import { ProjectService, ProjectServiceLive } from '../project/index.js';
import { withTempHome } from '../test-utils.js';
import {
  ProjectBehaviorInUseError,
  ProjectBehaviorRevisionConflictError,
  ProjectBehaviorService,
  type ProjectBehaviorServiceError,
  ProjectBehaviorTransactionError,
  makeProjectBehaviorServiceLive,
  type ProjectBehaviorPersistenceOperations,
} from './index.js';

const appLayer = ServicesAppLayer;

const runApp = <A, E>(effect: Effect.Effect<A, E, ProjectService | ProjectBehaviorService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(appLayer)));

const writeTextForTest = async (filePath: string, contents: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.behavior-test-tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, filePath);
};

const transactionPathFor = (home: string, projectId: ProjectId): string =>
  path.join(home, 'projects', projectId, '.tileborne', 'behavior-resource-transaction.json');

const registryPathFor = (home: string, projectId: ProjectId): string =>
  path.join(home, 'projects', projectId, 'behaviors', 'registry.json');

interface TestTransactionRegistry {
  schemaVersion: number;
  projectId: string;
  revision: number;
  trust: string;
  entries: Array<Record<string, unknown>>;
}

interface TestTransactionJournal {
  schemaVersion: number;
  transactionId: string;
  projectId: string;
  operation: string;
  behaviorId: string;
  sourceKind: string;
  sourcePath: string;
  baseRevision: number;
  baseRegistryHash: string;
  baseSourceExists: boolean;
  baseSourceHash: string;
  nextRegistryHash: string;
  nextSourceHash: string;
  nextSource: string | null;
  baseRegistry: TestTransactionRegistry;
  nextRegistry: TestTransactionRegistry;
}

const testContentHash = (contents: string): string =>
  `sha256:${createHash('sha256').update(contents).digest('hex')}`;

const testRegistryHash = (registry: TestTransactionRegistry): string =>
  testContentHash(`${JSON.stringify(registry, null, 2)}\n`);

const testSourceHash = (source: string | null): string =>
  testContentHash(source === null ? 'removed\0' : `present\0${source}`);

const cloneTestJournal = (journal: TestTransactionJournal): TestTransactionJournal =>
  structuredClone(journal);

const makePendingSaveJournal = async (
  home: string,
  projectId: ProjectId,
  behaviorId: Parameters<ProjectBehaviorService['saveTypeScript']>[0]['behaviorId'],
  expectedRevision: number,
  marker: string,
): Promise<Record<string, unknown>> => {
  const operations: ProjectBehaviorPersistenceOperations = {
    writeTextAtomic: async (filePath, contents) => {
      if (filePath.includes(path.join('behaviors', 'sources')) && contents.includes(marker)) {
        throw new Error('leave transaction pending for recovery test');
      }
      await writeTextForTest(filePath, contents);
    },
    removeFile: (filePath) => rm(filePath, { force: true }),
  };
  const layer = Layer.mergeAll(ProjectServiceLive, makeProjectBehaviorServiceLive(operations)).pipe(
    Layer.provideMerge(FoundationLayer),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const behaviors = yield* ProjectBehaviorService;
      return yield* Effect.result(
        behaviors.saveTypeScript({
          projectId,
          behaviorId,
          expectedRevision,
          label: 'Pending recovery',
          source: `export default ${JSON.stringify(marker)};\n`,
        }),
      );
    }).pipe(Effect.provide(layer)),
  );
  expect(result).toMatchObject({
    _tag: 'Failure',
    failure: { _tag: 'ProjectBehaviorTransactionError' },
  });
  return JSON.parse(await readFile(transactionPathFor(home, projectId), 'utf8')) as Record<
    string,
    unknown
  >;
};

describe('ProjectBehaviorService', () => {
  it('serializes concurrent same-revision saves with exactly one winner', () =>
    withTempHome(async () => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Concurrent Behaviors' });
          const created = yield* behaviors.createTypeScript(projectId, {
            label: 'Counter',
            source: 'export default "initial";\n',
          });
          const behavior = created.resources[0];
          if (behavior === undefined) throw new Error('behavior was not created');
          const saves = yield* Effect.all(
            [
              Effect.result(
                behaviors.saveTypeScript({
                  projectId,
                  behaviorId: behavior.manifest.id,
                  expectedRevision: created.revision,
                  label: 'Winner A',
                  source: 'export default "winner-a";\n',
                }),
              ),
              Effect.result(
                behaviors.saveTypeScript({
                  projectId,
                  behaviorId: behavior.manifest.id,
                  expectedRevision: created.revision,
                  label: 'Winner B',
                  source: 'export default "winner-b";\n',
                }),
              ),
            ],
            { concurrency: 2 },
          );
          return { saves, reopened: yield* behaviors.open(projectId) };
        }),
      );

      expect(result.saves.filter((save) => save._tag === 'Success')).toHaveLength(1);
      const failures = result.saves.filter((save) => save._tag === 'Failure');
      expect(failures).toHaveLength(1);
      expect(failures[0]?._tag === 'Failure' ? failures[0].failure : undefined).toBeInstanceOf(
        ProjectBehaviorRevisionConflictError,
      );
      expect(result.reopened.revision).toBe(2);
      const reopened = result.reopened.resources[0];
      expect(reopened?.kind).toBe('typescript');
      if (reopened?.kind === 'typescript') {
        expect(['export default "winner-a";\n', 'export default "winner-b";\n']).toContain(
          reopened.source,
        );
      }
    }));

  it('retains a shared gate while waiters exist and cleans it after interruption', () =>
    withTempHome(async () => {
      let releaseBlockedWrite: (() => void) | undefined;
      let signalBlockedWrite: (() => void) | undefined;
      const blockedWriteEntered = new Promise<void>((resolve) => {
        signalBlockedWrite = resolve;
      });
      const blockedWriteReleased = new Promise<void>((resolve) => {
        releaseBlockedWrite = resolve;
      });
      const gateCounts: number[] = [];
      const operations: ProjectBehaviorPersistenceOperations = {
        writeTextAtomic: async (filePath, contents) => {
          if (
            filePath.includes(path.join('behaviors', 'sources')) &&
            contents.includes('blocked-writer')
          ) {
            signalBlockedWrite?.();
            await blockedWriteReleased;
          }
          await mkdir(path.dirname(filePath), { recursive: true });
          const temporary = `${filePath}.gate-test-tmp`;
          await writeFile(temporary, contents, 'utf8');
          await rename(temporary, filePath);
        },
        removeFile: (filePath) => rm(filePath, { force: true }),
        onProjectGateCountChanged: (count) => gateCounts.push(count),
      };
      const layer = Layer.mergeAll(
        ProjectServiceLive,
        makeProjectBehaviorServiceLive(operations),
      ).pipe(Layer.provideMerge(FoundationLayer));
      const reopened = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Gate Lifecycle' });
          const created = yield* behaviors.createTypeScript(projectId, {
            label: 'Gate',
            source: 'export default "initial";\n',
          });
          const behavior = created.resources[0];
          if (behavior === undefined) throw new Error('behavior was not created');
          const first = yield* behaviors
            .saveTypeScript({
              projectId,
              behaviorId: behavior.manifest.id,
              expectedRevision: created.revision,
              label: 'First',
              source: 'export default "blocked-writer";\n',
            })
            .pipe(Effect.forkChild);
          yield* Effect.promise(() => blockedWriteEntered);
          const waiter = yield* behaviors
            .saveTypeScript({
              projectId,
              behaviorId: behavior.manifest.id,
              expectedRevision: created.revision,
              label: 'Interrupted waiter',
              source: 'export default "waiter";\n',
            })
            .pipe(Effect.forkChild);
          yield* Fiber.interrupt(waiter);
          releaseBlockedWrite?.();
          yield* Fiber.join(first);
          return yield* behaviors.open(projectId);
        }).pipe(Effect.provide(layer)),
      );

      expect(reopened.resources[0]).toMatchObject({
        kind: 'typescript',
        source: 'export default "blocked-writer";\n',
      });
      expect(gateCounts.at(-1)).toBe(0);
      expect(Math.max(...gateCounts)).toBe(1);
    }));

  it('recovers create, save, and remove after primary plus recovery failures and restart', () =>
    withTempHome(async (home) => {
      let mode: 'create' | 'save' | 'remove' | undefined;
      let primaryFailed = false;
      let recoveryFailed = false;
      const gateCounts: number[] = [];
      const operations: ProjectBehaviorPersistenceOperations = {
        writeTextAtomic: async (filePath, contents) => {
          if (
            filePath.endsWith(path.join('behaviors', 'registry.json')) &&
            mode !== undefined &&
            !primaryFailed
          ) {
            primaryFailed = true;
            throw new Error(`primary ${mode} registry failure`);
          }
          if (
            filePath.endsWith(path.join('behaviors', 'registry.json')) &&
            mode !== undefined &&
            primaryFailed &&
            !recoveryFailed
          ) {
            recoveryFailed = true;
            throw new Error(`recovery ${mode} registry failure`);
          }
          await mkdir(path.dirname(filePath), { recursive: true });
          const temporary = `${filePath}.test-tmp`;
          await writeFile(temporary, contents, 'utf8');
          await rename(temporary, filePath);
        },
        removeFile: async (filePath) => {
          await rm(filePath, { force: true });
        },
        onProjectGateCountChanged: (count) => gateCounts.push(count),
      };
      const layer = Layer.mergeAll(
        ProjectServiceLive,
        makeProjectBehaviorServiceLive(operations),
      ).pipe(Layer.provideMerge(FoundationLayer));
      const runFault = <A, E>(
        effect: Effect.Effect<A, E, ProjectService | ProjectBehaviorService>,
      ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
      const projectId = await runFault(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          return yield* projects.create({ name: 'Durable Behaviors' });
        }),
      );

      const expectDoubleFailure = (result: Result.Result<unknown, ProjectBehaviorServiceError>) => {
        expect(result).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'ProjectBehaviorTransactionError' },
        });
        if (result._tag === 'Failure') {
          expect(result.failure).toBeInstanceOf(ProjectBehaviorTransactionError);
          expect(String(result.failure.primaryMessage)).toContain('primary');
          expect(String(result.failure.recoveryMessage)).toContain('recovery');
        }
      };

      mode = 'create';
      primaryFailed = false;
      recoveryFailed = false;
      const failedCreate = await runFault(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(
            behaviors.createTypeScript(projectId, {
              label: 'Created durably',
              source: 'export default "created";\n',
            }),
          );
        }),
      );
      expectDoubleFailure(failedCreate);
      mode = undefined;
      const afterCreate = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(projectId);
        }),
      );
      expect(afterCreate.resources).toHaveLength(1);
      const behavior = afterCreate.resources[0];
      if (behavior === undefined) throw new Error('create recovery lost behavior');

      mode = 'save';
      primaryFailed = false;
      recoveryFailed = false;
      const failedSave = await runFault(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(
            behaviors.saveTypeScript({
              projectId,
              behaviorId: behavior.manifest.id,
              expectedRevision: afterCreate.revision,
              label: 'Saved durably',
              source: 'export default "saved";\n',
            }),
          );
        }),
      );
      expectDoubleFailure(failedSave);
      mode = undefined;
      const afterSave = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(projectId);
        }),
      );
      expect(afterSave.resources[0]).toMatchObject({
        kind: 'typescript',
        source: 'export default "saved";\n',
      });

      mode = 'remove';
      primaryFailed = false;
      recoveryFailed = false;
      const failedRemove = await runFault(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(
            behaviors.remove(projectId, behavior.manifest.id, afterSave.revision),
          );
        }),
      );
      expectDoubleFailure(failedRemove);
      mode = undefined;
      const afterRemove = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(projectId);
        }),
      );
      expect(afterRemove.resources).toHaveLength(0);
      expect(
        await readdir(path.join(home, 'projects', projectId, 'behaviors', 'sources')),
      ).toHaveLength(0);
      expect(gateCounts.at(-1)).toBe(0);
      expect(Math.max(...gateCounts)).toBe(1);
    }));

  it('quarantines traversal and malformed journals before source or registry mutation', () =>
    withTempHome(async (home) => {
      const created = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Adversarial Recovery' });
          const snapshot = yield* behaviors.createTypeScript(projectId, {
            label: 'Safe',
            source: 'export default "safe";\n',
          });
          return { projectId, snapshot };
        }),
      );
      const behavior = created.snapshot.resources[0];
      if (behavior === undefined) throw new Error('missing behavior');
      const sourcePath =
        behavior.manifest.source._tag === 'typescript'
          ? behavior.manifest.source.sourcePath
          : 'unexpected';
      const sourceFile = path.join(home, 'projects', created.projectId, sourcePath);
      const projectFile = path.join(home, 'projects', created.projectId, 'project.json');
      const registryFile = registryPathFor(home, created.projectId);
      const journalFile = transactionPathFor(home, created.projectId);
      const originalSource = await readFile(sourceFile, 'utf8');
      const originalProject = await readFile(projectFile, 'utf8');
      const originalRegistry = await readFile(registryFile, 'utf8');
      const valid = await makePendingSaveJournal(
        home,
        created.projectId,
        behavior.manifest.id,
        created.snapshot.revision,
        'pending-traversal',
      );

      await writeFile(
        journalFile,
        `${JSON.stringify(
          {
            ...valid,
            sourcePath: 'behaviors/sources/../../project.json',
          },
          null,
          2,
        )}\n`,
      );
      const traversal = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(behaviors.open(created.projectId));
        }),
      );
      expect(traversal).toMatchObject({
        _tag: 'Failure',
        failure: { message: expect.stringContaining('quarantined') },
      });
      expect(await readFile(projectFile, 'utf8')).toBe(originalProject);
      expect(await readFile(sourceFile, 'utf8')).toBe(originalSource);
      expect(await readFile(registryFile, 'utf8')).toBe(originalRegistry);

      await writeFile(
        journalFile,
        `${JSON.stringify(
          {
            ...valid,
            nextRegistry: { schemaVersion: 1, projectId: created.projectId },
          },
          null,
          2,
        )}\n`,
      );
      const malformed = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(behaviors.open(created.projectId));
        }),
      );
      expect(malformed).toMatchObject({
        _tag: 'Failure',
        failure: { message: expect.stringContaining('quarantined') },
      });
      expect(await readFile(sourceFile, 'utf8')).toBe(originalSource);
      expect(await readFile(registryFile, 'utf8')).toBe(originalRegistry);
      const quarantines = (await readdir(path.dirname(journalFile))).filter((name) =>
        name.includes('.quarantine-'),
      );
      expect(quarantines).toHaveLength(2);
    }));

  it('prevalidates the complete adversarial journal matrix before any project mutation', () =>
    withTempHome(async (home) => {
      const setup = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Journal Validation Matrix' });
          const withScript = yield* behaviors.createTypeScript(projectId, {
            label: 'Script matrix',
            source: 'export default "matrix-base";\n',
          });
          const script = withScript.resources[0];
          if (script === undefined || script.kind !== 'typescript')
            throw new Error('missing script');
          const withVisual = yield* behaviors.createVisual(projectId, {
            label: 'Visual matrix',
            definition: {
              state: [],
              when: new BehaviorInvocation({ entryId: 'world.interacted', arguments: {} }),
              do: [],
            },
          });
          const visual = withVisual.resources.find((resource) => resource.kind === 'visual');
          if (visual === undefined) throw new Error('missing visual behavior');
          return { projectId, snapshot: withVisual, script, visual };
        }),
      );
      const journalFile = transactionPathFor(home, setup.projectId);
      const typeScriptTemplate = (await makePendingSaveJournal(
        home,
        setup.projectId,
        setup.script.manifest.id,
        setup.snapshot.revision,
        'matrix-typescript-pending',
      )) as unknown as TestTransactionJournal;
      await rm(journalFile, { force: true });

      const visualMarker = 'matrix-visual-pending';
      const visualOperations: ProjectBehaviorPersistenceOperations = {
        writeTextAtomic: async (filePath, contents) => {
          if (
            filePath.includes(path.join('behaviors', 'sources')) &&
            contents.includes(visualMarker)
          ) {
            throw new Error('leave visual transaction pending for validation matrix');
          }
          await writeTextForTest(filePath, contents);
        },
        removeFile: (filePath) => rm(filePath, { force: true }),
      };
      const visualLayer = Layer.mergeAll(
        ProjectServiceLive,
        makeProjectBehaviorServiceLive(visualOperations),
      ).pipe(Layer.provideMerge(FoundationLayer));
      const visualPending = await Effect.runPromise(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(
            behaviors.saveVisual({
              projectId: setup.projectId,
              behaviorId: setup.visual.manifest.id,
              expectedRevision: setup.snapshot.revision,
              label: visualMarker,
              definition: setup.visual.definition,
            }),
          );
        }).pipe(Effect.provide(visualLayer)),
      );
      expect(visualPending).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ProjectBehaviorTransactionError' },
      });
      const visualTemplate = JSON.parse(
        await readFile(journalFile, 'utf8'),
      ) as TestTransactionJournal;
      await rm(journalFile, { force: true });

      interface AdversarialCase {
        readonly name: string;
        readonly template?: 'typescript' | 'visual';
        readonly raw?: string;
        readonly mutate?: (journal: TestTransactionJournal) => void;
        readonly expected: string;
      }
      const cases: readonly AdversarialCase[] = [
        {
          name: 'syntactically invalid JSON',
          raw: '{"schemaVersion":',
          expected: 'invalid behavior transaction quarantined',
        },
        {
          name: 'unsupported journal schema version',
          mutate: (journal) => {
            journal.schemaVersion = 99;
          },
          expected: 'invalid behavior transaction journal payload',
        },
        {
          name: 'wrong journal project id',
          mutate: (journal) => {
            journal.projectId = `project:${randomUUID()}`;
          },
          expected: 'invalid behavior transaction journal payload',
        },
        {
          name: 'traversal source path',
          mutate: (journal) => {
            journal.sourcePath = 'behaviors/sources/../../project.json';
          },
          expected: 'source path is not canonical',
        },
        {
          name: 'behavior id absent from update manifests',
          mutate: (journal) => {
            const id = randomUUID();
            journal.behaviorId = `behavior:${id}`;
            journal.sourcePath = `behaviors/sources/${id}.ts`;
          },
          expected: 'operation does not match registry transition',
        },
        {
          name: 'operation-to-manifest mismatch',
          mutate: (journal) => {
            journal.operation = 'create';
          },
          expected: 'operation does not match registry transition',
        },
        {
          name: 'source kind-to-manifest mismatch',
          mutate: (journal) => {
            journal.sourceKind = 'visual';
            journal.sourcePath = `behaviors/sources/${journal.behaviorId.slice('behavior:'.length)}.behavior.json`;
          },
          expected: 'source kind does not match manifest',
        },
        {
          name: 'invalid revision transition with authenticated registry hash',
          mutate: (journal) => {
            journal.nextRegistry.revision = journal.baseRevision + 2;
            journal.nextRegistryHash = testRegistryHash(journal.nextRegistry);
          },
          expected: 'revision transition is invalid',
        },
        {
          name: 'source content hash mismatch',
          mutate: (journal) => {
            journal.nextSourceHash = `sha256:${'0'.repeat(64)}`;
          },
          expected: 'content hash mismatch',
        },
        {
          name: 'malformed registry schema',
          mutate: (journal) => {
            (journal.nextRegistry as unknown as { entries: unknown }).entries = 'not-an-array';
          },
          expected: 'invalid behavior transaction quarantined',
        },
        {
          name: 'registry project mismatch with authenticated hash',
          mutate: (journal) => {
            journal.nextRegistry.projectId = `project:${randomUUID()}`;
            journal.nextRegistryHash = testRegistryHash(journal.nextRegistry);
          },
          expected: 'registry project mismatch',
        },
        {
          name: 'duplicate registry behavior with authenticated hash',
          mutate: (journal) => {
            const target = journal.nextRegistry.entries.find(
              (entry) => entry.id === journal.behaviorId,
            );
            if (target === undefined) throw new Error('missing target manifest');
            journal.nextRegistry.entries.push(structuredClone(target));
            journal.nextRegistryHash = testRegistryHash(journal.nextRegistry);
          },
          expected: 'duplicate behavior ids',
        },
        {
          name: 'visual payload id mismatch with authenticated source hash',
          template: 'visual',
          mutate: (journal) => {
            if (journal.nextSource === null) throw new Error('missing visual payload');
            const definition = JSON.parse(journal.nextSource) as Record<string, unknown>;
            definition.id = `behavior:${randomUUID()}`;
            journal.nextSource = `${JSON.stringify(definition, null, 2)}\n`;
            journal.nextSourceHash = testSourceHash(journal.nextSource);
          },
          expected: 'visual behavior transaction source id mismatch',
        },
      ];

      const projectFile = path.join(home, 'projects', setup.projectId, 'project.json');
      const registryFile = registryPathFor(home, setup.projectId);
      const scriptFile = path.join(
        home,
        'projects',
        setup.projectId,
        setup.script.manifest.source.sourcePath,
      );
      const visualFile = path.join(
        home,
        'projects',
        setup.projectId,
        setup.visual.manifest.source.definitionPath,
      );
      const stableBytes = {
        project: await readFile(projectFile, 'utf8'),
        registry: await readFile(registryFile, 'utf8'),
        script: await readFile(scriptFile, 'utf8'),
        visual: await readFile(visualFile, 'utf8'),
      };

      for (const scenario of cases) {
        const beforeQuarantines = (await readdir(path.dirname(journalFile))).filter((name) =>
          name.includes('.quarantine-'),
        ).length;
        let raw = scenario.raw;
        if (raw === undefined) {
          const template = scenario.template === 'visual' ? visualTemplate : typeScriptTemplate;
          const journal = cloneTestJournal(template);
          journal.transactionId = randomUUID();
          scenario.mutate?.(journal);
          raw = `${JSON.stringify(journal, null, 2)}\n`;
        }
        await writeFile(journalFile, raw);
        const recovery = await runApp(
          Effect.gen(function* () {
            const behaviors = yield* ProjectBehaviorService;
            return yield* Effect.result(behaviors.open(setup.projectId));
          }),
        );
        expect(recovery._tag, scenario.name).toBe('Failure');
        if (recovery._tag === 'Failure') {
          expect(recovery.failure.message, scenario.name).toContain(scenario.expected);
        }
        expect(await readFile(projectFile, 'utf8'), scenario.name).toBe(stableBytes.project);
        expect(await readFile(registryFile, 'utf8'), scenario.name).toBe(stableBytes.registry);
        expect(await readFile(scriptFile, 'utf8'), scenario.name).toBe(stableBytes.script);
        expect(await readFile(visualFile, 'utf8'), scenario.name).toBe(stableBytes.visual);
        const afterNames = await readdir(path.dirname(journalFile));
        expect(afterNames, scenario.name).not.toContain(path.basename(journalFile));
        expect(
          afterNames.filter((name) => name.includes('.quarantine-')).length,
          scenario.name,
        ).toBe(beforeQuarantines + 1);
      }
    }));

  it.each(['create', 'update', 'remove'] as const)(
    'quarantines a %s journal when the base source changed independently',
    (operation) =>
      withTempHome(async (home) => {
        const setup = await runApp(
          Effect.gen(function* () {
            const projects = yield* ProjectService;
            const behaviors = yield* ProjectBehaviorService;
            const projectId = yield* projects.create({ name: `Base Source ${operation}` });
            if (operation === 'create') {
              return { projectId, snapshot: yield* behaviors.open(projectId) };
            }
            return {
              projectId,
              snapshot: yield* behaviors.createTypeScript(projectId, {
                label: 'Existing',
                source: 'export default "base-source";\n',
              }),
            };
          }),
        );
        const existing = setup.snapshot.resources[0];
        if (operation !== 'create' && (existing === undefined || existing.kind !== 'typescript')) {
          throw new Error('missing existing TypeScript behavior');
        }
        if (operation === 'create') {
          await writeTextForTest(
            registryPathFor(home, setup.projectId),
            `${JSON.stringify(
              {
                schemaVersion: 1,
                projectId: setup.projectId,
                revision: 0,
                trust: 'trusted',
                entries: [],
              },
              null,
              2,
            )}\n`,
          );
        }
        const marker = `pending-base-${operation}`;
        const operations: ProjectBehaviorPersistenceOperations = {
          writeTextAtomic: async (filePath, contents) => {
            if (
              operation !== 'remove' &&
              filePath.includes(path.join('behaviors', 'sources')) &&
              contents.includes(marker)
            ) {
              throw new Error(`leave ${operation} transaction pending`);
            }
            await writeTextForTest(filePath, contents);
          },
          removeFile: async (filePath) => {
            if (operation === 'remove' && filePath.includes(path.join('behaviors', 'sources'))) {
              throw new Error('leave remove transaction pending');
            }
            await rm(filePath, { force: true });
          },
        };
        const layer = Layer.mergeAll(
          ProjectServiceLive,
          makeProjectBehaviorServiceLive(operations),
        ).pipe(Layer.provideMerge(FoundationLayer));
        const pending = await Effect.runPromise(
          Effect.gen(function* () {
            const behaviors = yield* ProjectBehaviorService;
            if (operation === 'create') {
              return yield* Effect.result(
                behaviors.createTypeScript(setup.projectId, {
                  label: 'Pending create',
                  source: `export default "${marker}";\n`,
                }),
              );
            }
            if (existing === undefined) throw new Error('missing existing behavior');
            if (operation === 'update') {
              return yield* Effect.result(
                behaviors.saveTypeScript({
                  projectId: setup.projectId,
                  behaviorId: existing.manifest.id,
                  expectedRevision: setup.snapshot.revision,
                  label: 'Pending update',
                  source: `export default "${marker}";\n`,
                }),
              );
            }
            return yield* Effect.result(
              behaviors.remove(setup.projectId, existing.manifest.id, setup.snapshot.revision),
            );
          }).pipe(Effect.provide(layer)),
        );
        expect(pending).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'ProjectBehaviorTransactionError' },
        });

        const journalFile = transactionPathFor(home, setup.projectId);
        const journal = JSON.parse(await readFile(journalFile, 'utf8')) as { sourcePath: string };
        const sourceFile = path.join(home, 'projects', setup.projectId, journal.sourcePath);
        await writeTextForTest(sourceFile, `export default "external-${operation}-conflict";\n`);
        const sourceBeforeRecovery = await readFile(sourceFile, 'utf8');
        const registryFile = registryPathFor(home, setup.projectId);
        const registryBeforeRecovery = await readFile(registryFile, 'utf8');

        const recovery = await runApp(
          Effect.gen(function* () {
            const behaviors = yield* ProjectBehaviorService;
            return yield* Effect.result(behaviors.open(setup.projectId));
          }),
        );
        expect(recovery).toMatchObject({
          _tag: 'Failure',
          failure: { message: expect.stringContaining('base source mismatch') },
        });
        expect(await readFile(sourceFile, 'utf8')).toBe(sourceBeforeRecovery);
        expect(await readFile(registryFile, 'utf8')).toBe(registryBeforeRecovery);
        expect(
          (await readdir(path.dirname(journalFile))).some((name) => name.includes('.quarantine-')),
        ).toBe(true);
      }),
  );

  it('uses authenticated base/next/newer recovery states without stale rollback', () =>
    withTempHome(async (home) => {
      const created = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'State Recovery' });
          const snapshot = yield* behaviors.createTypeScript(projectId, {
            label: 'Stateful',
            source: 'export default "base";\n',
          });
          return { projectId, snapshot };
        }),
      );
      const behavior = created.snapshot.resources[0];
      if (behavior === undefined || behavior.kind !== 'typescript')
        throw new Error('missing TypeScript behavior');
      const journalFile = transactionPathFor(home, created.projectId);
      const sourceFile = path.join(
        home,
        'projects',
        created.projectId,
        behavior.manifest.source.sourcePath,
      );
      const registryFile = registryPathFor(home, created.projectId);
      const pending = await makePendingSaveJournal(
        home,
        created.projectId,
        behavior.manifest.id,
        created.snapshot.revision,
        'pending-state',
      );
      const pendingText = `${JSON.stringify(pending, null, 2)}\n`;

      // Registry already at next + matching source means only idempotent journal cleanup remains.
      await writeFile(sourceFile, pending.nextSource as string);
      await writeFile(registryFile, `${JSON.stringify(pending.nextRegistry, null, 2)}\n`);
      const nextState = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(created.projectId);
        }),
      );
      expect(nextState.revision).toBe(created.snapshot.revision + 1);
      expect(nextState.resources[0]).toMatchObject({
        source: expect.stringContaining('pending-state'),
      });
      expect(await readdir(path.dirname(journalFile))).not.toContain(path.basename(journalFile));

      const newer = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.saveTypeScript({
            projectId: created.projectId,
            behaviorId: behavior.manifest.id,
            expectedRevision: nextState.revision,
            label: 'Newer',
            source: 'export default "newer";\n',
          });
        }),
      );
      await writeFile(journalFile, pendingText);
      const stale = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(behaviors.open(created.projectId));
        }),
      );
      expect(stale).toMatchObject({
        _tag: 'Failure',
        failure: { message: expect.stringContaining('stale behavior transaction quarantined') },
      });
      expect(JSON.parse(await readFile(registryFile, 'utf8'))).toMatchObject({
        revision: newer.revision,
      });
      expect(await readFile(sourceFile, 'utf8')).toBe('export default "newer";\n');
      const afterQuarantine = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(created.projectId);
        }),
      );
      expect(afterQuarantine.revision).toBe(newer.revision);
    }));

  it('serializes recovery across fresh service layers and durably syncs removals', () =>
    withTempHome(async (home) => {
      const created = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Fresh Service Recovery' });
          const snapshot = yield* behaviors.createTypeScript(projectId, {
            label: 'Fresh',
            source: 'export default "base";\n',
          });
          return { projectId, snapshot };
        }),
      );
      const behavior = created.snapshot.resources[0];
      if (behavior === undefined) throw new Error('missing behavior');
      await makePendingSaveJournal(
        home,
        created.projectId,
        behavior.manifest.id,
        created.snapshot.revision,
        'fresh-recovery',
      );

      const synced: string[] = [];
      const operations: ProjectBehaviorPersistenceOperations = {
        writeTextAtomic: writeTextForTest,
        removeFile: (filePath) => rm(filePath, { force: true }),
        syncDirectory: async (directoryPath) => {
          synced.push(directoryPath);
        },
      };
      const makeFreshLayer = () =>
        Layer.mergeAll(ProjectServiceLive, makeProjectBehaviorServiceLive(operations)).pipe(
          Layer.provideMerge(FoundationLayer),
        );
      const openWith = (layer: ReturnType<typeof makeFreshLayer>) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const behaviors = yield* ProjectBehaviorService;
            return yield* behaviors.open(created.projectId);
          }).pipe(Effect.provide(layer)),
        );
      const [first, second] = await Promise.all([
        openWith(makeFreshLayer()),
        openWith(makeFreshLayer()),
      ]);
      expect(first.revision).toBe(created.snapshot.revision + 1);
      expect(second.revision).toBe(first.revision);

      const removed = await Effect.runPromise(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.remove(created.projectId, behavior.manifest.id, first.revision);
        }).pipe(Effect.provide(makeFreshLayer())),
      );
      expect(removed.resources).toHaveLength(0);
      expect(synced).toEqual(
        expect.arrayContaining([
          path.join(home, 'projects', created.projectId, 'behaviors', 'sources'),
          path.join(home, 'projects', created.projectId, '.tileborne'),
        ]),
      );
    }));

  it.each(['journal-write', 'source-mutation', 'registry-commit', 'journal-delete'] as const)(
    'has deterministic recovery at the %s durability boundary',
    (boundary) =>
      withTempHome(async (home) => {
        const created = await runApp(
          Effect.gen(function* () {
            const projects = yield* ProjectService;
            const behaviors = yield* ProjectBehaviorService;
            const projectId = yield* projects.create({ name: `Boundary ${boundary}` });
            const snapshot = yield* behaviors.createTypeScript(projectId, {
              label: 'Boundary',
              source: 'export default "base";\n',
            });
            return { projectId, snapshot };
          }),
        );
        const behavior = created.snapshot.resources[0];
        if (behavior === undefined || behavior.kind !== 'typescript')
          throw new Error('missing behavior');
        const journalFile = transactionPathFor(home, created.projectId);
        let injected = false;
        const operations: ProjectBehaviorPersistenceOperations = {
          writeTextAtomic: async (filePath, contents) => {
            const shouldFail =
              (boundary === 'journal-write' && filePath === journalFile) ||
              (boundary === 'source-mutation' &&
                filePath.includes(path.join('behaviors', 'sources')) &&
                contents.includes(`boundary-${boundary}`)) ||
              (boundary === 'registry-commit' &&
                filePath === registryPathFor(home, created.projectId));
            if (!injected && shouldFail) {
              injected = true;
              throw new Error(`injected ${boundary} interruption`);
            }
            await writeTextForTest(filePath, contents);
          },
          removeFile: async (filePath) => {
            if (!injected && boundary === 'journal-delete' && filePath === journalFile) {
              injected = true;
              throw new Error('injected journal-delete interruption');
            }
            await rm(filePath, { force: true });
          },
          syncDirectory: async () => undefined,
        };
        const layer = Layer.mergeAll(
          ProjectServiceLive,
          makeProjectBehaviorServiceLive(operations),
        ).pipe(Layer.provideMerge(FoundationLayer));
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const behaviors = yield* ProjectBehaviorService;
            return yield* Effect.result(
              behaviors.saveTypeScript({
                projectId: created.projectId,
                behaviorId: behavior.manifest.id,
                expectedRevision: created.snapshot.revision,
                label: `Boundary ${boundary}`,
                source: `export default "boundary-${boundary}";\n`,
              }),
            );
          }).pipe(Effect.provide(layer)),
        );

        expect(injected).toBe(true);
        if (boundary === 'journal-write') {
          expect(result).toMatchObject({
            _tag: 'Failure',
            failure: { _tag: 'ProjectBehaviorError' },
          });
          expect(
            await readFile(
              path.join(home, 'projects', created.projectId, behavior.manifest.source.sourcePath),
              'utf8',
            ),
          ).toBe('export default "base";\n');
          expect(
            JSON.parse(await readFile(registryPathFor(home, created.projectId), 'utf8')),
          ).toMatchObject({ revision: created.snapshot.revision });
        } else {
          expect(result).toMatchObject({ _tag: 'Success' });
          const reopened = await runApp(
            Effect.gen(function* () {
              const behaviors = yield* ProjectBehaviorService;
              return yield* behaviors.open(created.projectId);
            }),
          );
          expect(reopened.revision).toBe(created.snapshot.revision + 1);
          expect(reopened.resources[0]).toMatchObject({
            source: `export default "boundary-${boundary}";\n`,
          });
        }
        expect(await readdir(path.dirname(journalFile))).not.toContain(path.basename(journalFile));
      }),
  );

  it('retains the project gate until active uncancellable persistence I/O settles', () =>
    withTempHome(async () => {
      let releaseBlockedWrite: (() => void) | undefined;
      let signalBlockedWrite: (() => void) | undefined;
      const blockedWriteEntered = new Promise<void>((resolve) => {
        signalBlockedWrite = resolve;
      });
      const blockedWriteReleased = new Promise<void>((resolve) => {
        releaseBlockedWrite = resolve;
      });
      const gateCounts: number[] = [];
      const operations: ProjectBehaviorPersistenceOperations = {
        writeTextAtomic: async (filePath, contents) => {
          if (
            filePath.includes(path.join('behaviors', 'sources')) &&
            contents.includes('active-block')
          ) {
            signalBlockedWrite?.();
            await blockedWriteReleased;
          }
          await writeTextForTest(filePath, contents);
        },
        removeFile: (filePath) => rm(filePath, { force: true }),
        onProjectGateCountChanged: (count) => gateCounts.push(count),
      };
      const layer = Layer.mergeAll(
        ProjectServiceLive,
        makeProjectBehaviorServiceLive(operations),
      ).pipe(Layer.provideMerge(FoundationLayer));
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Active Interruption' });
          const created = yield* behaviors.createTypeScript(projectId, {
            label: 'Active',
            source: 'export default "base";\n',
          });
          const behavior = created.resources[0];
          if (behavior === undefined) throw new Error('missing behavior');
          const active = yield* behaviors
            .saveTypeScript({
              projectId,
              behaviorId: behavior.manifest.id,
              expectedRevision: created.revision,
              label: 'Active blocked',
              source: 'export default "active-block";\n',
            })
            .pipe(Effect.forkChild);
          yield* Effect.promise(() => blockedWriteEntered);
          let interruptionSettled = false;
          const interrupt = yield* Fiber.interrupt(active).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                interruptionSettled = true;
              }),
            ),
            Effect.forkChild,
          );
          yield* Effect.sleep('50 millis');
          const observedWhileBlocked = { interruptionSettled, gateCount: gateCounts.at(-1) };
          releaseBlockedWrite?.();
          yield* Fiber.join(interrupt);
          const reopened = yield* behaviors.open(projectId);
          return { observedWhileBlocked, reopened };
        }).pipe(Effect.provide(layer)),
      );

      expect(result.observedWhileBlocked).toEqual({ interruptionSettled: false, gateCount: 1 });
      expect(result.reopened.resources[0]).toMatchObject({
        kind: 'typescript',
        source: 'export default "active-block";\n',
      });
      expect(gateCounts.at(-1)).toBe(0);
    }));

  it('owns stable visual/TypeScript resources, revisions, use-sites, trust, and reopen diagnostics', () =>
    withTempHome(async (home) => {
      const result = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Behavior Project' });

          const withScript = yield* behaviors.createTypeScript(projectId, {
            label: 'Award loot',
            source: 'export default () => ({ awarded: true });\n',
          });
          const script = withScript.resources[0];
          if (script === undefined) throw new Error('script resource was not created');

          const withVisual = yield* behaviors.createVisual(projectId, {
            label: 'Open chest',
            definition: {
              state: [],
              when: new BehaviorInvocation({
                entryId: 'world.interacted',
                arguments: {
                  nested: new ReferenceBehaviorValue({
                    reference: new NestedBehaviorReference({ behaviorId: script.manifest.id }),
                  }),
                },
              }),
              do: [],
            },
          });
          const visual = withVisual.resources.find((resource) => resource.kind === 'visual');
          if (visual === undefined) throw new Error('visual resource was not created');

          const staleSave = yield* Effect.result(
            behaviors.saveTypeScript({
              projectId,
              behaviorId: script.manifest.id,
              expectedRevision: withScript.revision,
              label: 'Stale save',
              source: 'export default () => undefined;\n',
            }),
          );
          const guardedDelete = yield* Effect.result(
            behaviors.remove(projectId, script.manifest.id, withVisual.revision),
          );
          const untrusted = yield* behaviors.setTrust(
            projectId,
            'imported-untrusted',
            withVisual.revision,
          );
          const reopened = yield* behaviors.open(projectId);

          return { projectId, script, visual, staleSave, guardedDelete, untrusted, reopened };
        }),
      );

      expect(result.staleSave._tag).toBe('Failure');
      if (result.staleSave._tag === 'Failure') {
        expect(result.staleSave.failure).toBeInstanceOf(ProjectBehaviorRevisionConflictError);
      }
      expect(result.guardedDelete._tag).toBe('Failure');
      if (result.guardedDelete._tag === 'Failure') {
        expect(result.guardedDelete.failure).toBeInstanceOf(ProjectBehaviorInUseError);
      }
      expect(result.reopened.resources.map((resource) => resource.manifest.id)).toEqual(
        result.untrusted.resources.map((resource) => resource.manifest.id),
      );
      expect(result.reopened.useSites).toEqual([
        expect.objectContaining({
          behaviorId: result.script.manifest.id,
          referencedByBehaviorId: result.visual.manifest.id,
        }),
      ]);
      expect(result.reopened.diagnostics).toEqual([
        expect.objectContaining({ code: 'behavior.project-untrusted', severity: 'error' }),
      ]);

      const visualPath = path.join(
        home,
        'projects',
        result.projectId as ProjectId,
        result.visual.manifest.source._tag === 'visual'
          ? result.visual.manifest.source.definitionPath
          : 'unexpected',
      );
      await writeFile(
        visualPath,
        `${JSON.stringify({ ...result.visual.definition, schemaVersion: 2 })}\n`,
      );
      const invalid = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(result.projectId);
        }),
      );
      expect(invalid.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'behavior.version-unsupported', severity: 'error' }),
        ]),
      );
    }));

  it('atomically converts the canonical visual source to TypeScript while preserving identity', () =>
    withTempHome(async (home) => {
      const setup = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Behavior Conversion' });
          const snapshot = yield* behaviors.createVisual(projectId, {
            label: 'Door logic',
            definition: {
              state: [],
              when: new BehaviorInvocation({ entryId: 'lifecycle.started', arguments: {} }),
              do: [],
            },
            requiredCapabilities: ['lifecycle.core'],
          });
          return { projectId, snapshot };
        }),
      );
      const visual = setup.snapshot.resources[0];
      if (visual === undefined || visual.kind !== 'visual')
        throw new Error('missing visual behavior');
      const source = `export default { id: ${JSON.stringify(visual.manifest.id)}, sourceKind: 'typescript', state: {} };\n`;
      const converted = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.convertVisualToTypeScript({
            projectId: setup.projectId,
            behaviorId: visual.manifest.id,
            expectedRevision: setup.snapshot.revision,
            source,
          });
        }),
      );
      const resource = converted.resources[0];
      expect(converted.revision).toBe(setup.snapshot.revision + 1);
      expect(resource).toMatchObject({
        kind: 'typescript',
        manifest: {
          id: visual.manifest.id,
          label: visual.manifest.label,
          requiredCapabilities: ['lifecycle.core'],
          source: { _tag: 'typescript', exportName: 'default' },
        },
        source,
      });
      const visualFile = path.join(
        home,
        'projects',
        setup.projectId,
        visual.manifest.source.definitionPath,
      );
      await expect(readFile(visualFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      const stale = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(
            behaviors.convertVisualToTypeScript({
              projectId: setup.projectId,
              behaviorId: visual.manifest.id,
              expectedRevision: setup.snapshot.revision,
              source,
            }),
          );
        }),
      );
      expect(stale).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ProjectBehaviorRevisionConflictError' },
      });
    }));

  it('recovers a conversion interrupted while removing the previous visual source', () =>
    withTempHome(async (home) => {
      const setup = await runApp(
        Effect.gen(function* () {
          const projects = yield* ProjectService;
          const behaviors = yield* ProjectBehaviorService;
          const projectId = yield* projects.create({ name: 'Interrupted Conversion' });
          const snapshot = yield* behaviors.createVisual(projectId, {
            label: 'Recover conversion',
            definition: {
              state: [],
              when: new BehaviorInvocation({ entryId: 'lifecycle.started', arguments: {} }),
              do: [],
            },
          });
          return { projectId, snapshot };
        }),
      );
      const visual = setup.snapshot.resources[0];
      if (visual === undefined || visual.kind !== 'visual')
        throw new Error('missing visual behavior');
      const visualFile = path.join(
        home,
        'projects',
        setup.projectId,
        visual.manifest.source.definitionPath,
      );
      let failedRemovals = 0;
      const operations: ProjectBehaviorPersistenceOperations = {
        writeTextAtomic: writeTextForTest,
        removeFile: async (filePath) => {
          if (filePath === visualFile && failedRemovals < 2) {
            failedRemovals += 1;
            throw new Error('injected previous-source removal failure');
          }
          await rm(filePath, { force: true });
        },
        syncDirectory: async () => undefined,
      };
      const layer = Layer.mergeAll(
        ProjectServiceLive,
        makeProjectBehaviorServiceLive(operations),
      ).pipe(Layer.provideMerge(FoundationLayer));
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* Effect.result(
            behaviors.convertVisualToTypeScript({
              projectId: setup.projectId,
              behaviorId: visual.manifest.id,
              expectedRevision: setup.snapshot.revision,
              source: `export default { id: ${JSON.stringify(visual.manifest.id)}, sourceKind: 'typescript', state: {} };\n`,
            }),
          );
        }).pipe(Effect.provide(layer)),
      );
      expect(result).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ProjectBehaviorTransactionError' },
      });
      expect(failedRemovals).toBe(2);

      const reopened = await runApp(
        Effect.gen(function* () {
          const behaviors = yield* ProjectBehaviorService;
          return yield* behaviors.open(setup.projectId);
        }),
      );
      expect(reopened.resources[0]).toMatchObject({
        kind: 'typescript',
        manifest: { id: visual.manifest.id },
      });
      await expect(readFile(visualFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readFile(transactionPathFor(home, setup.projectId), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }));
});

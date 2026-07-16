import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { HomeService, JobId, JobService } from '@tileborne/services-foundation';
import { Context, Effect, Layer, Option, PubSub, Stream } from 'effect';

import {
  SupportBundle,
  SupportBundleId,
  IntegrityMismatchError,
  SupportBundleNotFoundError,
  SupportBundleOptions,
  emptyContentHash,
  type ServicesBuildError,
  makeSupportBundleId,
} from '../model.js';
import {
  deleteDirectory,
  ensureDirectory,
  errorMessage,
  listVerifiedJson,
  metadataFileName,
  readVerifiedJson,
  serviceError,
  verifiedChildPath,
  writeTextFile,
  writeVerifiedJson,
} from '../internal/persistence.js';

export class SupportService extends Context.Service<
  SupportService,
  {
    readonly createBundle: (options?: SupportBundleOptions) => Effect.Effect<JobId>;
    readonly writeBundle: (
      destPath: string,
      options?: SupportBundleOptions,
    ) => Effect.Effect<SupportBundle, ServicesBuildError | IntegrityMismatchError>;
    readonly getBundle: (
      bundleId: SupportBundleId,
    ) => Effect.Effect<
      SupportBundle,
      ServicesBuildError | SupportBundleNotFoundError | IntegrityMismatchError
    >;
    readonly listBundles: () => Effect.Effect<
      readonly SupportBundle[],
      ServicesBuildError | IntegrityMismatchError
    >;
    readonly deleteBundle: (bundleId: SupportBundleId) => Effect.Effect<void, ServicesBuildError>;
    readonly subscribe: Stream.Stream<void>;
  }
>()('@tileborne/services-build/SupportService') {}

const supportRoot = (cachePath: string): string => path.join(cachePath, 'support');

const execFileAsync = promisify(execFile);

export const SupportServiceLive = Layer.effect(
  SupportService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const jobs = yield* JobService;
    const events = yield* PubSub.unbounded<void>();
    const root = supportRoot(home.paths.cache);
    yield* ensureDirectory(root);

    const getBundle = Effect.fn('SupportService.getBundle')(function* (bundleId: SupportBundleId) {
      const filePath = yield* verifiedChildPath(root, bundleId, metadataFileName);
      return yield* readVerifiedJson(filePath, SupportBundle).pipe(
        Effect.mapError((error) =>
          error._tag === 'ServicesBuildError'
            ? new SupportBundleNotFoundError({
                bundleId,
                message: `support bundle not found: ${bundleId}`,
              })
            : error,
        ),
      );
    });

    const writeBundle = Effect.fn('SupportService.writeBundle')(function* (
      options: SupportBundleOptions,
    ) {
      yield* Effect.sleep(Option.getOrElse(options.delayMs, () => 0));
      const bundleId = makeSupportBundleId();
      const directory = yield* verifiedChildPath(root, bundleId);
      yield* ensureDirectory(directory);
      const redactedFiles: string[] = [];
      if (Option.getOrElse(options.includeConfig, () => true)) {
        yield* writeTextFile(
          yield* verifiedChildPath(directory, 'config.redacted.json'),
          JSON.stringify({ redacted: true, source: home.paths.config }, null, 2),
        );
        redactedFiles.push('config.redacted.json');
      }
      if (Option.getOrElse(options.includeLogs, () => true)) {
        yield* writeTextFile(
          yield* verifiedChildPath(directory, 'logs.redacted.txt'),
          `Logs redacted from ${home.paths.logs}\n`,
        );
        redactedFiles.push('logs.redacted.txt');
      }
      const manifestPath = yield* verifiedChildPath(directory, metadataFileName);
      const bundle = new SupportBundle({
        id: bundleId,
        createdAt: new Date().toISOString(),
        directory,
        manifestPath,
        redactedFiles,
        integrityHash: emptyContentHash,
      });
      const integrityHash = yield* writeVerifiedJson(manifestPath, SupportBundle, bundle);
      yield* PubSub.publish(events, void 0);
      return new SupportBundle({ ...bundle, integrityHash });
    });

    const createBundle = Effect.fn('SupportService.createBundle')(function* (
      options = new SupportBundleOptions({
        includeLogs: Option.none(),
        includeConfig: Option.none(),
        delayMs: Option.none(),
      }),
    ) {
      return yield* jobs.create({
        name: 'support bundle',
        run: writeBundle(options),
      });
    });

    const writeBundleArchive = Effect.fn('SupportService.writeBundle')(function* (
      destPath: string,
      options = new SupportBundleOptions({
        includeLogs: Option.some(true),
        includeConfig: Option.some(true),
        delayMs: Option.none(),
      }),
    ) {
      const bundle = yield* writeBundle(options);
      const archiveRoot = home.paths.root;
      const resolvedDest = yield* verifiedChildPath(archiveRoot, destPath);
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(resolvedDest), { recursive: true }),
        catch: (cause) => serviceError(errorMessage(cause), resolvedDest),
      });
      yield* Effect.tryPromise({
        try: () => execFileAsync('tar', ['-czf', resolvedDest, '-C', bundle.directory, '.']),
        catch: (cause) => serviceError(errorMessage(cause), resolvedDest),
      });
      return bundle;
    });

    const listBundles = Effect.fn('SupportService.listBundles')(function* () {
      return yield* listVerifiedJson(root, SupportBundle);
    });

    const deleteBundle = Effect.fn('SupportService.deleteBundle')(function* (
      bundleId: SupportBundleId,
    ) {
      yield* deleteDirectory(yield* verifiedChildPath(root, bundleId));
      yield* PubSub.publish(events, void 0);
    });

    return {
      createBundle,
      writeBundle: writeBundleArchive,
      getBundle,
      listBundles,
      deleteBundle,
      subscribe: Stream.fromPubSub(events),
    };
  }),
);

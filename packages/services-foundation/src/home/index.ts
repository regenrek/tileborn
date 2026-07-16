import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';

import { Context, Effect, Layer, Schema } from 'effect';

export class HomeInitializationError extends Schema.TaggedErrorClass<HomeInitializationError>()(
  'HomeInitializationError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class HomeSecurityError extends Schema.TaggedErrorClass<HomeSecurityError>()(
  'HomeSecurityError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type HomeServiceError = HomeInitializationError | HomeSecurityError;

export interface TileborneHomePaths {
  readonly root: string;
  readonly config: string;
  readonly plugins: string;
  readonly assets: string;
  readonly projects: string;
  readonly cache: string;
  readonly logs: string;
}

export class HomeService extends Context.Service<
  HomeService,
  {
    readonly init: () => Effect.Effect<TileborneHomePaths, HomeServiceError>;
    readonly setRoot: (root: string) => Effect.Effect<TileborneHomePaths, HomeServiceError>;
    readonly paths: TileborneHomePaths;
  }
>()('@tileborne/services-foundation/HomeService') {}

const HOME_POINTER_FILE = path.join(homedir(), '.tileborne-home');

const readHomePointer = (): Effect.Effect<string | undefined, HomeServiceError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        const raw = await readFile(HOME_POINTER_FILE, 'utf8');
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      } catch (cause) {
        if (
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          (cause as { readonly code?: unknown }).code === 'ENOENT'
        ) {
          return undefined;
        }
        throw cause;
      }
    },
    catch: (cause) =>
      new HomeInitializationError({
        path: HOME_POINTER_FILE,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const homeFromEnv = (): string => {
  const override = process.env['TILEBORNE_HOME'];
  return path.resolve(
    override && override.length > 0 ? override : path.join(homedir(), '.tileborne'),
  );
};

const resolveHomeRoot = (): Effect.Effect<string, HomeServiceError> =>
  Effect.gen(function* () {
    const envOverride = process.env['TILEBORNE_HOME'];
    if (envOverride && envOverride.length > 0) {
      return path.resolve(envOverride);
    }
    const pointer = yield* readHomePointer();
    if (pointer) {
      return path.resolve(pointer);
    }
    return homeFromEnv();
  });

const makePaths = (root: string): TileborneHomePaths => ({
  root,
  config: path.join(root, 'config.json'),
  plugins: path.join(root, 'plugins'),
  assets: path.join(root, 'assets'),
  projects: path.join(root, 'projects'),
  cache: path.join(root, 'cache'),
  logs: path.join(root, 'logs'),
});

const ensureDirectory = (directory: string): Effect.Effect<void, HomeServiceError> =>
  Effect.gen(function* () {
    const before = yield* Effect.promise(async () => {
      try {
        return await lstat(directory);
      } catch {
        return undefined;
      }
    });
    if (before?.isSymbolicLink()) {
      yield* new HomeSecurityError({ path: directory, message: 'directory must not be a symlink' });
    }
    if (before && !before.isDirectory()) {
      yield* new HomeSecurityError({
        path: directory,
        message: 'path exists and is not a directory',
      });
    }

    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true }),
      catch: (cause) =>
        new HomeInitializationError({
          path: directory,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });

    const after = yield* Effect.tryPromise({
      try: () => lstat(directory),
      catch: (cause) =>
        new HomeInitializationError({
          path: directory,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    if (after.isSymbolicLink()) {
      yield* new HomeSecurityError({ path: directory, message: 'directory must not be a symlink' });
    }
    if (!after.isDirectory()) {
      yield* new HomeSecurityError({
        path: directory,
        message: 'path exists and is not a directory',
      });
    }
  });

const initializeHome = Effect.fn('HomeService.init')(function* () {
  const root = yield* resolveHomeRoot();
  const paths = makePaths(root);
  yield* ensureDirectory(paths.root);
  yield* ensureDirectory(paths.plugins);
  yield* ensureDirectory(paths.assets);
  yield* ensureDirectory(paths.projects);
  yield* ensureDirectory(paths.cache);
  yield* ensureDirectory(paths.logs);
  return paths;
});

const setRoot = Effect.fn('HomeService.setRoot')(function* (root: string) {
  const resolved = path.resolve(root);
  yield* Effect.tryPromise({
    try: () => writeFile(HOME_POINTER_FILE, `${resolved}\n`, 'utf8'),
    catch: (cause) =>
      new HomeInitializationError({
        path: HOME_POINTER_FILE,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  process.env['TILEBORNE_HOME'] = resolved;
  return yield* initializeHome();
});

export const HomeServiceLive = Layer.effect(
  HomeService,
  Effect.gen(function* () {
    const paths = yield* initializeHome();
    return {
      init: initializeHome,
      setRoot,
      paths,
    };
  }),
);

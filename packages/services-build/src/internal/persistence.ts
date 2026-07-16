import { existsSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertWithinRoot,
  rejectPathTraversal,
  rejectSymlinkEscape,
} from '@tileborne/asset-pipeline';
import { ContentHash, hashJsonStable } from '@tileborne/core';
import { writeJsonAtomic } from '@tileborne/services-foundation';
import { Effect, Option, Schema } from 'effect';

import { IntegrityMismatchError, ServicesBuildError } from '../model.js';

export const metadataFileName = 'manifest.json';

export const serviceError = (message: string, filePath?: string): ServicesBuildError =>
  new ServicesBuildError({
    path: filePath === undefined ? Option.none() : Option.some(filePath),
    message,
  });

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isNotFound = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';

export const ensureDirectory = (directory: string): Effect.Effect<void, ServicesBuildError> =>
  Effect.tryPromise({
    try: async () => {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(directory, { recursive: true }));
    },
    catch: (cause) => serviceError(errorMessage(cause), directory),
  });

export const verifiedChildPath = (
  root: string,
  ...segments: readonly string[]
): Effect.Effect<string, ServicesBuildError> =>
  Effect.gen(function* () {
    const relative = path.join(...segments);
    const resolved = yield* Effect.try({
      try: () => {
        rejectPathTraversal(root, relative);
        return assertWithinRoot(root, relative);
      },
      catch: (cause) => serviceError(errorMessage(cause), path.join(root, ...segments)),
    });

    const parent = path.dirname(relative);
    if (parent !== '.' && parent !== relative) {
      yield* Effect.tryPromise({
        try: async () => {
          try {
            await rejectSymlinkEscape(root, parent);
          } catch (cause) {
            if (!isNotFound(cause)) {
              throw cause;
            }
          }
        },
        catch: (cause) => serviceError(errorMessage(cause), path.join(root, parent)),
      });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        try {
          return await rejectSymlinkEscape(root, relative);
        } catch (cause) {
          if (isNotFound(cause)) {
            return resolved;
          }
          throw cause;
        }
      },
      catch: (cause) => serviceError(errorMessage(cause), path.join(root, ...segments)),
    });
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const splitIntegrity = (
  encoded: Record<string, unknown>,
): { readonly payload: Record<string, unknown>; readonly integrityHash: ContentHash } => {
  const { integrityHash, ...payload } = encoded;
  return {
    payload,
    integrityHash: integrityHash as ContentHash,
  };
};

export const writeVerifiedJson = <A, I extends Record<string, unknown>>(
  filePath: string,
  schema: Schema.Codec<A, I, never, never>,
  value: A,
): Effect.Effect<ContentHash, ServicesBuildError> =>
  Effect.gen(function* () {
    const encoded = yield* Effect.try({
      try: () => Schema.encodeSync(schema)(value),
      catch: (cause) => serviceError(errorMessage(cause), filePath),
    });
    const { payload } = splitIntegrity(encoded);
    const integrityHash = hashJsonStable(payload);
    yield* writeJsonAtomic(filePath, { ...payload, integrityHash }).pipe(
      Effect.mapError((error) => serviceError(error.message, error.path)),
    );
    return integrityHash;
  });

export const readVerifiedJson = <A, I extends Record<string, unknown>>(
  filePath: string,
  schema: Schema.Codec<A, I, never, never>,
): Effect.Effect<A, ServicesBuildError | IntegrityMismatchError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => serviceError(errorMessage(cause), filePath),
    });
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => serviceError(errorMessage(cause), filePath),
    });
    if (!isRecord(parsed)) {
      return yield* Effect.fail(
        serviceError(
          `verified JSON must be an object, got ${parsed === null ? 'null' : typeof parsed}`,
          filePath,
        ),
      );
    }
    const { payload, integrityHash } = splitIntegrity(parsed);
    const actual = hashJsonStable(payload);
    if (integrityHash !== actual) {
      yield* new IntegrityMismatchError({
        path: filePath,
        expected: integrityHash,
        actual,
        message: `integrity mismatch for ${filePath}`,
      });
    }
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(schema)(parsed),
      catch: (cause) => serviceError(errorMessage(cause), filePath),
    });
  });

export const listVerifiedJson = <A, I extends Record<string, unknown>>(
  root: string,
  schema: Schema.Codec<A, I, never, never>,
): Effect.Effect<readonly A[], ServicesBuildError | IntegrityMismatchError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(root, { withFileTypes: true });
        } catch (cause) {
          if (isNotFound(cause)) {
            return [];
          }
          throw cause;
        }
      },
      catch: (cause) => serviceError(errorMessage(cause), root),
    });
    const values: A[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const filePath = yield* verifiedChildPath(root, entry.name, metadataFileName);
      if (!existsSync(filePath)) {
        continue;
      }
      values.push(yield* readVerifiedJson(filePath, schema));
    }
    return values;
  });

export const deleteDirectory = (directory: string): Effect.Effect<void, ServicesBuildError> =>
  Effect.tryPromise({
    try: () => rm(directory, { recursive: true, force: true }),
    catch: (cause) => serviceError(errorMessage(cause), directory),
  });

export const writeTextFile = (
  filePath: string,
  content: string,
): Effect.Effect<void, ServicesBuildError> =>
  Effect.tryPromise({
    try: () => writeFile(filePath, content, 'utf8'),
    catch: (cause) => serviceError(errorMessage(cause), filePath),
  });

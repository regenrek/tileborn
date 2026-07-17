import { readFile, rename, rm } from 'node:fs/promises';

import { ContentHash, hashJsonStable } from '@tileborne/core';
import { Effect, Schema } from 'effect';

export const isNotFound = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  (cause as { readonly code?: unknown }).code === 'ENOENT';

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const readJson = <A, I, E>(
  filePath: string,
  schema: Schema.Codec<A, I, never, never>,
  onError: (message: string) => E,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => onError(errorMessage(cause)),
    });
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(raw),
      catch: (cause) => onError(errorMessage(cause)),
    });
    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(schema)(parsed) as A,
      catch: (cause) => onError(errorMessage(cause)),
    });
  });

export const encodeJson = <A, I, E>(
  schema: Schema.Codec<A, I, never, never>,
  value: A,
  onError: (message: string) => E,
): Effect.Effect<I, E> =>
  Effect.try({
    try: () => {
      try {
        const decoded = Schema.decodeUnknownSync(schema)(value);
        return Schema.encodeSync(schema)(decoded) as I;
      } catch {
        return Schema.encodeSync(schema)(value) as I;
      }
    },
    catch: (cause) => onError(errorMessage(cause)),
  });

export const hashEncodedJson = <A, I, E>(
  schema: Schema.Codec<A, I, never, never>,
  value: A,
  onError: (message: string) => E,
): Effect.Effect<ContentHash, E> =>
  Effect.gen(function* () {
    const encoded = yield* encodeJson(schema, value, onError);
    return hashJsonStable(encoded);
  });

export const removePath = <E>(
  targetPath: string,
  onError: (target: string, message: string) => E,
): Effect.Effect<void, E> =>
  Effect.tryPromise({
    try: () => rm(targetPath, { recursive: true, force: true }),
    catch: (cause) => onError(targetPath, errorMessage(cause)),
  });

export const replaceDirectory = async (sourcePath: string, targetPath: string): Promise<void> => {
  try {
    await rm(targetPath, { recursive: true, force: true });
  } catch (cause) {
    if (!isNotFound(cause)) {
      throw cause;
    }
  }
  try {
    await rename(sourcePath, targetPath);
  } catch (cause) {
    const code =
      typeof cause === 'object' && cause !== null && 'code' in cause
        ? (cause as { readonly code?: unknown }).code
        : undefined;
    if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      await rm(targetPath, { recursive: true, force: true });
      await rename(sourcePath, targetPath);
      return;
    }
    throw cause;
  }
};

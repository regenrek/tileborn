import path from 'node:path';

import {
  AssetPathSecurityError,
  assertWithinRoot,
  rejectPathTraversal,
  rejectSymlinkEscape,
} from '@tileborne/asset-pipeline';
import { Effect } from 'effect';

import { errorMessage, isNotFound } from './files.js';

const mapSecurityError = (
  cause: unknown,
  root: string,
  candidatePath: string,
): AssetPathSecurityError =>
  cause instanceof AssetPathSecurityError
    ? cause
    : new AssetPathSecurityError(errorMessage(cause), root, candidatePath);

export const verifiedChildPath = (
  root: string,
  candidatePath: string,
): Effect.Effect<string, AssetPathSecurityError> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.try({
      try: () => {
        if (candidatePath.includes('\0')) {
          throw new AssetPathSecurityError('NUL path segment is not allowed', root, candidatePath);
        }
        rejectPathTraversal(root, candidatePath);
        return assertWithinRoot(root, candidatePath);
      },
      catch: (cause) => mapSecurityError(cause, root, candidatePath),
    });

    const parent = path.dirname(candidatePath);
    if (parent !== '.' && parent !== candidatePath) {
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
        catch: (cause) => mapSecurityError(cause, root, parent),
      });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        try {
          return await rejectSymlinkEscape(root, candidatePath);
        } catch (cause) {
          if (isNotFound(cause)) {
            return resolved;
          }
          throw cause;
        }
      },
      catch: (cause) => mapSecurityError(cause, root, candidatePath),
    });
  });

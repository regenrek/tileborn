import { rename, writeFile } from 'node:fs/promises';

import { Effect, Schema } from 'effect';

export class AtomicWriteError extends Schema.TaggedErrorClass<AtomicWriteError>()(
  'AtomicWriteError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const writeQueues = new Map<string, Promise<void>>();

const withWriteQueue = async (filePath: string, write: () => Promise<void>): Promise<void> => {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.then(write, write);
  writeQueues.set(filePath, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(filePath) === next) {
      writeQueues.delete(filePath);
    }
  }
};

export const writeJsonAtomic = (
  filePath: string,
  value: unknown,
): Effect.Effect<void, AtomicWriteError> =>
  Effect.tryPromise({
    try: () =>
      withWriteQueue(filePath, async () => {
        const tempPath = `${filePath}.tmp`;
        const json = `${JSON.stringify(value, null, 2)}\n`;
        await writeFile(tempPath, json, { encoding: 'utf8', flag: 'w' });
        await rename(tempPath, filePath);
      }),
    catch: (cause) => new AtomicWriteError({ path: filePath, message: errorMessage(cause) }),
  });

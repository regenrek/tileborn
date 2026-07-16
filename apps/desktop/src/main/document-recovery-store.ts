import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  AppRecoveryStorageCommit,
  AppRecoveryStorageRecord,
  AppRecoveryStorageSnapshot,
} from '../shared/app-lifecycle.js';

const REGISTRY_SCHEMA_VERSION = 1;

interface RecoveryRegistryFile {
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly records: readonly AppRecoveryStorageRecord[];
}

const isRecord = (value: unknown): value is AppRecoveryStorageRecord => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AppRecoveryStorageRecord>;
  return (
    candidate.schemaVersion === REGISTRY_SCHEMA_VERSION &&
    typeof candidate.documentId === 'string' &&
    candidate.documentId.length > 0 &&
    typeof candidate.kind === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.revision === 'number' &&
    Number.isFinite(candidate.revision) &&
    typeof candidate.updatedAt === 'string'
  );
};

const decodeRegistry = (raw: string): readonly AppRecoveryStorageRecord[] => {
  const value = JSON.parse(raw) as Partial<RecoveryRegistryFile>;
  if (
    value.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    !Array.isArray(value.records) ||
    !value.records.every(isRecord)
  ) {
    throw new Error('Document recovery registry is invalid or unsupported');
  }
  return value.records;
};

const syncDirectory = async (directory: string): Promise<void> => {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const writeRegistry = async (
  filePath: string,
  records: readonly AppRecoveryStorageRecord[],
): Promise<void> => {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, records }, null, 2)}\n`,
        'utf8',
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
    await syncDirectory(directory);
  } catch (cause) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw cause;
  }
};

export interface DocumentRecoveryStore {
  readonly load: () => Promise<AppRecoveryStorageSnapshot>;
  readonly commit: (commit: AppRecoveryStorageCommit) => Promise<void>;
}

export const createDocumentRecoveryStore = (filePath: string): DocumentRecoveryStore => {
  let records: Map<string, AppRecoveryStorageRecord> | undefined;
  let operation = Promise.resolve();

  const ensureLoaded = async (): Promise<Map<string, AppRecoveryStorageRecord>> => {
    if (records !== undefined) return records;
    const loaded = await readFile(filePath, 'utf8').then(decodeRegistry, (cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    });
    records = new Map(loaded.map((record) => [record.documentId, record]));
    return records;
  };

  const serialize = <A>(task: () => Promise<A>): Promise<A> => {
    const result = operation.then(task, task);
    operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    load: () =>
      serialize(async () => ({
        records: [...(await ensureLoaded()).values()],
      })),
    commit: (commit) =>
      serialize(async () => {
        const current = await ensureLoaded();
        const next = new Map(current);
        for (const mutation of commit.mutations) {
          if (mutation._tag === 'upsert') {
            if (!isRecord(mutation.record)) throw new Error('Invalid document recovery record');
            next.set(mutation.record.documentId, mutation.record);
          } else {
            next.delete(mutation.documentId);
          }
        }
        await writeRegistry(filePath, [...next.values()]);
        records = next;
      }),
  };
};

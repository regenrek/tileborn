import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';

import type {
  AppRecoveryStorageCommit,
  AppRecoveryStorageDiagnostic,
  AppRecoveryStorageRecord,
  AppRecoveryStorageSnapshot,
} from '../shared/app-lifecycle.js';

const REGISTRY_SCHEMA_VERSION = PERSISTED_SCHEMA_VERSIONS.documentRecovery;

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

class RecoveryRegistryDecodeError extends Error {
  constructor(readonly reason: 'corrupt' | 'unsupported') {
    super(`Document recovery registry is ${reason}`);
  }
}

export const decodeRegistry = (raw: string): readonly AppRecoveryStorageRecord[] => {
  let value: Partial<RecoveryRegistryFile>;
  try {
    value = JSON.parse(raw) as Partial<RecoveryRegistryFile>;
  } catch {
    throw new RecoveryRegistryDecodeError('corrupt');
  }
  if (value.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new RecoveryRegistryDecodeError('unsupported');
  }
  if (!Array.isArray(value.records) || !value.records.every(isRecord)) {
    throw new RecoveryRegistryDecodeError('corrupt');
  }
  return value.records;
};

export const loadOrRepairRegistry = async (
  filePath: string,
): Promise<{
  readonly records: readonly AppRecoveryStorageRecord[];
  readonly diagnostic?: AppRecoveryStorageDiagnostic;
}> => {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { records: [] };
    throw cause;
  }
  try {
    return { records: decodeRegistry(raw) };
  } catch (cause) {
    if (!(cause instanceof RecoveryRegistryDecodeError)) throw cause;
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    const quarantinedFile = `${filePath}.${cause.reason}-${randomUUID()}`;
    await rename(filePath, quarantinedFile);
    await syncDirectory(directory);
    await writeRegistry(filePath, []);
    return {
      records: [],
      diagnostic: {
        code: 'recovery-registry-repaired',
        severity: 'warning',
        message:
          `Tileborne repaired ${cause.reason} draft recovery data. ` +
          'The previous file was quarantined; new drafts will be recovered normally.',
        quarantinedFile,
      },
    };
  }
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
  let diagnostic: AppRecoveryStorageDiagnostic | undefined;
  let operation = Promise.resolve();

  const ensureLoaded = async (): Promise<Map<string, AppRecoveryStorageRecord>> => {
    if (records !== undefined) return records;
    const loaded = await loadOrRepairRegistry(filePath);
    diagnostic = loaded.diagnostic;
    records = new Map(loaded.records.map((record) => [record.documentId, record]));
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
        ...(diagnostic === undefined ? {} : { diagnostic }),
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

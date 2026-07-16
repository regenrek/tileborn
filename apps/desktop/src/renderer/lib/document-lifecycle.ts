import { useEffect, useSyncExternalStore } from 'react';
import { PERSISTED_SCHEMA_VERSIONS } from '@tileborne/core';

import type {
  AppRecoveryStorageMutation,
  TileborneAppLifecycleBridge,
} from '../../shared/app-lifecycle';

export type DocumentKind =
  | 'map'
  | 'entity'
  | 'project-content'
  | 'sprite-animation'
  | 'player-model'
  | 'hud-input'
  | 'game-settings'
  | 'behavior';

export type DocumentStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'recovery';

export interface DocumentLifecycleState {
  readonly id: string;
  readonly label: string;
  readonly kind: DocumentKind;
  readonly scopeId?: string | undefined;
  readonly status: DocumentStatus;
  readonly revision: number;
  readonly savedRevision: number;
  readonly error?: string | undefined;
  readonly hasRecovery: boolean;
}

export interface DocumentRecoveryRecord {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.documentRecovery;
  readonly documentId: string;
  readonly kind: DocumentKind;
  readonly label: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly snapshot: unknown;
}

export interface DocumentRegistration {
  readonly id: string;
  readonly label: string;
  readonly kind: DocumentKind;
  readonly scopeId?: string | undefined;
  readonly save: () => Promise<void>;
  readonly discard?: () => void | Promise<void>;
  readonly snapshot?: () => unknown;
  readonly recover?: (snapshot: unknown) => void | Promise<void>;
}

type Listener = () => void;

const RECOVERY_PREFIX = 'tileborne:document-recovery:v1:';
const states = new Map<string, DocumentLifecycleState>();
const registrations = new Map<string, DocumentRegistration>();
const listeners = new Set<Listener>();
const recoveryRecords = new Map<string, DocumentRecoveryRecord>();
const pendingRecoveryMutations = new Map<
  string,
  { readonly version: number; readonly mutation: AppRecoveryStorageMutation }
>();
let recoveryFlushTimer: ReturnType<typeof setTimeout> | undefined;
let recoveryMutationVersion = 0;
let recoveryDurableVersion = 0;
let recoveryFlushDrain: Promise<void> | undefined;
let recoveryStorageBridge: TileborneAppLifecycleBridge | undefined;

const decodeRecoveryRecord = (value: unknown): DocumentRecoveryRecord | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Partial<DocumentRecoveryRecord>;
  if (
    record.schemaVersion !== PERSISTED_SCHEMA_VERSIONS.documentRecovery ||
    typeof record.documentId !== 'string' ||
    typeof record.kind !== 'string' ||
    typeof record.label !== 'string' ||
    typeof record.revision !== 'number' ||
    typeof record.updatedAt !== 'string'
  ) {
    return undefined;
  }
  return record as DocumentRecoveryRecord;
};

const queueRecoveryMutation = (documentId: string, mutation: AppRecoveryStorageMutation): void => {
  recoveryMutationVersion += 1;
  pendingRecoveryMutations.set(documentId, {
    version: recoveryMutationVersion,
    mutation,
  });
};

const flushRecoveryStorage = (): Promise<void> => {
  if (recoveryFlushTimer !== undefined) clearTimeout(recoveryFlushTimer);
  recoveryFlushTimer = undefined;
  if (recoveryDurableVersion >= recoveryMutationVersion) {
    return recoveryFlushDrain ?? Promise.resolve();
  }
  if (recoveryFlushDrain === undefined) {
    recoveryFlushDrain = (async () => {
      while (recoveryDurableVersion < recoveryMutationVersion) {
        const targetVersion = recoveryMutationVersion;
        const batch = [...pendingRecoveryMutations.entries()].filter(
          ([, pending]) => pending.version <= targetVersion,
        );
        if (batch.length > 0) {
          const bridge = recoveryStorageBridge ?? globalThis.window?.tileborneAppLifecycle;
          if (bridge === undefined) throw new Error('Document recovery storage bridge is missing');
          await bridge.commitRecoveryStorage({
            mutations: batch.map(([, pending]) => pending.mutation),
          });
          for (const [documentId, pending] of batch) {
            if (pendingRecoveryMutations.get(documentId)?.version === pending.version) {
              pendingRecoveryMutations.delete(documentId);
            }
          }
        }
        recoveryDurableVersion = targetVersion;
      }
    })().finally(() => {
      recoveryFlushDrain = undefined;
    });
  }
  return recoveryFlushDrain;
};

const scheduleRecoveryStorageFlush = (): void => {
  if (recoveryFlushTimer !== undefined) clearTimeout(recoveryFlushTimer);
  recoveryFlushTimer = setTimeout(() => {
    recoveryFlushTimer = undefined;
    void flushRecoveryStorage().catch(() => {
      // The in-memory recovery record remains usable during this process. A
      // later edit retries the durable Chromium storage flush.
    });
  }, 100);
};

const emit = () => {
  for (const listener of listeners) listener();
};

const storage = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const readRecovery = (documentId: string): DocumentRecoveryRecord | undefined =>
  recoveryRecords.get(documentId);

const writeRecovery = (state: DocumentLifecycleState): void => {
  const registration = registrations.get(state.id);
  if (registration?.snapshot === undefined) return;
  const record: DocumentRecoveryRecord = {
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.documentRecovery,
    documentId: state.id,
    kind: state.kind,
    label: state.label,
    revision: state.revision,
    updatedAt: new Date().toISOString(),
    snapshot: registration.snapshot(),
  };
  recoveryRecords.set(state.id, record);
  queueRecoveryMutation(state.id, { _tag: 'upsert', record });
  scheduleRecoveryStorageFlush();
};

const clearRecovery = (documentId: string): void => {
  if (!recoveryRecords.delete(documentId)) return;
  queueRecoveryMutation(documentId, { _tag: 'delete', documentId });
  scheduleRecoveryStorageFlush();
};

export const initializeDocumentRecoveryStorage = async (
  bridge: TileborneAppLifecycleBridge = globalThis.window.tileborneAppLifecycle,
): Promise<void> => {
  recoveryStorageBridge = bridge;
  const merged = new Map<string, DocumentRecoveryRecord>();
  let mainLoaded = false;
  try {
    const mainSnapshot = await bridge.loadRecoveryStorage();
    mainLoaded = true;
    for (const candidate of mainSnapshot.records) {
      const record = decodeRecoveryRecord(candidate);
      if (record !== undefined) merged.set(record.documentId, record);
    }
  } catch {
    // Legacy local recovery remains available below if the main registry cannot
    // be read. A subsequent mutation retries the main-owned transaction path.
  }

  const legacyStorage = storage();
  const legacyKeys: string[] = [];
  const imports: AppRecoveryStorageMutation[] = [];
  for (let index = 0; index < (legacyStorage?.length ?? 0); index += 1) {
    const key = legacyStorage?.key(index);
    if (key === null || key === undefined || !key.startsWith(RECOVERY_PREFIX)) continue;
    legacyKeys.push(key);
    try {
      const legacy = decodeRecoveryRecord(JSON.parse(legacyStorage?.getItem(key) ?? 'null'));
      if (legacy === undefined) continue;
      const current = merged.get(legacy.documentId);
      if (
        current === undefined ||
        legacy.revision > current.revision ||
        (legacy.revision === current.revision && legacy.updatedAt > current.updatedAt)
      ) {
        merged.set(legacy.documentId, legacy);
        imports.push({ _tag: 'upsert', record: legacy });
      }
    } catch {
      // Invalid legacy records were never recoverable; leave them for the
      // existing browser-origin cleanup policy instead of importing them.
    }
  }
  let migrationAcknowledged = mainLoaded && imports.length === 0;
  if (imports.length > 0) {
    try {
      await bridge.commitRecoveryStorage({ mutations: imports });
      migrationAcknowledged = true;
    } catch {
      // Preserve legacy keys when migration cannot be durably acknowledged.
    }
  }
  if (migrationAcknowledged) {
    for (const key of legacyKeys) legacyStorage?.removeItem(key);
  }
  recoveryRecords.clear();
  for (const [documentId, record] of merged) recoveryRecords.set(documentId, record);
};

const setState = (
  documentId: string,
  update: (state: DocumentLifecycleState) => DocumentLifecycleState,
): DocumentLifecycleState | undefined => {
  const current = states.get(documentId);
  if (current === undefined) return undefined;
  const next = update(current);
  if (next === current) return current;
  states.set(documentId, next);
  emit();
  return next;
};

export const documentLifecycle = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  get(documentId: string): DocumentLifecycleState | undefined {
    return states.get(documentId);
  },

  list(): readonly DocumentLifecycleState[] {
    return [...states.values()];
  },

  register(registration: DocumentRegistration): () => void {
    registrations.set(registration.id, registration);
    const recovery = readRecovery(registration.id);
    const previous = states.get(registration.id);
    states.set(
      registration.id,
      recovery === undefined
        ? (previous ?? {
            id: registration.id,
            label: registration.label,
            kind: registration.kind,
            scopeId: registration.scopeId,
            status: 'clean',
            revision: 0,
            savedRevision: 0,
            hasRecovery: false,
          })
        : {
            ...(previous ?? {
              id: registration.id,
              savedRevision: 0,
            }),
            label: registration.label,
            kind: registration.kind,
            scopeId: registration.scopeId,
            status: 'recovery',
            revision: Math.max(previous?.revision ?? 0, recovery.revision),
            error: undefined,
            hasRecovery: true,
          },
    );
    emit();
    return () => {
      // updateRegistration replaces the object captured by this cleanup while the
      // hook is mounted. The document id is the ownership boundary, so unmounting
      // its owner must remove whichever callback set is current.
      registrations.delete(registration.id);
    };
  },

  updateRegistration(registration: DocumentRegistration): void {
    registrations.set(registration.id, registration);
    setState(registration.id, (state) =>
      state.label === registration.label &&
      state.kind === registration.kind &&
      state.scopeId === registration.scopeId
        ? state
        : {
            ...state,
            label: registration.label,
            kind: registration.kind,
            scopeId: registration.scopeId,
          },
    );
  },

  markDirty(documentId: string): void {
    const next = setState(documentId, (state) => {
      const next = {
        ...state,
        status: 'dirty' as const,
        revision: state.revision + 1,
        error: undefined,
        hasRecovery: true,
      };
      return next;
    });
    if (next !== undefined) writeRecovery(next);
  },

  markClean(documentId: string): void {
    setState(documentId, (state) => {
      clearRecovery(documentId);
      return {
        ...state,
        status: 'clean',
        savedRevision: state.revision,
        error: undefined,
        hasRecovery: false,
      };
    });
  },

  markError(documentId: string, cause: unknown): void {
    const next = setState(documentId, (state) => {
      const next = {
        ...state,
        status: 'error' as const,
        error: cause instanceof Error ? cause.message : String(cause),
        hasRecovery: true,
      };
      return next;
    });
    if (next !== undefined) writeRecovery(next);
  },

  async save(documentId: string): Promise<boolean> {
    const registration = registrations.get(documentId);
    if (registration === undefined) return true;
    setState(documentId, (state) => ({ ...state, status: 'saving', error: undefined }));
    try {
      await registration.save();
      clearRecovery(documentId);
      await flushRecoveryStorage();
      setState(documentId, (state) => {
        return {
          ...state,
          status: 'saved',
          savedRevision: state.revision,
          error: undefined,
          hasRecovery: false,
        };
      });
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const next = setState(documentId, (state) => ({
        ...state,
        status: 'error',
        error: message,
        hasRecovery: true,
      }));
      if (next !== undefined) writeRecovery(next);
      return false;
    }
  },

  async discard(documentId: string): Promise<void> {
    await registrations.get(documentId)?.discard?.();
    clearRecovery(documentId);
    await flushRecoveryStorage();
    setState(documentId, (state) => ({
      ...state,
      status: 'clean',
      savedRevision: state.revision,
      error: undefined,
      hasRecovery: false,
    }));
  },

  async recover(documentId: string): Promise<boolean> {
    const registration = registrations.get(documentId);
    const recovery = readRecovery(documentId);
    if (registration?.recover === undefined || recovery === undefined) return false;
    setState(documentId, (state) => ({ ...state, status: 'recovery', hasRecovery: true }));
    try {
      await registration.recover(recovery.snapshot);
      setState(documentId, (state) => ({
        ...state,
        status: 'dirty',
        revision: Math.max(state.revision, recovery.revision),
        hasRecovery: true,
      }));
      return true;
    } catch (cause) {
      setState(documentId, (state) => ({
        ...state,
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
        hasRecovery: true,
      }));
      return false;
    }
  },

  hasUnsaved(): boolean {
    return [...states.values()].some(
      (state) =>
        state.status === 'dirty' ||
        state.status === 'saving' ||
        state.status === 'error' ||
        state.status === 'recovery',
    );
  },

  flushRecoveryStorage(): Promise<void> {
    return flushRecoveryStorage();
  },

  resetForTests(): void {
    if (recoveryFlushTimer !== undefined) clearTimeout(recoveryFlushTimer);
    recoveryFlushTimer = undefined;
    recoveryMutationVersion = 0;
    recoveryDurableVersion = 0;
    recoveryFlushDrain = undefined;
    recoveryStorageBridge = undefined;
    recoveryRecords.clear();
    pendingRecoveryMutations.clear();
    states.clear();
    registrations.clear();
    listeners.clear();
  },
};

export const requestDocumentClose = async (
  documentId: string,
  confirm: (message: string) => boolean = globalThis.confirm,
): Promise<boolean> => {
  const direct = documentLifecycle.get(documentId);
  const candidates =
    direct === undefined
      ? documentLifecycle.list().filter((state) => state.scopeId === documentId)
      : [
          direct,
          ...documentLifecycle
            .list()
            .filter((state) => state.id !== documentId && state.scopeId === documentId),
        ];
  for (const state of candidates) {
    if (state.status === 'clean' || state.status === 'saved') continue;
    if (confirm(`Save changes to ${state.label} before closing?`)) {
      if (!(await documentLifecycle.save(state.id))) return false;
      continue;
    }
    if (!confirm(`Discard unsaved changes to ${state.label}? This cannot be undone.`)) {
      return false;
    }
    await documentLifecycle.discard(state.id);
  }
  return true;
};

export const requestAllDocumentsClose = async (
  confirm: (message: string) => boolean = globalThis.confirm,
): Promise<boolean> => {
  for (const state of documentLifecycle.list()) {
    if (state.status === 'clean' || state.status === 'saved') continue;
    if (!(await requestDocumentClose(state.id, confirm))) return false;
  }
  return true;
};

export const installGracefulAppClose = (
  bridge: TileborneAppLifecycleBridge = globalThis.window.tileborneAppLifecycle,
  confirm: (message: string) => boolean = globalThis.confirm,
): (() => void) =>
  bridge.onCloseRequested(({ requestId }) => {
    void requestAllDocumentsClose(confirm).then(
      (allow) => bridge.resolveClose({ requestId, allow }),
      () => bridge.resolveClose({ requestId, allow: false }),
    );
  });

export const installDocumentBeforeUnload = (): (() => void) => {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!documentLifecycle.hasUnsaved()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  globalThis.addEventListener('beforeunload', onBeforeUnload);
  return () => globalThis.removeEventListener('beforeunload', onBeforeUnload);
};

export interface UseDocumentLifecycleOptions extends DocumentRegistration {
  readonly dirty: boolean;
  readonly recoveryVersion?: unknown;
  readonly enabled?: boolean;
}

export const useDocumentLifecycle = (
  options: UseDocumentLifecycleOptions,
): DocumentLifecycleState | undefined => {
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    return documentLifecycle.register(options);
  }, [enabled, options.id]);
  useEffect(() => {
    if (enabled) documentLifecycle.updateRegistration(options);
  });
  useEffect(() => {
    if (!enabled) return;
    const current = documentLifecycle.get(options.id);
    if (current?.status === 'recovery' && options.recover !== undefined) {
      void documentLifecycle.recover(options.id);
      return;
    }
    if (options.dirty) documentLifecycle.markDirty(options.id);
    else if (current?.status !== 'error' && current?.status !== 'recovery') {
      documentLifecycle.markClean(options.id);
    }
  }, [enabled, options.dirty, options.id, options.recoveryVersion]);
  return useSyncExternalStore(
    documentLifecycle.subscribe,
    () => documentLifecycle.get(options.id),
    () => documentLifecycle.get(options.id),
  );
};

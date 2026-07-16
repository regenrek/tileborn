import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { PERSISTED_SCHEMA_VERSIONS, hashJsonStable } from '@tileborne/core';

const TRANSACTION_DIRECTORY = '.tileborne';
const TRANSACTION_FILE = 'project-revision-transaction.json';
const OWNER_DIRECTORY = 'project-revision-owner';
const OWNER_RECORD_FILE = 'owner.json';
const OWNER_CLAIM_PREFIX = 'project-revision-owner.claim-';
const OWNER_PREPARE_PREFIX = 'project-revision-owner.prepare-';
const PROJECT_TARGET = 'project.json';
const LOCK_TARGET = 'project.lock.json';
const MISSING_TARGET_HASH = 'missing';

export type ProjectRevisionTransactionPhase =
  | 'prepared'
  | 'map-installed'
  | 'project-installed'
  | 'lock-installed';

export type ProjectRevisionTransactionFaultPhase =
  | 'owner-acquired'
  | 'dead-owner-observed'
  | 'owner-published'
  | 'stale-owner-captured'
  | 'foreign-live-owner-observed'
  | 'takeover-claimed'
  | 'takeover-recovered'
  | ProjectRevisionTransactionPhase;

export type ProjectManifestRevisionTransactionFaultPhase =
  | 'backup-directory-ready'
  | 'backup-installed'
  | 'backup-verified'
  | ProjectRevisionTransactionFaultPhase;

interface ProjectRevisionTransactionOwner {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.projectRevisionOwner;
  readonly id: string;
  readonly ownerPid: number;
}

interface ProjectRevisionTransactionJournal {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.projectRevisionJournal;
  readonly id: string;
  readonly kind: 'map-project-revision' | 'project-manifest-revision';
  readonly ownerPid: number;
  readonly projectId: string;
  readonly mapId?: string | undefined;
  readonly phase: ProjectRevisionTransactionPhase;
  readonly targets: {
    readonly map?: string | undefined;
    readonly project: typeof PROJECT_TARGET;
    readonly lock: typeof LOCK_TARGET;
  };
  readonly oldHashes: {
    readonly map?: string | undefined;
    readonly project: string;
    readonly lock: string;
  };
  readonly newHashes: {
    readonly map?: string | undefined;
    readonly project: string;
    readonly lock: string;
  };
  readonly snapshots: {
    readonly map?: unknown;
    readonly project: unknown;
    readonly lock: unknown;
  };
  /** Exact project bytes used by backup restore; hashes still cover parsed JSON. */
  readonly rawProject?: string | undefined;
  /** Hash used by the lock after in-memory migration of an exact legacy source. */
  readonly projectIntegrityHash?: string | undefined;
}

export interface CommitMapProjectRevisionInput {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly mapId: string;
  readonly mapTarget: string;
  /**
   * Runs only after exclusive durable ownership is acquired and the current
   * coherent revision has been re-read. Callers cannot carry full snapshots
   * computed before the cross-process ownership boundary.
   */
  readonly buildSnapshots: (
    current: ProjectRevisionTransactionJournal['snapshots'],
  ) =>
    | ProjectRevisionTransactionJournal['snapshots']
    | Promise<ProjectRevisionTransactionJournal['snapshots']>;
  readonly faultAfterPhase?:
    | ((phase: ProjectRevisionTransactionFaultPhase) => void | Promise<void>)
    | undefined;
}

export interface CommitProjectManifestRevisionInput {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly buildSnapshots: (
    current: Pick<ProjectRevisionTransactionJournal['snapshots'], 'project' | 'lock'>,
  ) =>
    | Pick<ProjectRevisionTransactionJournal['snapshots'], 'project' | 'lock'>
    | Promise<Pick<ProjectRevisionTransactionJournal['snapshots'], 'project' | 'lock'>>;
  /** Preserve these already-verified bytes instead of reserializing `project`. */
  readonly rawProject?: string | undefined;
  /** Defaults to the target project's stable JSON hash. */
  readonly projectIntegrityHash?: string | undefined;
  /** Legacy migration alone may start with a manifest but no historical lock. */
  readonly allowMissingLock?: boolean | undefined;
  readonly faultAfterPhase?:
    | ((phase: ProjectRevisionTransactionFaultPhase) => void | Promise<void>)
    | undefined;
}

const transactionPath = (projectRoot: string): string =>
  path.join(projectRoot, TRANSACTION_DIRECTORY, TRANSACTION_FILE);

const ownerPath = (projectRoot: string): string =>
  path.join(projectRoot, TRANSACTION_DIRECTORY, OWNER_DIRECTORY);

const ownerRecordPath = (ownerDirectory: string): string =>
  path.join(ownerDirectory, OWNER_RECORD_FILE);

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const writeDurableTextAtomic = async (filePath: string, contents: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.txn-${randomUUID()}`;
  const handle = await open(tempPath, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
  await syncDirectory(path.dirname(filePath));
};

const writeDurableJsonAtomic = (filePath: string, value: unknown): Promise<void> =>
  writeDurableTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);

const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await readFile(filePath, 'utf8'));

const currentHash = async (filePath: string): Promise<string> =>
  hashJsonStable(await readJson(filePath));

const currentHashOrMissing = async (filePath: string): Promise<string> =>
  currentHash(filePath).catch((cause) => {
    if (isNotFound(cause)) return MISSING_TARGET_HASH;
    throw cause;
  });

const readJsonOrMissing = async (filePath: string): Promise<unknown> =>
  readJson(filePath).catch((cause) => {
    if (isNotFound(cause)) return undefined;
    throw cause;
  });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid project revision journal: ${key} must be a non-empty string`);
  }
  return value;
};

const decodeJournal = (projectRoot: string, value: unknown): ProjectRevisionTransactionJournal => {
  if (
    !isObject(value) ||
    value.schemaVersion !== PERSISTED_SCHEMA_VERSIONS.projectRevisionJournal ||
    (value.kind !== 'map-project-revision' && value.kind !== 'project-manifest-revision')
  ) {
    throw new Error('Invalid project revision journal header');
  }
  if (!Number.isSafeInteger(value.ownerPid) || Number(value.ownerPid) <= 0) {
    throw new Error('Invalid project revision journal ownerPid');
  }
  const projectId = requireString(value, 'projectId');
  const kind = value.kind;
  const mapId = kind === 'map-project-revision' ? requireString(value, 'mapId') : undefined;
  const id = requireString(value, 'id');
  const phases: readonly ProjectRevisionTransactionPhase[] =
    kind === 'map-project-revision'
      ? ['prepared', 'map-installed', 'project-installed', 'lock-installed']
      : ['prepared', 'project-installed', 'lock-installed'];
  if (!phases.includes(value.phase as ProjectRevisionTransactionPhase)) {
    throw new Error('Invalid project revision journal phase');
  }
  if (
    !isObject(value.targets) ||
    !isObject(value.oldHashes) ||
    !isObject(value.newHashes) ||
    !isObject(value.snapshots)
  ) {
    throw new Error('Invalid project revision journal payload');
  }
  const expectedMapTarget = mapId === undefined ? undefined : path.join('maps', `${mapId}.json`);
  if (
    (kind === 'map-project-revision'
      ? value.targets.map !== expectedMapTarget
      : Object.hasOwn(value.targets, 'map')) ||
    value.targets.project !== PROJECT_TARGET ||
    value.targets.lock !== LOCK_TARGET
  ) {
    throw new Error('Invalid project revision journal targets');
  }
  for (const target of Object.values(value.targets)) {
    const resolved = path.resolve(projectRoot, String(target));
    if (!resolved.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
      throw new Error('Project revision journal target escapes project root');
    }
  }
  const snapshots: ProjectRevisionTransactionJournal['snapshots'] = {
    ...(kind === 'map-project-revision' ? { map: value.snapshots.map } : {}),
    project: value.snapshots.project,
    lock: value.snapshots.lock,
  };
  const newHashes: ProjectRevisionTransactionJournal['newHashes'] = {
    ...(kind === 'map-project-revision' ? { map: requireString(value.newHashes, 'map') } : {}),
    project: requireString(value.newHashes, 'project'),
    lock: requireString(value.newHashes, 'lock'),
  };
  const oldHashes: ProjectRevisionTransactionJournal['oldHashes'] = {
    ...(kind === 'map-project-revision' ? { map: requireString(value.oldHashes, 'map') } : {}),
    project: requireString(value.oldHashes, 'project'),
    lock: requireString(value.oldHashes, 'lock'),
  };
  const keys =
    kind === 'map-project-revision'
      ? (['map', 'project', 'lock'] as const)
      : (['project', 'lock'] as const);
  for (const key of keys) {
    if (hashJsonStable(snapshots[key]) !== newHashes[key]) {
      throw new Error(`Invalid project revision journal ${key} snapshot hash`);
    }
  }
  if (kind === 'map-project-revision' && (!isObject(snapshots.map) || snapshots.map.id !== mapId)) {
    throw new Error('Invalid project revision journal map snapshot id');
  }
  if (!isObject(snapshots.project) || snapshots.project.id !== projectId) {
    throw new Error('Invalid project revision journal project snapshot id');
  }
  const projectIntegrityHash =
    kind === 'map-project-revision'
      ? newHashes.project
      : requireString(value, 'projectIntegrityHash');
  if (!isObject(snapshots.lock) || snapshots.lock.projectHash !== projectIntegrityHash) {
    throw new Error('Invalid project revision journal lock projectHash');
  }
  if (kind === 'map-project-revision') {
    const mapLocks = Array.isArray(snapshots.lock.maps) ? snapshots.lock.maps : [];
    const mapLock = mapLocks.find((entry) => isObject(entry) && entry.id === mapId);
    if (!isObject(mapLock) || mapLock.hash !== newHashes.map) {
      throw new Error('Invalid project revision journal lock map hash');
    }
  }
  const rawProject = value.rawProject;
  if (rawProject !== undefined) {
    if (
      kind !== 'project-manifest-revision' ||
      typeof rawProject !== 'string' ||
      hashJsonStable(JSON.parse(rawProject) as unknown) !== newHashes.project
    ) {
      throw new Error('Invalid project revision journal raw project snapshot');
    }
  }
  return {
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRevisionJournal,
    id,
    kind,
    ownerPid: Number(value.ownerPid),
    projectId,
    ...(mapId === undefined ? {} : { mapId }),
    phase: value.phase as ProjectRevisionTransactionPhase,
    targets: {
      ...(expectedMapTarget === undefined ? {} : { map: expectedMapTarget }),
      project: PROJECT_TARGET,
      lock: LOCK_TARGET,
    },
    oldHashes,
    newHashes,
    snapshots,
    ...(rawProject === undefined ? {} : { rawProject }),
    ...(kind === 'project-manifest-revision' ? { projectIntegrityHash } : {}),
  };
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const decodeOwner = (value: unknown): ProjectRevisionTransactionOwner => {
  if (!isObject(value) || value.schemaVersion !== PERSISTED_SCHEMA_VERSIONS.projectRevisionOwner) {
    throw new Error('Invalid project revision owner header');
  }
  if (!Number.isSafeInteger(value.ownerPid) || Number(value.ownerPid) <= 0) {
    throw new Error('Invalid project revision ownerPid');
  }
  return {
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRevisionOwner,
    id: requireString(value, 'id'),
    ownerPid: Number(value.ownerPid),
  };
};

const isAlreadyExists = (cause: unknown): boolean =>
  isObject(cause) && (cause.code === 'EEXIST' || cause.code === 'ENOTEMPTY');

const isNotFound = (cause: unknown): boolean => isObject(cause) && cause.code === 'ENOENT';

const pathExists = (filePath: string): Promise<boolean> =>
  stat(filePath).then(
    () => true,
    (cause) => (isNotFound(cause) ? false : Promise.reject(cause)),
  );

const ownerMatches = (
  left: ProjectRevisionTransactionOwner,
  right: ProjectRevisionTransactionOwner,
): boolean => left.id === right.id && left.ownerPid === right.ownerPid;

const readOwnerDirectory = async (directory: string): Promise<ProjectRevisionTransactionOwner> =>
  decodeOwner(await readJson(ownerRecordPath(directory)));

const transactionDirectoryPath = (projectRoot: string): string =>
  path.join(projectRoot, TRANSACTION_DIRECTORY);

const claimPathFor = (projectRoot: string): string =>
  path.join(
    transactionDirectoryPath(projectRoot),
    `${OWNER_CLAIM_PREFIX}${process.pid}-${randomUUID()}`,
  );

const listClaimPaths = async (projectRoot: string): Promise<readonly string[]> => {
  const directory = transactionDirectoryPath(projectRoot);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if (isNotFound(cause)) return [];
    throw cause;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(OWNER_CLAIM_PREFIX))
    .map((entry) => path.join(directory, entry.name))
    .sort();
};

const claimantPidFromPath = (claimPath: string): number | undefined => {
  const match = path.basename(claimPath).match(/^project-revision-owner\.claim-(\d+)-/);
  if (match === null) return undefined;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
};

const removeUniqueClaim = async (projectRoot: string, claimPath: string): Promise<void> => {
  await rm(claimPath, { recursive: true, force: true });
  await syncDirectory(transactionDirectoryPath(projectRoot));
};

const restoreUniqueClaim = async (
  projectRoot: string,
  claimPath: string,
  deadline: number,
): Promise<void> => {
  while (Date.now() < deadline) {
    try {
      await rename(claimPath, ownerPath(projectRoot));
      await syncDirectory(transactionDirectoryPath(projectRoot));
      return;
    } catch (cause) {
      if (isNotFound(cause)) return;
      if (!isAlreadyExists(cause)) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out restoring project revision owner claim ${path.basename(claimPath)}`);
};

const installPreparedOwner = async (
  projectRoot: string,
  owner: ProjectRevisionTransactionOwner,
): Promise<boolean> => {
  const transactionDirectory = transactionDirectoryPath(projectRoot);
  await mkdir(transactionDirectory, { recursive: true });
  const prepared = path.join(
    transactionDirectory,
    `${OWNER_PREPARE_PREFIX}${process.pid}-${owner.id}`,
  );
  await mkdir(prepared);
  try {
    await writeDurableJsonAtomic(ownerRecordPath(prepared), owner);
    await syncDirectory(prepared);
    try {
      await rename(prepared, ownerPath(projectRoot));
    } catch (cause) {
      if (isAlreadyExists(cause)) return false;
      throw cause;
    }
    await syncDirectory(transactionDirectory);
    return true;
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }
};

const targetPaths = (projectRoot: string, journal: ProjectRevisionTransactionJournal) => ({
  ...(journal.targets.map === undefined
    ? {}
    : { map: path.join(projectRoot, journal.targets.map) }),
  project: path.join(projectRoot, journal.targets.project),
  lock: path.join(projectRoot, journal.targets.lock),
});

const removeJournal = async (projectRoot: string): Promise<void> => {
  await unlink(transactionPath(projectRoot));
  await syncDirectory(path.dirname(transactionPath(projectRoot)));
};

const installNewRevision = async (
  projectRoot: string,
  journal: ProjectRevisionTransactionJournal,
  faultAfterPhase?: CommitMapProjectRevisionInput['faultAfterPhase'],
): Promise<void> => {
  const targets = targetPaths(projectRoot, journal);
  const steps =
    journal.kind === 'map-project-revision'
      ? ([
          ['map', 'map-installed'],
          ['project', 'project-installed'],
          ['lock', 'lock-installed'],
        ] as const)
      : ([
          ['project', 'project-installed'],
          ['lock', 'lock-installed'],
        ] as const);
  let current = journal;
  for (const [key, phase] of steps) {
    const target = targets[key];
    if (target === undefined) {
      throw new Error(`Missing ${key} target in project revision journal`);
    }
    await (key === 'project' && current.rawProject !== undefined
      ? writeDurableTextAtomic(target, current.rawProject)
      : writeDurableJsonAtomic(target, current.snapshots[key]));
    current = { ...current, phase };
    await writeDurableJsonAtomic(transactionPath(projectRoot), current);
    await faultAfterPhase?.(phase);
  }
  await removeJournal(projectRoot);
};

const recoverJournalWithoutAcquiringOwner = async (projectRoot: string): Promise<void> => {
  const journalFile = transactionPath(projectRoot);
  if (!(await pathExists(journalFile))) {
    return;
  }
  const journal = decodeJournal(projectRoot, await readJson(journalFile));
  if (journal.ownerPid !== process.pid && processIsAlive(journal.ownerPid)) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (
        !(await stat(journalFile).then(
          () => true,
          () => false,
        ))
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `Project revision transaction ${journal.id} is owned by live process ${journal.ownerPid}`,
    );
  }
  const targets = targetPaths(projectRoot, journal);
  const hashes = {
    ...(targets.map === undefined ? {} : { map: await currentHash(targets.map) }),
    project: await currentHashOrMissing(targets.project),
    lock: await currentHashOrMissing(targets.lock),
  };
  const keys =
    journal.kind === 'map-project-revision'
      ? (['map', 'project', 'lock'] as const)
      : (['project', 'lock'] as const);
  const states = keys.map((key) => {
    if (hashes[key] === journal.oldHashes[key]) return 'old';
    if (hashes[key] === journal.newHashes[key]) return 'new';
    throw new Error(
      `Cannot recover project revision transaction ${journal.id}: ${key} target was modified externally`,
    );
  });
  if (states.every((state) => state === 'old')) {
    await removeJournal(projectRoot);
    return;
  }
  await installNewRevision(projectRoot, { ...journal, ownerPid: process.pid });
};

const recoverUniqueClaim = async (
  projectRoot: string,
  claimPath: string,
  deadline: number,
  expected?: ProjectRevisionTransactionOwner,
  faultAfterPhase?: CommitMapProjectRevisionInput['faultAfterPhase'],
): Promise<void> => {
  const claimedOwner = await readOwnerDirectory(claimPath);
  if (
    (expected !== undefined && !ownerMatches(claimedOwner, expected)) ||
    processIsAlive(claimedOwner.ownerPid)
  ) {
    await faultAfterPhase?.('stale-owner-captured');
    await restoreUniqueClaim(projectRoot, claimPath, deadline);
    return;
  }
  await faultAfterPhase?.('takeover-claimed');
  await recoverJournalWithoutAcquiringOwner(projectRoot);
  await faultAfterPhase?.('takeover-recovered');
  await removeUniqueClaim(projectRoot, claimPath);
};

const settleExistingClaim = async (
  projectRoot: string,
  deadline: number,
  faultAfterPhase?: CommitMapProjectRevisionInput['faultAfterPhase'],
): Promise<boolean> => {
  const claims = await listClaimPaths(projectRoot);
  for (const observedClaim of claims) {
    const claimantPid = claimantPidFromPath(observedClaim);
    if (claimantPid !== undefined && processIsAlive(claimantPid)) {
      return true;
    }
    const claimed = claimPathFor(projectRoot);
    try {
      await rename(observedClaim, claimed);
    } catch (cause) {
      if (isNotFound(cause)) continue;
      throw cause;
    }
    await syncDirectory(transactionDirectoryPath(projectRoot));
    await recoverUniqueClaim(projectRoot, claimed, deadline, undefined, faultAfterPhase);
    return true;
  }
  return claims.length > 0;
};

const withdrawPreparedOwner = async (
  projectRoot: string,
  expected: ProjectRevisionTransactionOwner,
  deadline: number,
): Promise<void> => {
  const withdrawn = claimPathFor(projectRoot);
  try {
    await rename(ownerPath(projectRoot), withdrawn);
  } catch (cause) {
    if (isNotFound(cause)) return;
    throw cause;
  }
  await syncDirectory(transactionDirectoryPath(projectRoot));
  const moved = await readOwnerDirectory(withdrawn);
  if (ownerMatches(moved, expected)) {
    await removeUniqueClaim(projectRoot, withdrawn);
    return;
  }
  await restoreUniqueClaim(projectRoot, withdrawn, deadline);
};

const releaseProjectRevisionOwner = async (
  projectRoot: string,
  expected: ProjectRevisionTransactionOwner,
): Promise<boolean> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await listClaimPaths(projectRoot)).length > 0) {
      // A stale cleaner may have moved this live owner's directory and then
      // crashed. Help take over that exact, never-reused claim so it can be
      // validated/restored before attempting our own release.
      await settleExistingClaim(projectRoot, deadline);
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    const released = claimPathFor(projectRoot);
    try {
      await rename(ownerPath(projectRoot), released);
    } catch (cause) {
      if (isNotFound(cause)) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }
      throw cause;
    }
    await syncDirectory(transactionDirectoryPath(projectRoot));
    const moved = await readOwnerDirectory(released);
    if (!ownerMatches(moved, expected)) {
      await restoreUniqueClaim(projectRoot, released, deadline);
      return false;
    }
    await removeUniqueClaim(projectRoot, released);
    return true;
  }
  throw new Error('Timed out releasing project revision transaction ownership');
};

const acquireProjectRevisionOwner = async (
  projectRoot: string,
  faultAfterPhase?: CommitMapProjectRevisionInput['faultAfterPhase'],
): Promise<ProjectRevisionTransactionOwner> => {
  const candidate: ProjectRevisionTransactionOwner = {
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRevisionOwner,
    id: randomUUID(),
    ownerPid: process.pid,
  };
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await settleExistingClaim(projectRoot, deadline, faultAfterPhase)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }

    if (await installPreparedOwner(projectRoot, candidate)) {
      await faultAfterPhase?.('owner-published');
      if ((await listClaimPaths(projectRoot)).length === 0) {
        return candidate;
      }
      await withdrawPreparedOwner(projectRoot, candidate, deadline);
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }

    let existing: ProjectRevisionTransactionOwner;
    try {
      existing = await readOwnerDirectory(ownerPath(projectRoot));
    } catch (cause) {
      if (isNotFound(cause)) continue;
      throw cause;
    }
    if (ownerMatches(existing, candidate) && (await listClaimPaths(projectRoot)).length === 0) {
      return candidate;
    }
    if (processIsAlive(existing.ownerPid)) {
      await faultAfterPhase?.('foreign-live-owner-observed');
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }

    await faultAfterPhase?.('dead-owner-observed');
    const claimed = claimPathFor(projectRoot);
    try {
      await rename(ownerPath(projectRoot), claimed);
    } catch (cause) {
      if (isNotFound(cause)) continue;
      throw cause;
    }
    await syncDirectory(transactionDirectoryPath(projectRoot));
    await recoverUniqueClaim(projectRoot, claimed, deadline, existing, faultAfterPhase);
  }
  throw new Error('Timed out waiting for project revision transaction ownership');
};

export const recoverProjectRevisionTransaction = async (projectRoot: string): Promise<void> => {
  const owner = await acquireProjectRevisionOwner(projectRoot);
  try {
    await recoverJournalWithoutAcquiringOwner(projectRoot);
  } finally {
    await releaseProjectRevisionOwner(projectRoot, owner);
  }
};

export const commitMapProjectRevision = async (
  input: CommitMapProjectRevisionInput,
): Promise<void> => {
  const expectedMapTarget = path.join(input.projectRoot, 'maps', `${input.mapId}.json`);
  if (path.resolve(input.mapTarget) !== path.resolve(expectedMapTarget)) {
    throw new Error(`Map transaction target must be ${expectedMapTarget}`);
  }
  const owner = await acquireProjectRevisionOwner(input.projectRoot, input.faultAfterPhase);
  try {
    await input.faultAfterPhase?.('owner-acquired');
    await recoverJournalWithoutAcquiringOwner(input.projectRoot);
    const targets = {
      map: input.mapTarget,
      project: path.join(input.projectRoot, PROJECT_TARGET),
      lock: path.join(input.projectRoot, LOCK_TARGET),
    };
    const current = {
      map: await readJson(targets.map),
      project: await readJson(targets.project),
      lock: await readJson(targets.lock),
    };
    const oldHashes = {
      map: hashJsonStable(current.map),
      project: hashJsonStable(current.project),
      lock: hashJsonStable(current.lock),
    };
    const snapshots = await input.buildSnapshots(current);
    const newHashes = {
      map: hashJsonStable(snapshots.map),
      project: hashJsonStable(snapshots.project),
      lock: hashJsonStable(snapshots.lock),
    };
    const journal: ProjectRevisionTransactionJournal = decodeJournal(input.projectRoot, {
      schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRevisionJournal,
      id: randomUUID(),
      kind: 'map-project-revision',
      ownerPid: process.pid,
      projectId: input.projectId,
      mapId: input.mapId,
      phase: 'prepared',
      targets: {
        map: path.join('maps', `${input.mapId}.json`),
        project: PROJECT_TARGET,
        lock: LOCK_TARGET,
      },
      oldHashes,
      newHashes,
      snapshots,
    });
    const journalFile = transactionPath(input.projectRoot);
    const handle = await open(journalFile, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(path.dirname(journalFile));
    await input.faultAfterPhase?.('prepared');
    await installNewRevision(input.projectRoot, journal, input.faultAfterPhase);
  } finally {
    await releaseProjectRevisionOwner(input.projectRoot, owner);
  }
};

/**
 * Atomically installs the project manifest and its integrity lock under the
 * same durable owner/journal used by map revisions. Existing callers can
 * therefore recover a process death between the two target replacements.
 */
export const commitProjectManifestRevision = async (
  input: CommitProjectManifestRevisionInput,
): Promise<void> => {
  const owner = await acquireProjectRevisionOwner(input.projectRoot, input.faultAfterPhase);
  try {
    await input.faultAfterPhase?.('owner-acquired');
    await recoverJournalWithoutAcquiringOwner(input.projectRoot);
    const targets = {
      project: path.join(input.projectRoot, PROJECT_TARGET),
      lock: path.join(input.projectRoot, LOCK_TARGET),
    };
    const current = {
      project: await readJsonOrMissing(targets.project),
      lock: await readJsonOrMissing(targets.lock),
    };
    const projectMissing = current.project === undefined;
    const lockMissing = current.lock === undefined;
    if (
      projectMissing !== lockMissing &&
      !(input.allowMissingLock === true && !projectMissing && lockMissing)
    ) {
      throw new Error('refusing to replace a partial project manifest/integrity-lock pair');
    }
    const oldHashes = {
      project:
        current.project === undefined ? MISSING_TARGET_HASH : hashJsonStable(current.project),
      lock: current.lock === undefined ? MISSING_TARGET_HASH : hashJsonStable(current.lock),
    };
    const snapshots = await input.buildSnapshots(current);
    const targetProject =
      input.rawProject === undefined
        ? snapshots.project
        : (JSON.parse(input.rawProject) as unknown);
    const newHashes = {
      project: hashJsonStable(targetProject),
      lock: hashJsonStable(snapshots.lock),
    };
    const journal: ProjectRevisionTransactionJournal = decodeJournal(input.projectRoot, {
      schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRevisionJournal,
      id: randomUUID(),
      kind: 'project-manifest-revision',
      ownerPid: process.pid,
      projectId: input.projectId,
      phase: 'prepared',
      targets: { project: PROJECT_TARGET, lock: LOCK_TARGET },
      oldHashes,
      newHashes,
      snapshots,
      ...(input.rawProject === undefined ? {} : { rawProject: input.rawProject }),
      projectIntegrityHash: input.projectIntegrityHash ?? newHashes.project,
    });
    const journalFile = transactionPath(input.projectRoot);
    const handle = await open(journalFile, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(path.dirname(journalFile));
    await input.faultAfterPhase?.('prepared');
    await installNewRevision(input.projectRoot, journal, input.faultAfterPhase);
  } finally {
    await releaseProjectRevisionOwner(input.projectRoot, owner);
  }
};

export const projectRevisionTransactionPath = transactionPath;
export const projectRevisionOwnerPath = ownerPath;
export const projectRevisionOwnerClaimPrefix = OWNER_CLAIM_PREFIX;

export const projectRevisionTransactionErrorMessage = errorMessage;

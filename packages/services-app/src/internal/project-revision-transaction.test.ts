import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { hashJsonStable } from '@tileborne/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  commitMapProjectRevision,
  projectRevisionOwnerClaimPrefix,
  projectRevisionOwnerPath,
  projectRevisionTransactionPath,
  recoverProjectRevisionTransaction,
  type ProjectRevisionTransactionFaultPhase,
} from './project-revision-transaction.js';

const roots: string[] = [];

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await readFile(filePath, 'utf8'));

const expectMissing = async (filePath: string): Promise<void> => {
  await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
};

const lockFor = (
  project: unknown,
  maps: ReadonlyArray<{ readonly id: string; readonly value: unknown }>,
) => ({
  schemaVersion: 1,
  projectHash: hashJsonStable(project),
  maps: maps.map(({ id, value }) => ({
    id,
    path: `maps/${id}.json`,
    hash: hashJsonStable(value),
  })),
});

const fixture = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-project-revision-'));
  roots.push(projectRoot);
  const projectId = 'project:00000000-0000-4000-8000-000000000001';
  const mapId = 'map:00000000-0000-4000-8000-000000000002';
  const mapTarget = path.join(projectRoot, 'maps', `${mapId}.json`);
  const oldMap = { id: mapId, revision: 'old' };
  const newMap = { id: mapId, revision: 'new' };
  const oldProject = { id: projectId, revision: 'old' };
  const newProject = { id: projectId, revision: 'new' };
  const oldLock = lockFor(oldProject, [{ id: mapId, value: oldMap }]);
  const newLock = lockFor(newProject, [{ id: mapId, value: newMap }]);
  await writeJson(mapTarget, oldMap);
  await writeJson(path.join(projectRoot, 'project.json'), oldProject);
  await writeJson(path.join(projectRoot, 'project.lock.json'), oldLock);
  return {
    projectRoot,
    projectId,
    mapId,
    mapTarget,
    old: { map: oldMap, project: oldProject, lock: oldLock },
    next: { map: newMap, project: newProject, lock: newLock },
  };
};

const twoMapFixture = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-project-revision-race-'));
  roots.push(projectRoot);
  const projectId = 'project:00000000-0000-4000-8000-000000000010';
  const mapAId = 'map:00000000-0000-4000-8000-000000000011';
  const mapBId = 'map:00000000-0000-4000-8000-000000000012';
  const project = { id: projectId, revision: 'stable' };
  const oldA = { id: mapAId, revision: 'old-a' };
  const oldB = { id: mapBId, revision: 'old-b' };
  const nextA = { id: mapAId, revision: 'new-a' };
  const nextB = { id: mapBId, revision: 'new-b' };
  await writeJson(path.join(projectRoot, 'project.json'), project);
  await writeJson(path.join(projectRoot, 'maps', `${mapAId}.json`), oldA);
  await writeJson(path.join(projectRoot, 'maps', `${mapBId}.json`), oldB);
  await writeJson(
    path.join(projectRoot, 'project.lock.json'),
    lockFor(project, [
      { id: mapAId, value: oldA },
      { id: mapBId, value: oldB },
    ]),
  );
  return { projectRoot, projectId, mapAId, mapBId, project, oldA, oldB, nextA, nextB };
};

interface ChildInput {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly mapId: string;
  readonly mapTarget: string;
  readonly nextMap: unknown;
  readonly nextProject?: unknown;
  readonly faultPhase?: ProjectRevisionTransactionFaultPhase;
  readonly pauseOnOwner?: boolean;
  readonly pausePhase?: ProjectRevisionTransactionFaultPhase;
  readonly pausePhases?: readonly ProjectRevisionTransactionFaultPhase[];
  readonly delayPreparedMs?: number;
}

interface ChildWorker {
  readonly child: ChildProcess;
  readonly exit: Promise<{ readonly code: number | null; readonly stderr: string }>;
  readonly waitForMessage: (type: string) => Promise<Record<string, unknown>>;
}

const spawnTransactionWorker = (input: ChildInput): ChildWorker => {
  const moduleUrl = pathToFileURL(
    path.resolve('dist/internal/project-revision-transaction.js'),
  ).href;
  const script = `
    import { commitMapProjectRevision } from ${JSON.stringify(moduleUrl)};
    import { hashJsonStable } from '@tileborne/core';
    const input = JSON.parse(process.env.TILEBORNE_TX_INPUT);
    const paused = new Set();
    process.send?.({ type: 'starting' });
    await commitMapProjectRevision({
      projectRoot: input.projectRoot,
      projectId: input.projectId,
      mapId: input.mapId,
      mapTarget: input.mapTarget,
      buildSnapshots: (current) => {
        const project = input.nextProject ?? current.project;
        const nextEntry = {
          id: input.mapId,
          path: 'maps/' + input.mapId + '.json',
          hash: hashJsonStable(input.nextMap),
        };
        const lock = {
          ...current.lock,
          projectHash: hashJsonStable(project),
          maps: [...current.lock.maps.filter((entry) => entry.id !== input.mapId), nextEntry],
        };
        process.send?.({ type: 'built', mapId: input.mapId, currentLock: current.lock });
        return { map: input.nextMap, project, lock };
      },
      faultAfterPhase: async (phase) => {
        process.send?.({ type: 'phase:' + phase });
        process.send?.({ type: phase });
        const shouldPause =
          (phase === 'owner-acquired' && input.pauseOnOwner) ||
          phase === input.pausePhase ||
          input.pausePhases?.includes(phase);
        if (shouldPause && !paused.has(phase)) {
          paused.add(phase);
          process.send?.({ type: 'paused:' + phase });
          await new Promise((resolve) => process.once('message', resolve));
        }
        if (phase === input.faultPhase) process.exit(86);
        if (phase === 'prepared' && input.delayPreparedMs) {
          await new Promise((resolve) => setTimeout(resolve, input.delayPreparedMs));
        }
      },
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    env: { ...process.env, TILEBORNE_TX_INPUT: JSON.stringify(input) },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages: Record<string, unknown>[] = [];
  child.on('message', (message) => {
    if (typeof message === 'object' && message !== null)
      messages.push(message as Record<string, unknown>);
  });
  const exit = new Promise<{ readonly code: number | null; readonly stderr: string }>(
    (resolve, reject) => {
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code, stderr }));
    },
  );
  const waitForMessage = async (type: string): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const found = messages.find((message) => message.type === type);
      if (found) return found;
      if (child.exitCode !== null) throw new Error(`child exited before ${type}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for child message ${type}`);
  };
  return { child, exit, waitForMessage };
};

const claimResidue = async (projectRoot: string): Promise<readonly string[]> => {
  const transactionDirectory = path.join(projectRoot, '.tileborne');
  return readdir(transactionDirectory).then(
    (entries) => entries.filter((entry) => entry.startsWith(projectRevisionOwnerClaimPrefix)),
    () => [],
  );
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project revision transaction recovery', () => {
  for (const faultPhase of [
    'prepared',
    'map-installed',
    'project-installed',
    'lock-installed',
  ] as const) {
    it(`restart converges after a crash at ${faultPhase}`, async () => {
      const state = await fixture();
      await expect(
        commitMapProjectRevision({
          projectRoot: state.projectRoot,
          projectId: state.projectId,
          mapId: state.mapId,
          mapTarget: state.mapTarget,
          buildSnapshots: () => state.next,
          faultAfterPhase: (phase) => {
            if (phase === faultPhase) throw new Error(`simulated crash after ${phase}`);
          },
        }),
      ).rejects.toThrow(`simulated crash after ${faultPhase}`);

      await recoverProjectRevisionTransaction(state.projectRoot);

      const expected = faultPhase === 'prepared' ? state.old : state.next;
      expect(await readJson(state.mapTarget)).toEqual(expected.map);
      expect(await readJson(path.join(state.projectRoot, 'project.json'))).toEqual(
        expected.project,
      );
      expect(await readJson(path.join(state.projectRoot, 'project.lock.json'))).toEqual(
        expected.lock,
      );
      await expectMissing(projectRevisionTransactionPath(state.projectRoot));
      await expectMissing(projectRevisionOwnerPath(state.projectRoot));
    });
  }

  it('rejects a tampered staged snapshot before touching project targets', async () => {
    const state = await fixture();
    await expect(
      commitMapProjectRevision({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        buildSnapshots: () => ({
          ...state.next,
          lock: { ...state.next.lock, projectHash: 'tampered' },
        }),
      }),
    ).rejects.toThrow(/lock projectHash/);
    expect(await readJson(state.mapTarget)).toEqual(state.old.map);
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));
  });

  it('recovers a partial commit left by a crashed foreign process', async () => {
    const state = await fixture();
    const worker = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapId,
      mapTarget: state.mapTarget,
      nextMap: state.next.map,
      nextProject: state.next.project,
      faultPhase: 'map-installed',
    });
    const childResult = await worker.exit;
    expect(childResult.code, childResult.stderr).toBe(86);

    await recoverProjectRevisionTransaction(state.projectRoot);
    expect(await readJson(state.mapTarget)).toEqual(state.next.map);
    expect(await readJson(path.join(state.projectRoot, 'project.json'))).toEqual(
      state.next.project,
    );
    expect(await readJson(path.join(state.projectRoot, 'project.lock.json'))).toEqual(
      state.next.lock,
    );
    await expectMissing(projectRevisionTransactionPath(state.projectRoot));
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));
  });

  it('waits for a live foreign owner instead of racing its partial revision', async () => {
    const state = await fixture();
    const worker = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapId,
      mapTarget: state.mapTarget,
      nextMap: state.next.map,
      nextProject: state.next.project,
      delayPreparedMs: 300,
    });
    await worker.waitForMessage('built');

    await recoverProjectRevisionTransaction(state.projectRoot);
    const childResult = await worker.exit;
    expect(childResult.code, childResult.stderr).toBe(0);
    expect(await readJson(state.mapTarget)).toEqual(state.next.map);
    expect(await readJson(path.join(state.projectRoot, 'project.lock.json'))).toEqual(
      state.next.lock,
    );
    await expectMissing(projectRevisionTransactionPath(state.projectRoot));
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));
  });

  it('serializes two writers and makes the second derive from the first committed revision', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'tileborne-project-revision-race-'));
    roots.push(projectRoot);
    const projectId = 'project:00000000-0000-4000-8000-000000000010';
    const mapAId = 'map:00000000-0000-4000-8000-000000000011';
    const mapBId = 'map:00000000-0000-4000-8000-000000000012';
    const project = { id: projectId, revision: 'stable' };
    const oldA = { id: mapAId, revision: 'old-a' };
    const oldB = { id: mapBId, revision: 'old-b' };
    const nextA = { id: mapAId, revision: 'new-a' };
    const nextB = { id: mapBId, revision: 'new-b' };
    await writeJson(path.join(projectRoot, 'project.json'), project);
    await writeJson(path.join(projectRoot, 'maps', `${mapAId}.json`), oldA);
    await writeJson(path.join(projectRoot, 'maps', `${mapBId}.json`), oldB);
    await writeJson(
      path.join(projectRoot, 'project.lock.json'),
      lockFor(project, [
        { id: mapAId, value: oldA },
        { id: mapBId, value: oldB },
      ]),
    );

    const writerA = spawnTransactionWorker({
      projectRoot,
      projectId,
      mapId: mapAId,
      mapTarget: path.join(projectRoot, 'maps', `${mapAId}.json`),
      nextMap: nextA,
      pauseOnOwner: true,
    });
    await writerA.waitForMessage('owner-acquired');
    const writerB = spawnTransactionWorker({
      projectRoot,
      projectId,
      mapId: mapBId,
      mapTarget: path.join(projectRoot, 'maps', `${mapBId}.json`),
      nextMap: nextB,
    });
    await writerB.waitForMessage('starting');
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(writerB.child.exitCode).toBeNull();
    await expectMissing(projectRevisionTransactionPath(projectRoot));

    writerA.child.send?.({ type: 'release' });
    const [resultA, builtB, resultB] = await Promise.all([
      writerA.exit,
      writerB.waitForMessage('built'),
      writerB.exit,
    ]);
    expect(resultA.code, resultA.stderr).toBe(0);
    expect(resultB.code, resultB.stderr).toBe(0);
    const lockSeenByB = builtB.currentLock as {
      readonly maps: ReadonlyArray<{ readonly id: string; readonly hash: string }>;
    };
    expect(lockSeenByB.maps.find((entry) => entry.id === mapAId)?.hash).toBe(hashJsonStable(nextA));

    expect(await readJson(path.join(projectRoot, 'maps', `${mapAId}.json`))).toEqual(nextA);
    expect(await readJson(path.join(projectRoot, 'maps', `${mapBId}.json`))).toEqual(nextB);
    expect(await readJson(path.join(projectRoot, 'project.lock.json'))).toEqual(
      lockFor(project, [
        { id: mapAId, value: nextA },
        { id: mapBId, value: nextB },
      ]),
    );
    await expectMissing(projectRevisionTransactionPath(projectRoot));
    await expectMissing(projectRevisionOwnerPath(projectRoot));
  });

  for (const faultPhase of ['owner-acquired', 'prepared'] as const) {
    it(`a third process safely retries after its predecessor is killed at ${faultPhase}`, async () => {
      const state = await fixture();
      const killed = spawnTransactionWorker({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        nextMap: state.next.map,
        nextProject: state.next.project,
        faultPhase,
      });
      const killedResult = await killed.exit;
      expect(killedResult.code, killedResult.stderr).toBe(86);
      expect(await stat(projectRevisionOwnerPath(state.projectRoot))).toBeDefined();
      if (faultPhase === 'owner-acquired') {
        await expectMissing(projectRevisionTransactionPath(state.projectRoot));
      } else {
        expect(await stat(projectRevisionTransactionPath(state.projectRoot))).toBeDefined();
      }

      const retry = spawnTransactionWorker({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        nextMap: state.next.map,
        nextProject: state.next.project,
      });
      const retryResult = await retry.exit;
      expect(retryResult.code, retryResult.stderr).toBe(0);
      expect(await readJson(state.mapTarget)).toEqual(state.next.map);
      expect(await readJson(path.join(state.projectRoot, 'project.json'))).toEqual(
        state.next.project,
      );
      expect(await readJson(path.join(state.projectRoot, 'project.lock.json'))).toEqual(
        state.next.lock,
      );
      await expectMissing(projectRevisionTransactionPath(state.projectRoot));
      await expectMissing(projectRevisionOwnerPath(state.projectRoot));
    });
  }

  it('allows only one of two simultaneous reclaimers to recover a dead owner', async () => {
    const state = await twoMapFixture();
    const dead = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapAId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapAId}.json`),
      nextMap: state.nextA,
      faultPhase: 'prepared',
    });
    expect((await dead.exit).code).toBe(86);

    const reclaimerA = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapAId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapAId}.json`),
      nextMap: state.nextA,
      pausePhase: 'takeover-claimed',
    });
    const reclaimerB = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapBId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapBId}.json`),
      nextMap: state.nextB,
      pausePhase: 'takeover-claimed',
    });
    await Promise.all([
      reclaimerA.waitForMessage('starting'),
      reclaimerB.waitForMessage('starting'),
    ]);
    const winner = await Promise.race([
      reclaimerA.waitForMessage('paused:takeover-claimed').then(() => reclaimerA),
      reclaimerB.waitForMessage('paused:takeover-claimed').then(() => reclaimerB),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(await claimResidue(state.projectRoot)).toHaveLength(1);
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));
    winner.child.send?.({ type: 'release' });

    const [resultA, resultB] = await Promise.all([reclaimerA.exit, reclaimerB.exit]);
    expect(resultA.code, resultA.stderr).toBe(0);
    expect(resultB.code, resultB.stderr).toBe(0);
    const lock = (await readJson(path.join(state.projectRoot, 'project.lock.json'))) as {
      readonly maps: ReadonlyArray<{ readonly id: string; readonly hash: string }>;
    };
    expect(lock.maps.find((entry) => entry.id === state.mapAId)?.hash).toBe(
      hashJsonStable(state.nextA),
    );
    expect(lock.maps.find((entry) => entry.id === state.mapBId)?.hash).toBe(
      hashJsonStable(state.nextB),
    );
    expect(await claimResidue(state.projectRoot)).toEqual([]);
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));
    await expectMissing(projectRevisionTransactionPath(state.projectRoot));
  });

  it('restores a live successor captured by a stale cleaner before entering', async () => {
    const state = await twoMapFixture();
    const dead = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapAId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapAId}.json`),
      nextMap: state.nextA,
      faultPhase: 'owner-acquired',
    });
    expect((await dead.exit).code).toBe(86);

    const staleCleaner = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapAId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapAId}.json`),
      nextMap: state.nextA,
      pausePhase: 'dead-owner-observed',
    });
    await staleCleaner.waitForMessage('paused:dead-owner-observed');
    const successor = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapBId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapBId}.json`),
      nextMap: state.nextB,
      pauseOnOwner: true,
    });
    await successor.waitForMessage('paused:owner-acquired');

    staleCleaner.child.send?.({ type: 'release-stale-cleaner' });
    const deadline = Date.now() + 3_000;
    let restoredOwnerPid: number | undefined;
    while (Date.now() < deadline) {
      try {
        const owner = (await readJson(
          path.join(projectRevisionOwnerPath(state.projectRoot), 'owner.json'),
        )) as {
          readonly ownerPid: number;
        };
        if ((await claimResidue(state.projectRoot)).length === 0) {
          restoredOwnerPid = owner.ownerPid;
          break;
        }
      } catch {
        // The stale cleaner has atomically moved the successor and is restoring it.
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(restoredOwnerPid).toBe(successor.child.pid);
    expect(staleCleaner.child.exitCode).toBeNull();

    successor.child.send?.({ type: 'release-successor' });
    const [successorResult, cleanerResult] = await Promise.all([successor.exit, staleCleaner.exit]);
    expect(successorResult.code, successorResult.stderr).toBe(0);
    expect(cleanerResult.code, cleanerResult.stderr).toBe(0);
    const lock = (await readJson(path.join(state.projectRoot, 'project.lock.json'))) as {
      readonly maps: ReadonlyArray<{ readonly id: string; readonly hash: string }>;
    };
    expect(lock.maps.find((entry) => entry.id === state.mapAId)?.hash).toBe(
      hashJsonStable(state.nextA),
    );
    expect(lock.maps.find((entry) => entry.id === state.mapBId)?.hash).toBe(
      hashJsonStable(state.nextB),
    );
    expect(await claimResidue(state.projectRoot)).toEqual([]);
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));
  });

  it('reacquires its exact restored candidate after the post-publication claim race', async () => {
    const state = await twoMapFixture();
    const dead = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapAId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapAId}.json`),
      nextMap: state.nextA,
      faultPhase: 'owner-acquired',
    });
    expect((await dead.exit).code).toBe(86);

    const staleCleaner = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapAId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapAId}.json`),
      nextMap: state.nextA,
      pausePhases: ['dead-owner-observed', 'stale-owner-captured'],
    });
    await staleCleaner.waitForMessage('paused:dead-owner-observed');
    const candidate = spawnTransactionWorker({
      projectRoot: state.projectRoot,
      projectId: state.projectId,
      mapId: state.mapBId,
      mapTarget: path.join(state.projectRoot, 'maps', `${state.mapBId}.json`),
      nextMap: state.nextB,
      pausePhases: ['owner-published', 'owner-acquired'],
    });
    await candidate.waitForMessage('paused:owner-published');

    staleCleaner.child.send?.({ type: 'observe-published-candidate' });
    await staleCleaner.waitForMessage('paused:stale-owner-captured');
    expect(await claimResidue(state.projectRoot)).toHaveLength(1);
    await expectMissing(projectRevisionOwnerPath(state.projectRoot));

    candidate.child.send?.({ type: 'scan-visible-claim' });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(candidate.child.exitCode).toBeNull();
    const restoredAt = Date.now();
    staleCleaner.child.send?.({ type: 'restore-candidate' });
    await candidate.waitForMessage('paused:owner-acquired');
    expect(Date.now() - restoredAt).toBeLessThan(1_000);
    expect(staleCleaner.child.exitCode).toBeNull();

    candidate.child.send?.({ type: 'release-candidate' });
    const [candidateResult, cleanerResult] = await Promise.all([candidate.exit, staleCleaner.exit]);
    expect(candidateResult.code, candidateResult.stderr).toBe(0);
    expect(cleanerResult.code, cleanerResult.stderr).toBe(0);
    const lock = (await readJson(path.join(state.projectRoot, 'project.lock.json'))) as {
      readonly maps: ReadonlyArray<{ readonly id: string; readonly hash: string }>;
    };
    expect(lock.maps.find((entry) => entry.id === state.mapAId)?.hash).toBe(
      hashJsonStable(state.nextA),
    );
    expect(lock.maps.find((entry) => entry.id === state.mapBId)?.hash).toBe(
      hashJsonStable(state.nextB),
    );
    expect(await readdir(path.join(state.projectRoot, '.tileborne'))).toEqual([]);
  });

  it('does not adopt a different owner token from the same process', async () => {
    const state = await fixture();
    const foreignOwner = {
      schemaVersion: 1,
      id: 'different-token-from-the-same-process',
      ownerPid: process.pid,
    };
    await writeJson(
      path.join(projectRevisionOwnerPath(state.projectRoot), 'owner.json'),
      foreignOwner,
    );
    let acquired = false;
    const startedAt = Date.now();
    await expect(
      commitMapProjectRevision({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        buildSnapshots: () => state.next,
        faultAfterPhase: async (phase) => {
          if (phase === 'owner-acquired') acquired = true;
          if (phase === 'foreign-live-owner-observed') {
            await new Promise((resolve) => setTimeout(resolve, 150));
            throw new Error('different same-process token remained foreign');
          }
        },
      }),
    ).rejects.toThrow('different same-process token remained foreign');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
    expect(acquired).toBe(false);
    expect(
      await readJson(path.join(projectRevisionOwnerPath(state.projectRoot), 'owner.json')),
    ).toEqual(foreignOwner);
    expect(await claimResidue(state.projectRoot)).toEqual([]);
  });

  for (const faultPhase of ['takeover-claimed', 'takeover-recovered'] as const) {
    it(`recovers after a reclaimer crashes at ${faultPhase}`, async () => {
      const state = await fixture();
      const dead = spawnTransactionWorker({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        nextMap: state.next.map,
        nextProject: state.next.project,
        faultPhase: 'prepared',
      });
      expect((await dead.exit).code).toBe(86);
      const crashedReclaimer = spawnTransactionWorker({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        nextMap: state.next.map,
        nextProject: state.next.project,
        faultPhase,
      });
      expect((await crashedReclaimer.exit).code).toBe(86);
      expect(await claimResidue(state.projectRoot)).toHaveLength(1);
      await expectMissing(projectRevisionOwnerPath(state.projectRoot));

      const retry = spawnTransactionWorker({
        projectRoot: state.projectRoot,
        projectId: state.projectId,
        mapId: state.mapId,
        mapTarget: state.mapTarget,
        nextMap: state.next.map,
        nextProject: state.next.project,
      });
      const retryResult = await retry.exit;
      expect(retryResult.code, retryResult.stderr).toBe(0);
      expect(await readJson(state.mapTarget)).toEqual(state.next.map);
      expect(await readJson(path.join(state.projectRoot, 'project.lock.json'))).toEqual(
        state.next.lock,
      );
      expect(await claimResidue(state.projectRoot)).toEqual([]);
      await expectMissing(projectRevisionOwnerPath(state.projectRoot));
      await expectMissing(projectRevisionTransactionPath(state.projectRoot));
    });
  }
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hashBytes, type BehaviorId, type JsonObject } from '@tileborne/core';

import { bundledMapPackages } from '../.generated/bundled-map-packages.js';
import { WorkerdBehaviorRuntimeClient } from '../behavior-runtime.js';
import { buildCloudflareGameHost } from '../build/cloudflare.js';
import {
  LocalBehaviorWorkerdSupervisor,
  type BehaviorRuntimeProcessEvent,
} from '../local/behavior-workerd-supervisor.js';
import { createLocalGameHost, type LocalGameHost } from '../local/launcher.js';
import type { PlaytestStartResponse, PlaytestSummary } from '../types.js';

const encoder = new TextEncoder();
const SAFE_ID = 'behavior:11111111-1111-4111-8111-111111111111' as BehaviorId;
const ESCAPE_ID = 'behavior:22222222-2222-4222-8222-222222222222' as BehaviorId;
const LOOP_ID = 'behavior:33333333-3333-4333-8333-333333333333' as BehaviorId;
const HEAP_ID = 'behavior:44444444-4444-4444-8444-444444444444' as BehaviorId;
const STRESS_ROUNDS = 3;

const modules = [
  {
    behaviorId: SAFE_ID,
    name: 'safe-counter',
    code: `export default {id:'test.safe-counter',sourceKind:'typescript',state:{ticks:0},on:{'runtime.tick':({state})=>state.set('ticks',state.get('ticks')+1)}};`,
  },
  {
    behaviorId: ESCAPE_ID,
    name: 'top-level-computed-constructor-escape',
    code: `const key='con'+'structor';let ambient='unverified';try{const factory=({})[key][key];ambient=factory('return typeof process+","+typeof fetch')()}catch{ambient='blocked'};export default {id:'test.top-level-computed-constructor-escape',sourceKind:'typescript',state:{ambient}};`,
  },
  {
    behaviorId: LOOP_ID,
    name: 'top-level-sync-loop',
    code: `while(true){};export default {id:'test.top-level-sync-loop',sourceKind:'typescript',state:{}};`,
  },
  {
    behaviorId: HEAP_ID,
    name: 'top-level-heap-growth',
    code: `const chunks=[];while(true){chunks.push(new Uint8Array(16777216))};export default {id:'test.top-level-heap-growth',sourceKind:'typescript',state:{}};`,
  },
] as const;

interface Fixture {
  readonly root: string;
  readonly outDir: string;
  readonly mapId: string;
  readonly mapPackage: JsonObject;
}

const makeFixture = async (): Promise<Fixture> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tileborne-behavior-isolation-'));
  const pluginRoot = path.join(root, 'plugin');
  const mapRoot = path.join(root, 'map');
  const outDir = path.join(root, 'out');
  await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  await mkdir(path.join(mapRoot, 'behaviors', 'modules'), { recursive: true });
  await writeFile(path.join(pluginRoot, 'dist/runtime.js'), 'export default {}\n', 'utf8');

  const base = structuredClone(bundledMapPackages[0]!.mapPackage) as JsonObject;
  const manifest = base.manifest as Record<string, unknown>;
  const mapId = String(manifest.mapId);
  const packageId = String(manifest.packageId);
  const artifacts = [];
  for (const module of modules) {
    const modulePath = `behaviors/modules/${module.name}.mjs`;
    await writeFile(path.join(mapRoot, modulePath), module.code, 'utf8');
    artifacts.push({
      behaviorId: module.behaviorId,
      sourceKind: 'typescript',
      modulePath,
      hash: hashBytes(encoder.encode(module.code)),
    });
  }
  (base as Record<string, unknown>).behaviors = {
    schemaVersion: 1,
    manifests: [],
    visualDefinitions: [],
    modules: artifacts,
  };
  await writeFile(path.join(mapRoot, 'package.json'), JSON.stringify(base), 'utf8');

  await buildCloudflareGameHost({
    outDir,
    pluginId: '@tileborne-plugins/isolation-fixture',
    pluginVersion: '1.0.0',
    pluginRoot,
    assetPacks: [],
    mapPackages: [{ mapId, packageId, sourceDir: mapRoot, mapPackage: base }],
    runtimeVersion: '1.0.0',
    siteName: 'behavior-isolation-fixture',
    createdAt: '2026-07-14T00:00:00.000Z',
  });
  return { root, outDir, mapId, mapPackage: base };
};

const postJson = (host: LocalGameHost, pathname: string, body: unknown) =>
  host.fetch(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const withDeadline = async <T>(
  operation: Promise<T>,
  durationMs: number,
  description: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${description} exceeded outer ${durationMs}ms deadline`)),
          durationMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const expectEveryProcessGroupExited = (events: readonly BehaviorRuntimeProcessEvent[]): void => {
  const spawned = events
    .filter((event) => event.phase === 'spawned')
    .map((event) => event.processId)
    .sort((left, right) => left - right);
  const exited = events
    .filter((event) => event.phase === 'exited')
    .map((event) => event.processId)
    .sort((left, right) => left - right);
  expect(spawned.length).toBeGreaterThan(0);
  expect(exited).toEqual(spawned);
};

describe('workerd behavior service isolation', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map(async (cleanup) => await cleanup()));
  });

  it('repeatedly contains ambient escape, sync loop, and heap growth while RoomObject recovers', async () => {
    const fixture = await makeFixture();
    cleanups.push(async () => await rm(fixture.root, { recursive: true, force: true }));
    const mainSource = await readFile(path.join(fixture.outDir, 'worker.js'), 'utf8');
    const behaviorSource = await readFile(path.join(fixture.outDir, 'behavior-worker.js'), 'utf8');
    expect(mainSource).not.toContain('test.top-level-computed-constructor-escape');
    expect(mainSource).not.toContain('test.top-level-sync-loop');
    expect(behaviorSource).toContain('test.top-level-computed-constructor-escape');
    expect(behaviorSource).toContain('test.top-level-sync-loop');
    expect(behaviorSource).toContain('createNamespace');

    const runRound = async (round: number): Promise<void> => {
      const directEvents: BehaviorRuntimeProcessEvent[] = [];
      const directSupervisor = new LocalBehaviorWorkerdSupervisor({
        workerPath: path.join(fixture.outDir, 'behavior-worker.js'),
        maxWallTimeMs: 250,
        maxDisposeTimeMs: 250,
        observeProcess: (event) => directEvents.push(event),
      });
      try {
        await withDeadline(directSupervisor.warmup(), 35_000, 'direct supervisor cold startup');
        const client = new WorkerdBehaviorRuntimeClient({
          binding: { fetch: (request) => directSupervisor.fetch(request) },
          mapPackage: fixture.mapPackage,
          seed: `isolation-proof-${round}`,
        });
        const firstStep = await client.step(1);
        expect(firstStep).toMatchObject({
          status: 'advanced',
          advancedBehaviorIds: expect.arrayContaining([SAFE_ID, ESCAPE_ID]),
        });
        expect(client.snapshot?.states).toContainEqual({
          behaviorId: SAFE_ID,
          state: { ticks: 1 },
        });
        expect(client.snapshot?.states).toContainEqual({
          behaviorId: ESCAPE_ID,
          state: { ambient: 'blocked' },
        });
        expect(client.quarantinedBehaviorIds).toEqual(new Set([LOOP_ID, HEAP_ID]));
        const secondStep = await client.step(2);
        expect(secondStep).toMatchObject({
          status: 'advanced',
          advancedBehaviorIds: expect.arrayContaining([SAFE_ID]),
        });
        expect(client.snapshot?.states).toContainEqual({
          behaviorId: SAFE_ID,
          state: { ticks: 2 },
        });
      } finally {
        await withDeadline(directSupervisor.dispose(), 5_000, 'direct supervisor shutdown');
      }
      expectEveryProcessGroupExited(directEvents);

      const hostEvents: BehaviorRuntimeProcessEvent[] = [];
      const host = await createLocalGameHost({
        port: 0,
        workerPath: path.join(fixture.outDir, 'worker.js'),
        behaviorWorkerPath: path.join(fixture.outDir, 'behavior-worker.js'),
        behaviorMaxWallTimeMs: 250,
        behaviorMaxDisposeTimeMs: 250,
        observeBehaviorProcess: (event) => hostEvents.push(event),
      });
      try {
        const roomId = `behavior-isolation-room-${round}`;
        const created = await postJson(host, '/rooms/create', {
          mapId: fixture.mapId,
          seed: 42,
          options: { idempotencyKey: roomId, minReadyPlayers: 1, countdownSeconds: 0 },
        });
        expect(created.status).toBe(201);
        const joined = await postJson(host, '/playtest/start', {
          mapId: fixture.mapId,
          seed: 42,
          options: { idempotencyKey: roomId },
        });
        expect(joined.status).toBe(201);
        const credentials = (await joined.json()) as PlaytestStartResponse;
        const ready = await postJson(host, `/lobbies/${roomId}/ready`, {
          playerId: credentials.playerId,
          ready: true,
          reconnectToken: credentials.reconnectToken,
        });
        expect(ready.status).toBe(200);
        await host.triggerRoomAlarm(roomId);
        const first = (await (await host.fetch(`/playtest/${roomId}`)).json()) as PlaytestSummary;
        expect(first.metrics.tick).toBeGreaterThan(0);
        await host.triggerRoomAlarm(roomId);
        const second = (await (await host.fetch(`/playtest/${roomId}`)).json()) as PlaytestSummary;
        expect(second.metrics.tick).toBeGreaterThan(first.metrics.tick);
      } finally {
        await withDeadline(host.stop(), 10_000, 'local game host shutdown');
      }
      expectEveryProcessGroupExited(hostEvents);
    };

    for (let round = 1; round <= STRESS_ROUNDS; round += 1) {
      await withDeadline(runRound(round), 75_000, `behavior isolation round ${round}`);
    }
  }, 240_000);
});

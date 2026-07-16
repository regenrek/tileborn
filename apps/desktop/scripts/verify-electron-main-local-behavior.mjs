import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

import { hashBytes } from '@tileborne/core';
import { buildCloudflareGameHost } from '@tileborne/game-host';

import { bundledMapPackages } from '../../game-host/dist/.generated/bundled-map-packages.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const viteBin = path.join(desktopRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const bundlePath = path.join(desktopRoot, '.vite', 'build', 'local-game-host.cjs');
const behaviorId = 'behavior:55555555-5555-4555-8555-555555555555';

const withDeadline = async (operation, durationMs, label) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${durationMs}ms`)),
          durationMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const buildBehaviorFixture = async (root) => {
  const pluginRoot = path.join(root, 'plugin');
  const mapRoot = path.join(root, 'map');
  const outDir = path.join(root, 'out');
  await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  await mkdir(path.join(mapRoot, 'behaviors', 'modules'), { recursive: true });
  await writeFile(path.join(pluginRoot, 'dist/runtime.js'), 'export default {}\n', 'utf8');

  const base = JSON.parse(JSON.stringify(bundledMapPackages[0].mapPackage));
  const mapId = String(base.manifest.mapId);
  const packageId = String(base.manifest.packageId);
  const code = `export default {id:'test.electron-main-counter',sourceKind:'typescript',state:{ticks:0},on:{'runtime.tick':({state,event})=>state.set('ticks',event.tick)}};`;
  const modulePath = 'behaviors/modules/electron-main-counter.mjs';
  await writeFile(path.join(mapRoot, modulePath), code, 'utf8');
  base.behaviors = {
    schemaVersion: 1,
    manifests: [],
    visualDefinitions: [],
    modules: [
      {
        behaviorId,
        sourceKind: 'typescript',
        modulePath,
        hash: hashBytes(new TextEncoder().encode(code)),
      },
    ],
  };
  await writeFile(path.join(mapRoot, 'package.json'), JSON.stringify(base), 'utf8');

  await buildCloudflareGameHost({
    outDir,
    pluginId: '@tileborne-plugins/electron-main-fixture',
    pluginVersion: '1.0.0',
    pluginRoot,
    assetPacks: [],
    mapPackages: [{ mapId, packageId, sourceDir: mapRoot, mapPackage: base }],
    runtimeVersion: '1.0.0',
    siteName: 'electron-main-behavior-fixture',
    createdAt: '2026-07-15T00:00:00.000Z',
  });
  return { outDir, mapId };
};

const root = await mkdtemp(path.join(tmpdir(), 'tileborne-electron-main-behavior-'));
let host;
try {
  execFileSync(process.execPath, [viteBin, 'build', '--config', 'vite.main.config.ts'], {
    cwd: desktopRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60_000,
  });
  const bundleSource = await readFile(bundlePath, 'utf8');
  assert.doesNotMatch(bundleSource, /\{\}\.resolve/);
  assert.match(bundleSource, /createRequire/);
  assert.match(bundleSource, /ELECTRON_RUN_AS_NODE/);

  const fixture = await withDeadline(
    buildBehaviorFixture(root),
    120_000,
    'behavior Ship fixture build',
  );
  const bundleRequire = createRequire(bundlePath);
  const resolvedMiniflare = bundleRequire.resolve('miniflare');
  assert.ok(resolvedMiniflare.split(path.sep).includes('node_modules'));
  const { createLocalGameHost } = bundleRequire(bundlePath);
  const processEvents = [];
  host = await withDeadline(
    createLocalGameHost({
      port: 0,
      workerPath: path.join(fixture.outDir, 'worker.js'),
      behaviorWorkerPath: path.join(fixture.outDir, 'behavior-worker.js'),
      behaviorMaxWallTimeMs: 1_000,
      behaviorMaxDisposeTimeMs: 1_000,
      observeBehaviorProcess: (event) => processEvents.push(event),
    }),
    45_000,
    'fresh Electron main local behavior host startup',
  );
  const postJson = (pathname, body) =>
    host.fetch(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const roomId = 'electron-main-behavior-room';
  const created = await postJson('/rooms/create', {
    mapId: fixture.mapId,
    seed: 42,
    options: { idempotencyKey: roomId, minReadyPlayers: 1, countdownSeconds: 0 },
  });
  assert.equal(created.status, 201);
  const joined = await postJson('/playtest/start', {
    mapId: fixture.mapId,
    seed: 42,
    options: { idempotencyKey: roomId },
  });
  assert.equal(joined.status, 201);
  const credentials = await joined.json();
  const ready = await postJson(`/lobbies/${roomId}/ready`, {
    playerId: credentials.playerId,
    ready: true,
    reconnectToken: credentials.reconnectToken,
  });
  assert.equal(ready.status, 200);
  await withDeadline(host.triggerRoomAlarm(roomId), 15_000, 'first behavior room tick');
  const first = await (await host.fetch(`/playtest/${roomId}`)).json();
  await withDeadline(host.triggerRoomAlarm(roomId), 15_000, 'second behavior room tick');
  const second = await (await host.fetch(`/playtest/${roomId}`)).json();
  assert.ok(first.metrics.tick > 0);
  assert.ok(second.metrics.tick > first.metrics.tick);

  await withDeadline(host.stop(), 15_000, 'fresh Electron main local host shutdown');
  host = undefined;
  const spawned = processEvents
    .filter((event) => event.phase === 'spawned')
    .map((event) => event.processId);
  const exited = processEvents
    .filter((event) => event.phase === 'exited')
    .map((event) => event.processId);
  assert.ok(spawned.length > 0);
  assert.deepEqual(exited, spawned);

  console.log(
    JSON.stringify({
      ok: true,
      firstTick: first.metrics.tick,
      secondTick: second.metrics.tick,
      behaviorProcessGroups: spawned.length,
      miniflare: resolvedMiniflare,
    }),
  );
} finally {
  if (host !== undefined) {
    await withDeadline(host.stop(), 15_000, 'failed verification host shutdown').catch(
      () => undefined,
    );
  }
  await rm(root, { recursive: true, force: true });
}

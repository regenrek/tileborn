#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL, URL } from 'node:url';

import { inventoryArtifact } from './shipped-artifact-evidence.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const required = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  return path.resolve(value);
};
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) throw new Error('non-canonical JSON value');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
};
const stableHash = (value) => `sha256:${sha256(canonicalJson(value))}`;

export const validateBuildArtifact = async (artifactRoot) => {
  const recordBytes = await readFile(path.join(artifactRoot, 'build-artifact.json'));
  const record = JSON.parse(recordBytes.toString('utf8'));
  const { integrityHash, ...payload } = record;
  if (stableHash(payload) !== integrityHash) throw new Error('build-artifact integrityHash mismatch');
  if (!Array.isArray(record.files) || typeof record.fileHashes !== 'object')
    throw new Error('invalid build-artifact inventory');
  if (
    new Set(record.files).size !== record.files.length ||
    Object.keys(record.fileHashes).length !== record.files.length
  )
    throw new Error('build-artifact inventory is inconsistent');
  for (const file of record.files) {
    const bytes = await readFile(path.join(artifactRoot, file));
    if (`sha256:${sha256(bytes)}` !== record.fileHashes[file])
      throw new Error(`build-artifact checksum mismatch: ${file}`);
  }
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'manifest.json'), 'utf8'));
  if (manifest.buildId !== record.runtimeBuildId)
    throw new Error('runtime manifest does not match build-artifact runtimeBuildId');
  return { record, manifest };
};

export const inventoryRuntimeClosure = async (directory) => {
  const root = await realpath(directory);
  const files = [];
  const symlinks = [];
  const visit = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        const resolved = await realpath(absolute);
        const target = path.relative(root, resolved);
        if (target === '' || target.startsWith('..') || path.isAbsolute(target))
          throw new Error(`runtime symlink escapes closure: ${relative} -> ${resolved}`);
        symlinks.push({ path: relative, target });
        continue;
      }
      if (metadata.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`unsupported runtime entry: ${relative}`);
      const bytes = await readFile(absolute);
      files.push({ path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  };
  await visit(root);
  const treeSha256 = sha256(`${JSON.stringify({ files, symlinks })}\n`);
  return { files, symlinks, treeSha256 };
};

const jsonFetch = async (baseUrl, route, init) => {
  const response = await globalThis.fetch(new URL(route, baseUrl), init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${route} failed ${response.status}: ${JSON.stringify(body)}`);
  return { status: response.status, body };
};

const waitFor = async (operation, predicate, label, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await operation();
      if (predicate(last)) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
};

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = new globalThis.WebSocket(url);
    const timer = setTimeout(() => reject(new Error(`websocket timeout: ${url}`)), 30_000);
    let messages = 0;
    socket.addEventListener('message', () => {
      messages += 1;
    });
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({ socket, messageCount: () => messages });
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`websocket failed: ${url}`));
    });
  });

const processTable = () =>
  execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      return match === null
        ? []
        : [{ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] }];
    });

const descendantProcesses = (rootPid, table = processTable()) => {
  const selected = [];
  const parents = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table) {
      if (parents.has(entry.parentPid) && !parents.has(entry.pid)) {
        parents.add(entry.pid);
        selected.push(entry);
        changed = true;
      }
    }
  }
  return selected;
};

const executeShippedBehaviors = async ({ artifactRoot, runtimeMain, packageId, behaviors }) => {
  const runtimeRequire = createRequire(runtimeMain);
  const miniflareUrl = pathToFileURL(runtimeRequire.resolve('miniflare')).href;
  const { Miniflare } = await import(miniflareUrl);
  const runtime = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    modules: true,
    scriptPath: path.join(artifactRoot, 'behavior-worker.js'),
    modulesRoot: artifactRoot,
    compatibilityDate: '2024-12-01',
  });
  await runtime.ready;
  try {
    const observations = [];
    for (const behavior of behaviors) {
      const response = await runtime.dispatchFetch('http://behavior/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 1,
          packageId,
          seed: 'external-artifact-oracle',
          operation: { kind: 'step', tick: 1, targetBehaviorId: behavior.behaviorId },
        }),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(`behavior failed: ${JSON.stringify(body)}`);
      const trace = body.traces.find((entry) => entry.behaviorId === behavior.behaviorId);
      const state = body.snapshot.states.find((entry) => entry.behaviorId === behavior.behaviorId);
      if (trace?.sourceKind !== behavior.sourceKind || state?.state?.proof !== true)
        throw new Error(`behavior proof missing: ${behavior.behaviorId}`);
      observations.push({
        behaviorId: behavior.behaviorId,
        sourceKind: trace.sourceKind,
        state: state.state,
        traceCount: body.traces.length,
        diagnostics: body.diagnostics,
      });
    }
    return observations;
  } finally {
    await runtime.dispose();
  }
};

export const runExternalShippedArtifactOracle = async ({
  runRoot,
  sourceReceiptPath,
  runtimeMain,
  port,
  forbiddenRoots,
}) => {
  const artifactRoot = path.join(runRoot, 'artifact');
  const evidenceRoot = path.join(runRoot, 'evidence');
  await mkdir(evidenceRoot, { recursive: true });
  const resolvedRun = path.resolve(runRoot);
  for (const root of forbiddenRoots) {
    const relative = path.relative(path.resolve(root), resolvedRun);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
      throw new Error(`run root is inside forbidden checkout/workspace: ${root}`);
  }
  const sourceReceiptBytes = await readFile(sourceReceiptPath);
  const sourceReceipt = JSON.parse(sourceReceiptBytes.toString('utf8'));
  const sourceInventory = {
    files: sourceReceipt.shippedArtifact.files,
    treeSha256: sourceReceipt.shippedArtifact.treeSha256,
  };
  const preInventory = await inventoryArtifact(artifactRoot);
  if (JSON.stringify(preInventory) !== JSON.stringify(sourceInventory))
    throw new Error('external artifact does not match source receipt');
  const { record, manifest } = await validateBuildArtifact(artifactRoot);

  const runtimeRoot = path.resolve(path.dirname(runtimeMain), '..');
  const runtimeInventory = await inventoryRuntimeClosure(runtimeRoot);
  const stdout = [];
  const stderr = [];
  const child = spawn(
    process.execPath,
    [runtimeMain, 'game', 'serve', '--json', `--port=${port}`, `--dir=${artifactRoot}`],
    { cwd: runRoot, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  let exit;
  let descendantsBeforeShutdown;
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const observations = {};
  try {
    observations.health = await waitFor(
      () => jsonFetch(baseUrl, '/health'),
      (value) => value?.body?.status === 'ok',
      'health',
    );
    observations.discover = await jsonFetch(baseUrl, '/discover');
    const mapId = sourceReceipt.mapId;
    const idempotencyKey = `external-${randomUUID()}`;
    observations.room = await jsonFetch(baseUrl, '/rooms/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapId, options: { idempotencyKey } }),
    });
    const roomId = observations.room.body.roomId;
    const players = [];
    for (const playerId of ['player-1', 'player-2']) {
      const joined = await jsonFetch(baseUrl, '/playtest/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId, playerId, options: { idempotencyKey: roomId } }),
      });
      const connection = await connect(joined.body.wsUrl);
      players.push({ playerId, joined, ...connection });
    }
    for (const player of players) {
      player.ready = await jsonFetch(baseUrl, `/lobbies/${roomId}/ready`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: player.playerId,
          ready: true,
          reconnectToken: player.joined.body.reconnectToken,
        }),
      });
    }
    observations.activeLobby = await waitFor(
      () => jsonFetch(baseUrl, `/lobbies/${roomId}`),
      (value) => value?.body?.phase === 'active' || value?.body?.phase === 'completed',
      'active lobby',
    );
    observations.progress = await waitFor(
      () => jsonFetch(baseUrl, `/playtest/${roomId}`),
      (value) => Number(value?.body?.metrics?.tickCount ?? 0) > 0 || value?.body?.lastTickAt !== null,
      'match progress',
    );
    observations.results = await waitFor(
      () => jsonFetch(baseUrl, `/rooms/${roomId}/results`),
      (value) => value?.body?.results !== null,
      'match results',
    );
    observations.summary = await jsonFetch(baseUrl, `/playtest/${roomId}`);
    observations.players = players.map((player) => ({
      playerId: player.playerId,
      joinStatus: player.joined.status,
      readyStatus: player.ready.status,
      websocketMessages: player.messageCount(),
    }));
    for (const player of players) player.socket.close(1000, 'oracle complete');

    const mapDirectory = path.dirname(
      sourceReceipt.shippedArtifact.files.find((entry) => entry.path.endsWith('/behaviors.json')).path,
    );
    const behaviorPackage = JSON.parse(
      await readFile(path.join(artifactRoot, mapDirectory, 'behaviors.json'), 'utf8'),
    );
    const mapPackageManifest = JSON.parse(
      await readFile(path.join(artifactRoot, mapDirectory, 'manifest.json'), 'utf8'),
    );
    const representative = ['visual', 'typescript'].map((sourceKind) => {
      const module = behaviorPackage.modules.find((entry) => entry.sourceKind === sourceKind);
      if (module === undefined) throw new Error(`shipped ${sourceKind} behavior missing`);
      return module;
    });
    observations.behaviors = await executeShippedBehaviors({
      artifactRoot,
      runtimeMain,
      packageId: mapPackageManifest.packageId,
      behaviors: representative,
    });
    descendantsBeforeShutdown = descendantProcesses(child.pid);
  } finally {
    child.kill('SIGTERM');
    exit = await Promise.race([exited, sleep(10_000).then(() => null)]);
    if (exit === null) {
      child.kill('SIGKILL');
      exit = await exited;
    }
  }
  if (exit.code !== 0 || exit.signal !== null)
    throw new Error(`serve process did not stop cleanly: ${JSON.stringify(exit)}`);

  const postInventory = await inventoryArtifact(artifactRoot);
  if (JSON.stringify(postInventory) !== JSON.stringify(preInventory))
    throw new Error('artifact changed during boot');
  await validateBuildArtifact(artifactRoot);

  const tamperRoot = path.join(runRoot, 'tamper-negative');
  await cp(artifactRoot, tamperRoot, { recursive: true });
  await writeFile(path.join(tamperRoot, 'worker.js'), '\n// tampered\n', { flag: 'a' });
  let tamperError;
  try {
    await validateBuildArtifact(tamperRoot);
  } catch (error) {
    tamperError = error instanceof Error ? error.message : String(error);
  }
  if (!tamperError?.includes('checksum mismatch')) throw new Error('tamper negative did not fail closed');

  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'serve.stdout.log'), stdoutBytes),
    writeFile(path.join(evidenceRoot, 'serve.stderr.log'), stderrBytes),
  ]);
  const descendantsAfterShutdown = descendantProcesses(child.pid);
  if (descendantsAfterShutdown.length !== 0)
    throw new Error(`runtime descendants survived shutdown: ${JSON.stringify(descendantsAfterShutdown)}`);
  const receipt = {
    schemaVersion: 1,
    state: 'closed',
    runId: path.basename(runRoot),
    runRoot,
    forbiddenRoots,
    source: {
      receiptPath: sourceReceiptPath,
      receiptSha256: sha256(sourceReceiptBytes),
      gitHead: sourceReceipt.runnerPreflight.gitHead,
      artifactTreeSha256: sourceInventory.treeSha256,
    },
    destination: {
      artifactRoot,
      pre: preInventory,
      post: postInventory,
      buildId: record.buildId,
      runtimeBuildId: record.runtimeBuildId,
      manifestBuildId: manifest.buildId,
    },
    runtime: {
      root: runtimeRoot,
      main: runtimeMain,
      treeSha256: runtimeInventory.treeSha256,
      fileCount: runtimeInventory.files.length,
      symlinkCount: runtimeInventory.symlinks.length,
      symlinks: runtimeInventory.symlinks,
    },
    process: {
      pid: child.pid,
      port,
      baseUrl,
      exit,
      descendantsBeforeShutdown,
      descendantsAfterShutdown,
      stdout: { file: 'serve.stdout.log', bytes: stdoutBytes.byteLength, sha256: sha256(stdoutBytes) },
      stderr: { file: 'serve.stderr.log', bytes: stderrBytes.byteLength, sha256: sha256(stderrBytes) },
    },
    observations,
    tamperNegative: { mutation: 'append worker.js', rejectedWith: tamperError },
  };
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const temporary = path.join(evidenceRoot, `receipt.json.tmp-${process.pid}`);
  const target = path.join(evidenceRoot, 'receipt.json');
  await writeFile(temporary, receiptBytes, { flag: 'wx' });
  await rename(temporary, target);
  return { receiptPath: target, sha256: sha256(receiptBytes), receipt };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExternalShippedArtifactOracle({
    runRoot: required(arg('--run-root'), '--run-root'),
    sourceReceiptPath: required(arg('--source-receipt'), '--source-receipt'),
    runtimeMain: required(arg('--runtime-main'), '--runtime-main'),
    port: Number(arg('--port') ?? 19_876),
    forbiddenRoots: process.argv
      .flatMap((value, index) => (value === '--forbidden-root' ? [process.argv[index + 1]] : []))
      .map((value) => required(value, '--forbidden-root')),
  })
    .then(({ receiptPath, sha256: digest }) => console.log(JSON.stringify({ receiptPath, sha256: digest })))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

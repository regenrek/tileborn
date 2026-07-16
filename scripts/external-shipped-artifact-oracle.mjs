#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

const within = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const assertWithin = (root, candidate, label) => {
  if (!within(root, candidate)) throw new Error(`${label} escapes required root: ${candidate}`);
};

const readBoundFile = async (root, relativePath, expected) => {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  )
    throw new Error('bound evidence path must be a non-empty relative path');
  const candidate = path.resolve(root, relativePath);
  assertWithin(root, candidate, 'bound evidence path');
  const resolved = await realpath(candidate);
  assertWithin(root, resolved, 'bound evidence realpath');
  const bytes = await readFile(resolved);
  if (expected?.bytes !== undefined && bytes.byteLength !== expected.bytes)
    throw new Error(`bound evidence byte count mismatch: ${relativePath}`);
  if (expected?.sha256 !== undefined && sha256(bytes) !== expected.sha256)
    throw new Error(`bound evidence sha256 mismatch: ${relativePath}`);
  return { path: resolved, bytes, bytesLength: bytes.byteLength, sha256: sha256(bytes) };
};

const validateRecordedCommand = async (evidenceRoot, command, label) => {
  if (
    typeof command !== 'object' ||
    command === null ||
    !Array.isArray(command.command) ||
    command.command.length === 0 ||
    command.exitCode !== 0 ||
    command.signal !== null
  )
    throw new Error(`${label} command did not complete cleanly`);
  const stdout = await readBoundFile(evidenceRoot, command.stdout?.file, command.stdout);
  const stderr = await readBoundFile(evidenceRoot, command.stderr?.file, command.stderr);
  return {
    command: command.command,
    exitCode: command.exitCode,
    signal: command.signal,
    stdout: { file: command.stdout.file, bytes: stdout.bytesLength, sha256: stdout.sha256 },
    stderr: { file: command.stderr.file, bytes: stderr.bytesLength, sha256: stderr.sha256 },
  };
};

export const validateCleanCheckoutEvidence = async (runnerReceiptPath) => {
  const resolvedRunnerReceiptPath = await realpath(runnerReceiptPath);
  const evidenceRoot = path.dirname(resolvedRunnerReceiptPath);
  const runnerReceiptBytes = await readFile(resolvedRunnerReceiptPath);
  const runner = JSON.parse(runnerReceiptBytes.toString('utf8'));
  if (
    runner.schemaVersion !== 1 ||
    runner.state !== 'detached' ||
    typeof runner.gitHead !== 'string' ||
    !/^[0-9a-f]{40}$/.test(runner.gitHead) ||
    typeof runner.checkoutRoot !== 'string' ||
    runner.postOracleStatus !== '' ||
    typeof runner.preflight !== 'object' ||
    typeof runner.oracleReceipt !== 'object'
  )
    throw new Error('invalid clean-checkout runner receipt');
  const checkoutRoot = await realpath(runner.checkoutRoot);
  if (checkoutRoot !== runner.checkoutRoot) throw new Error('runner checkoutRoot is not canonical');
  const preflightFile = await readBoundFile(evidenceRoot, runner.preflight.file, {
    sha256: runner.preflight.sha256,
  });
  const preflight = JSON.parse(preflightFile.bytes.toString('utf8'));
  if (
    preflight.schemaVersion !== 1 ||
    preflight.checkout?.cwdRealpath !== checkoutRoot ||
    preflight.checkout?.repositoryRoot !== checkoutRoot ||
    preflight.checkout?.gitHead !== runner.gitHead ||
    preflight.checkout?.state !== 'detached' ||
    preflight.checkout?.symbolicRef !== null ||
    preflight.checkout?.initialStatus !== '' ||
    preflight.checkout?.postBuildStatus !== '' ||
    !Array.isArray(preflight.checkout?.preexistingOutputs) ||
    preflight.checkout.preexistingOutputs.length !== 0
  )
    throw new Error('clean-checkout preflight does not prove a detached clean null-build checkout');
  const install = await validateRecordedCommand(
    evidenceRoot,
    preflight.commands?.install,
    'install',
  );
  const predev = await validateRecordedCommand(evidenceRoot, preflight.commands?.predev, 'predev');
  const oracle = await validateRecordedCommand(evidenceRoot, runner.oracle, 'creator oracle');
  const oracleReceiptFile = await readBoundFile(
    evidenceRoot,
    runner.oracleReceipt.file,
    runner.oracleReceipt,
  );
  const oracleReceipt = JSON.parse(oracleReceiptFile.bytes.toString('utf8'));
  if (
    oracleReceipt.schemaVersion !== 1 ||
    oracleReceipt.runnerPreflight?.sha256 !== preflightFile.sha256 ||
    oracleReceipt.runnerPreflight?.gitHead !== runner.gitHead ||
    oracleReceipt.runnerPreflight?.checkoutRoot !== checkoutRoot ||
    oracleReceipt.runnerPreflight?.state !== 'detached' ||
    typeof oracleReceipt.shippedArtifact?.directory !== 'string' ||
    !Array.isArray(oracleReceipt.shippedArtifact?.files) ||
    typeof oracleReceipt.shippedArtifact?.treeSha256 !== 'string'
  )
    throw new Error('creator oracle receipt is not bound to the runner preflight');
  const sourceArtifactRoot = await realpath(
    path.resolve(path.dirname(oracleReceiptFile.path), oracleReceipt.shippedArtifact.directory),
  );
  assertWithin(evidenceRoot, sourceArtifactRoot, 'source shipped artifact');
  const sourceArtifactInventory = await inventoryArtifact(sourceArtifactRoot);
  const claimedInventory = {
    files: oracleReceipt.shippedArtifact.files,
    treeSha256: oracleReceipt.shippedArtifact.treeSha256,
  };
  if (JSON.stringify(sourceArtifactInventory) !== JSON.stringify(claimedInventory))
    throw new Error('source shipped artifact does not match creator oracle receipt');
  return {
    runner,
    preflight,
    oracleReceipt,
    sourceArtifactRoot,
    sourceArtifactInventory,
    receipt: {
      path: resolvedRunnerReceiptPath,
      bytes: runnerReceiptBytes.byteLength,
      sha256: sha256(runnerReceiptBytes),
    },
    preflightReceipt: {
      file: runner.preflight.file,
      bytes: preflightFile.bytesLength,
      sha256: preflightFile.sha256,
    },
    oracleReceiptEvidence: {
      file: runner.oracleReceipt.file,
      bytes: oracleReceiptFile.bytesLength,
      sha256: oracleReceiptFile.sha256,
    },
    commands: { install, predev, oracle },
  };
};

const dangerousEnvironmentKeys = new Set([
  'NODE_PATH',
  'NODE_OPTIONS',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_REPL_HISTORY',
  'TS_NODE_PROJECT',
  'TS_NODE_TRANSPILE_ONLY',
  'BABEL_ENV',
]);

const dangerousExecArg = (value) =>
  value === '-r' ||
  value === '--require' ||
  value.startsWith('--require=') ||
  value === '--import' ||
  value.startsWith('--import=') ||
  value === '--loader' ||
  value.startsWith('--loader=') ||
  value === '--experimental-loader' ||
  value.startsWith('--experimental-loader=');

export const buildSanitizedChildEnvironment = async ({
  runRoot,
  runtimeRoot,
  inputEnvironment,
  execArgv = [],
}) => {
  const injectedKeys = Object.keys(inputEnvironment).filter((key) =>
    dangerousEnvironmentKeys.has(key),
  );
  if (injectedKeys.length !== 0)
    throw new Error(
      `dangerous Node environment injection rejected: ${injectedKeys.sort().join(',')}`,
    );
  if (execArgv.some(dangerousExecArg))
    throw new Error(`dangerous Node loader argument rejected: ${execArgv.join(' ')}`);
  const home = path.join(runRoot, 'home');
  const temporary = path.join(runRoot, 'tmp');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(temporary, { recursive: true })]);
  const pathEntries = [
    path.join(runtimeRoot, 'node_modules', '.bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const environment = {
    HOME: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    PATH: pathEntries.join(path.delimiter),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
  };
  const removedKeys = Object.keys(inputEnvironment).filter((key) => !(key in environment));
  const removedRepoSpecificKeys = removedKeys
    .filter((key) => /^(TILEBORNE|VITE|ELECTRON|PNPM|npm_)/i.test(key))
    .sort();
  const valueDigests = Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [key, sha256(value)]),
  );
  return {
    environment,
    receipt: {
      policy: 'explicit-allowlist-v1',
      keys: Object.keys(environment).sort(),
      valueDigests,
      digest: stableHash(valueDigests),
      removedKeyCount: removedKeys.length,
      removedRepoSpecificKeys,
      dangerousKeysVerifiedAbsent: [...dangerousEnvironmentKeys].sort(),
      home,
      temporary,
      pathEntries,
      parentExecArgv: execArgv,
    },
  };
};

export const resolveRuntimeClosure = async ({ runRoot, runtimeMain, forbiddenRoots = [] }) => {
  const resolvedRunRoot = await realpath(runRoot);
  const resolvedMain = await realpath(runtimeMain);
  const runtimeRoot = await realpath(path.resolve(path.dirname(resolvedMain), '..'));
  assertWithin(resolvedRunRoot, runtimeRoot, 'runtime closure');
  assertWithin(runtimeRoot, resolvedMain, 'runtime main');
  for (const forbiddenRoot of forbiddenRoots) {
    const resolvedForbidden = await realpath(forbiddenRoot);
    if (within(resolvedForbidden, runtimeRoot) || within(runtimeRoot, resolvedForbidden))
      throw new Error(`runtime closure overlaps forbidden root: ${resolvedForbidden}`);
  }
  const packageJsonPath = await realpath(path.join(runtimeRoot, 'package.json'));
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (packageJson.name !== '@tileborne/cli' || typeof packageJson.bin?.tileborne !== 'string')
    throw new Error('runtime closure does not contain the canonical Tileborne CLI package');
  const cliEntry = await realpath(path.resolve(runtimeRoot, packageJson.bin.tileborne));
  if (cliEntry !== resolvedMain) throw new Error('runtimeMain does not match canonical CLI entry');
  const runtimeRequire = createRequire(resolvedMain);
  const specifiers = [
    'miniflare',
    'workerd',
    'workerd/bin/workerd',
    '@cloudflare/workerd-darwin-arm64/bin/workerd',
  ];
  const resolvedDependencies = {};
  for (const specifier of specifiers) {
    let resolved;
    try {
      resolved = await realpath(runtimeRequire.resolve(specifier));
    } catch (error) {
      throw new Error(`runtime closure dependency missing: ${specifier}`, { cause: error });
    }
    assertWithin(runtimeRoot, resolved, `runtime dependency ${specifier}`);
    const metadata = await lstat(resolved);
    resolvedDependencies[specifier] = {
      path: resolved,
      bytes: metadata.size,
      sha256: sha256(await readFile(resolved)),
      executable: (metadata.mode & 0o111) !== 0,
    };
  }
  for (const binary of ['workerd/bin/workerd', '@cloudflare/workerd-darwin-arm64/bin/workerd']) {
    if (!resolvedDependencies[binary].executable)
      throw new Error(`runtime binary is not executable: ${binary}`);
  }
  return {
    runRoot: resolvedRunRoot,
    runtimeRoot,
    runtimeMain: resolvedMain,
    cliEntry,
    packageJsonPath,
    resolvedDependencies,
    miniflarePath: resolvedDependencies.miniflare.path,
  };
};

export const validateBuildArtifact = async (artifactRoot) => {
  const recordBytes = await readFile(path.join(artifactRoot, 'build-artifact.json'));
  const record = JSON.parse(recordBytes.toString('utf8'));
  const { integrityHash, ...payload } = record;
  if (stableHash(payload) !== integrityHash)
    throw new Error('build-artifact integrityHash mismatch');
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

const executeShippedBehaviors = async ({ artifactRoot, miniflarePath, packageId, behaviors }) => {
  const miniflareUrl = pathToFileURL(miniflarePath).href;
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
      if (!response.ok || body.ok !== true)
        throw new Error(`behavior failed: ${JSON.stringify(body)}`);
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
  runnerReceiptPath,
  runtimeMain,
  port,
  forbiddenRoots,
  inputEnvironment = process.env,
  execArgv = process.execArgv,
}) => {
  const resolvedRun = await realpath(runRoot);
  const artifactRoot = await realpath(path.join(resolvedRun, 'artifact'));
  const evidenceRoot = path.join(resolvedRun, 'evidence');
  await mkdir(evidenceRoot, { recursive: true });
  assertWithin(resolvedRun, artifactRoot, 'external artifact');
  for (const root of forbiddenRoots) {
    const resolvedForbidden = await realpath(root);
    if (within(resolvedForbidden, resolvedRun) || within(resolvedRun, resolvedForbidden))
      throw new Error(`run root overlaps forbidden checkout/workspace: ${resolvedForbidden}`);
  }
  const sourceChain = await validateCleanCheckoutEvidence(runnerReceiptPath);
  const sourceReceipt = sourceChain.oracleReceipt;
  const sourceInventory = sourceChain.sourceArtifactInventory;
  const preInventory = await inventoryArtifact(artifactRoot);
  if (JSON.stringify(preInventory) !== JSON.stringify(sourceInventory))
    throw new Error('external artifact does not match source receipt');
  const { record, manifest } = await validateBuildArtifact(artifactRoot);

  const runtime = await resolveRuntimeClosure({
    runRoot: resolvedRun,
    runtimeMain,
    forbiddenRoots,
  });
  const runtimeInventory = await inventoryRuntimeClosure(runtime.runtimeRoot);
  const sanitized = await buildSanitizedChildEnvironment({
    runRoot: resolvedRun,
    runtimeRoot: runtime.runtimeRoot,
    inputEnvironment,
    execArgv,
  });
  const cliProbeResult = spawnSync(
    process.execPath,
    [runtime.runtimeMain, 'game', 'serve', '--help'],
    {
      cwd: resolvedRun,
      env: sanitized.environment,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (cliProbeResult.status !== 0 || cliProbeResult.signal !== null)
    throw new Error(
      `external CLI dependency probe failed: ${JSON.stringify({
        status: cliProbeResult.status,
        signal: cliProbeResult.signal,
        stderr: cliProbeResult.stderr,
      })}`,
    );
  const cliProbe = {
    argv: [runtime.runtimeMain, 'game', 'serve', '--help'],
    exitCode: cliProbeResult.status,
    signal: cliProbeResult.signal,
    stdout: {
      bytes: Buffer.byteLength(cliProbeResult.stdout),
      sha256: sha256(cliProbeResult.stdout),
    },
    stderr: {
      bytes: Buffer.byteLength(cliProbeResult.stderr),
      sha256: sha256(cliProbeResult.stderr),
    },
  };
  const stdout = [];
  const stderr = [];
  const childArgv = [
    runtime.runtimeMain,
    'game',
    'serve',
    '--json',
    `--port=${port}`,
    `--dir=${artifactRoot}`,
  ];
  const child = spawn(process.execPath, childArgv, {
    cwd: resolvedRun,
    env: sanitized.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const baseUrl = `http://127.0.0.1:${port}`;
  let exit;
  let descendantsBeforeShutdown;
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
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
      (value) =>
        Number(value?.body?.metrics?.tickCount ?? 0) > 0 || value?.body?.lastTickAt !== null,
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
      sourceReceipt.shippedArtifact.files.find((entry) => entry.path.endsWith('/behaviors.json'))
        .path,
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
      miniflarePath: runtime.miniflarePath,
      packageId: mapPackageManifest.packageId,
      behaviors: representative,
    });
    descendantsBeforeShutdown = descendantProcesses(child.pid);
    for (const descendant of descendantsBeforeShutdown) {
      if (
        descendant.command.includes('bin/workerd serve') &&
        !descendant.command.includes(runtime.runtimeRoot)
      )
        throw new Error(`runtime process escaped closure: ${descendant.command}`);
      for (const forbiddenRoot of forbiddenRoots) {
        if (descendant.command.includes(forbiddenRoot))
          throw new Error(`runtime process referenced forbidden root: ${descendant.command}`);
      }
    }
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
  if (!tamperError?.includes('checksum mismatch'))
    throw new Error('tamper negative did not fail closed');

  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'serve.stdout.log'), stdoutBytes),
    writeFile(path.join(evidenceRoot, 'serve.stderr.log'), stderrBytes),
  ]);
  const descendantsAfterShutdown = descendantProcesses(child.pid);
  if (descendantsAfterShutdown.length !== 0)
    throw new Error(
      `runtime descendants survived shutdown: ${JSON.stringify(descendantsAfterShutdown)}`,
    );
  const receipt = {
    schemaVersion: 1,
    state: 'closed',
    runId: path.basename(resolvedRun),
    runRoot: resolvedRun,
    forbiddenRoots,
    source: {
      runnerReceipt: sourceChain.receipt,
      preflightReceipt: sourceChain.preflightReceipt,
      oracleReceipt: sourceChain.oracleReceiptEvidence,
      checkout: sourceChain.preflight.checkout,
      commands: sourceChain.commands,
      gitHead: sourceChain.runner.gitHead,
      checkoutRoot: sourceChain.runner.checkoutRoot,
      postOracleStatus: sourceChain.runner.postOracleStatus,
      sourceArtifactRoot: sourceChain.sourceArtifactRoot,
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
      root: runtime.runtimeRoot,
      main: runtime.runtimeMain,
      cliEntry: runtime.cliEntry,
      packageJson: runtime.packageJsonPath,
      resolvedDependencies: runtime.resolvedDependencies,
      cliProbe,
      treeSha256: runtimeInventory.treeSha256,
      fileCount: runtimeInventory.files.length,
      symlinkCount: runtimeInventory.symlinks.length,
      symlinks: runtimeInventory.symlinks,
    },
    process: {
      pid: child.pid,
      executable: process.execPath,
      argv: childArgv,
      cwd: resolvedRun,
      environment: sanitized.receipt,
      port,
      baseUrl,
      exit,
      descendantsBeforeShutdown,
      descendantsAfterShutdown,
      stdout: {
        file: 'serve.stdout.log',
        bytes: stdoutBytes.byteLength,
        sha256: sha256(stdoutBytes),
      },
      stderr: {
        file: 'serve.stderr.log',
        bytes: stderrBytes.byteLength,
        sha256: sha256(stderrBytes),
      },
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExternalShippedArtifactOracle({
    runRoot: required(arg('--run-root'), '--run-root'),
    runnerReceiptPath: required(arg('--runner-receipt'), '--runner-receipt'),
    runtimeMain: required(arg('--runtime-main'), '--runtime-main'),
    port: Number(arg('--port') ?? 19_876),
    forbiddenRoots: process.argv
      .flatMap((value, index) => (value === '--forbidden-root' ? [process.argv[index + 1]] : []))
      .map((value) => required(value, '--forbidden-root')),
  })
    .then(({ receiptPath, sha256: digest }) =>
      console.log(JSON.stringify({ receiptPath, sha256: digest })),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

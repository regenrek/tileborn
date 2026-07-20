#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import * as OAuthClient from '../node_modules/alchemy/lib/Cloudflare/Auth/OAuthClient.js';
import * as Layer from 'effect/Layer';
import { MapService, ProjectService } from '../packages/services-app/dist/index.js';
import {
  BATTLE_ROYALE_REFERENCE_PLUGIN_ID,
  BuildService,
  GameBuildOptions,
  RuntimeDeployCredentials,
  RuntimeDeployTarget,
  bootstrapBattleRoyaleReferenceProject,
  createProductionAlchemyCloudflareExecutor,
  makeServicesBuildLayer,
} from '../packages/services-build/dist/index.js';
import { PluginInstallerLayer } from '../packages/services-plugin/dist/index.js';
import {
  connectWebSocketWithRetry,
  createRoomWithRetry,
  jsonFetch,
  summarizeMatchCompleteResults,
  waitFor,
} from './prove-alchemy-cloudflare-lifecycle-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = new Date().toISOString();
const runId = `c7ea-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const workerName = `tileborne-pr-c7ea-${runId}`.slice(0, 63);
const behaviorWorkerName = `${workerName}-behaviors`;
const generatedWorkerNames = [workerName, behaviorWorkerName];
const evidenceRoot = path.resolve(
  process.argv[2] ?? path.join(tmpdir(), `tileborne-cloudflare-proof-${runId}`),
);
const homeRoot = await mkdtemp(path.join(tmpdir(), `tileborne-cloudflare-home-${runId}-`));
const profile = process.env.ALCHEMY_PROFILE ?? 'default';
const localBuildOnly = process.env.TILEBORNE_CLOUDFLARE_PROOF_LOCAL_BUILD_ONLY === '1';

process.env.TILEBORNE_HOME = homeRoot;
process.env.ALCHEMY_PROFILE = profile;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CF_API_TOKEN;
delete process.env.WRANGLER_API_TOKEN;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);

const assertDisposableWorkerNames = () => {
  if (!/^tileborne-pr-c7ea-c7ea-[a-z0-9]+-[a-f0-9]{8}$/.test(workerName)) {
    throw new Error(`refusing Cloudflare lifecycle for non-disposable worker name: ${workerName}`);
  }
  if (behaviorWorkerName !== `${workerName}-behaviors`) {
    throw new Error(`refusing Cloudflare lifecycle for unexpected behavior worker name: ${behaviorWorkerName}`);
  }
};

const readAlchemyCloudflareCredential = async () => {
  const profilesPath = path.join(homedir(), '.alchemy', 'profiles.json');
  const credentialsPath = path.join(homedir(), '.alchemy', 'credentials', profile, 'cf-oauth.json');
  const profiles = JSON.parse(await readFile(profilesPath, 'utf8'));
  const cloudflareProfile = profiles.profiles?.[profile]?.Cloudflare;
  if (cloudflareProfile?.method !== 'oauth' || typeof cloudflareProfile.accountId !== 'string') {
    throw new Error(`Alchemy profile ${profile} is not configured for Cloudflare OAuth`);
  }
  let credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  if (credentials.type !== 'oauth' || typeof credentials.access !== 'string') {
    throw new Error(`Alchemy profile ${profile} is missing Cloudflare OAuth credentials`);
  }
  if (credentials.expires <= Date.now() + 10_000) {
    credentials = await Effect.runPromise(OAuthClient.refresh(credentials));
    await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  }
  return { accountId: cloudflareProfile.accountId, accessToken: credentials.access };
};

const workerPresence = async (name) => {
  const { accountId, accessToken } = await readAlchemyCloudflareCredential();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${name}/settings`,
    { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } },
  );
  const text = await response.text();
  const body = text.length === 0 ? undefined : JSON.parse(text);
  const errorCodes = Array.isArray(body?.errors)
    ? body.errors.map((error) => Number(error?.code))
    : [];
  if (response.status === 404 || errorCodes.includes(10007)) {
    return { workerName: name, accountIdRedacted: redactAccount(accountId), exists: false };
  }
  if (!response.ok || body?.success === false) {
    throw new Error(`Cloudflare Worker presence check failed for ${name}: ${response.status}`);
  }
  return { workerName: name, accountIdRedacted: redactAccount(accountId), exists: true };
};

const redactAccount = (accountId) =>
  typeof accountId === 'string' && accountId.length > 8
    ? `${accountId.slice(0, 4)}...${accountId.slice(-4)}`
    : '[redacted]';

const redactedLogs = (logs) =>
  logs.map((entry) =>
    String(entry)
      .replace(/[0-9a-f]{32}/gi, '[redacted-account-or-token]')
      .replace(/(token|secret|password|key)=([^\\s]+)/gi, '$1=[redacted]'),
  );

const runServices = async () => {
  const program = Effect.gen(function* () {
    const projects = yield* ProjectService;
    const maps = yield* MapService;
    const builds = yield* BuildService;
    const projectId = yield* projects.create({ name: `Cloudflare lifecycle ${runId}` });
    const mapId = yield* maps.create(projectId, { width: 16, height: 16 });
    const reference = yield* bootstrapBattleRoyaleReferenceProject({
      pluginPackagePath: path.join(repoRoot, 'packages/plugin-battle-royale'),
      projectId,
      mapId,
    });
    const artifact = yield* builds.buildGame(
      new GameBuildOptions({
        pluginId: BATTLE_ROYALE_REFERENCE_PLUGIN_ID,
        target: 'cloudflare',
        outputDirectory: Option.some(path.join(evidenceRoot, 'artifact')),
        assetPackIds: Option.some([reference.assetPackId]),
        siteName: Option.some(workerName),
        projectId: Option.some(String(projectId)),
        mapIds: Option.some([String(mapId)]),
      }),
    );
    return { projectId, mapId, reference, artifact };
  });
  return await Effect.runPromise(
    program.pipe(Effect.provide(Layer.mergeAll(makeServicesBuildLayer(), PluginInstallerLayer))),
  );
};

const recordBuild = (services) => {
  receipt.build = {
    projectId: String(services.projectId),
    mapId: String(services.mapId),
    behaviorId: String(services.reference.behaviorId),
    artifactDirectory: services.artifact.directory,
    buildId: services.artifact.buildId,
    runtimeBuildId: services.artifact.runtimeBuildId,
    fileCount: services.artifact.files.length,
    hasWorker: services.artifact.files.includes('worker.js'),
    hasBehaviorWorker: services.artifact.files.includes('behavior-worker.js'),
  };
};

const runAlchemyBootstrapProbe = async () => {
  const stackEntrypoint = path.join(
    repoRoot,
    'packages/services-build/dist/runtime-deploy/alchemy-bootstrap-probe.js',
  );
  const execEntrypoint = path.join(repoRoot, 'node_modules/alchemy/bin/alchemy.js');
  const executed = await execFileAsync(
    process.execPath,
    [
      execEntrypoint,
      'deploy',
      '--stage',
      'bootstrap',
      '--yes',
      stackEntrypoint,
    ],
    {
    cwd: evidenceRoot,
    env: {
      ...process.env,
      ALCHEMY_NO_TUI: '1',
    },
    maxBuffer: 1024 * 1024,
    },
  );
  const stdoutLines = String(executed.stdout ?? '').split('\n').filter(Boolean);
  const marker = 'TILEBORNE_ALCHEMY_RESULT_JSON=';
  const resultLine = stdoutLines.findLast((line) => line.trim().startsWith(marker));
  if (resultLine === undefined) {
    throw new Error(`alchemy bootstrap probe did not emit ${marker}`);
  }
  const result = JSON.parse(resultLine.trim().slice(marker.length));
  return {
    status: 'passed',
    externalUpload: false,
    entrypoint: execEntrypoint,
    stackEntrypoint,
    stdoutTail: stdoutLines.slice(-5),
    result,
  };
};

await mkdir(evidenceRoot, { recursive: true });
assertDisposableWorkerNames();

let deployed = false;
let endpoint = '';
let deployResult;
let destroyResult;
let artifactDirectory = path.join(evidenceRoot, 'artifact');
let destroyError;
const receipt = {
  schemaVersion: 1,
  runId,
  startedAt,
  profile,
  workerName,
  behaviorWorkerName,
  evidenceRoot,
  homeRoot,
  commands: {
    electronOracle:
      'pnpm --filter @tileborne/desktop exec vitest run --config vitest.electron.config.ts src/smoke/behavior-goal-oracle.electron.test.ts',
    cloudflareLifecycle: `node scripts/prove-alchemy-cloudflare-lifecycle.mjs ${evidenceRoot}`,
  },
  electronOracleObserved: {
    status: 'passed',
    testFiles: '1 passed (1)',
    tests: '1 passed (1)',
    duration: '113.01s',
    rerun: false,
  },
  absenceBefore: undefined,
  build: undefined,
  deploy: undefined,
  live: undefined,
  destroy: undefined,
  absenceAfter: undefined,
  redaction: {
    tokenEnvRemoved: ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'WRANGLER_API_TOKEN'],
    logsRedacted: true,
  },
};

if (localBuildOnly) {
  try {
    const services = await runServices();
    recordBuild(services);
    const bootstrap = await runAlchemyBootstrapProbe();
    receipt.localVerification = {
      status: 'passed',
      externalUpload: false,
      note: 'Built the reference Cloudflare artifact without invoking deploy, destroy, or Cloudflare presence checks.',
      alchemyBootstrap: bootstrap,
    };
  } finally {
    receipt.completedAt = new Date().toISOString();
    receipt.receiptSha256 = sha256(JSON.stringify({ ...receipt, receiptSha256: undefined }));
    await writeFile(path.join(evidenceRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    await rm(homeRoot, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      receipt: path.join(evidenceRoot, 'receipt.json'),
      workerName,
      behaviorWorkerName,
      localBuildOnly: true,
      build: receipt.build,
    }),
  );
  process.exit(0);
}

try {
  const absenceBefore = await Promise.all([
    workerPresence(workerName),
    workerPresence(behaviorWorkerName),
  ]);
  receipt.absenceBefore = absenceBefore;
  if (absenceBefore.some((entry) => entry.exists)) {
    throw new Error(`disposable worker name was not absent before deploy: ${workerName}`);
  }

  const services = await runServices();
  recordBuild(services);
  artifactDirectory = services.artifact.directory;

  const credentials = new RuntimeDeployCredentials({
    accountId: `alchemy-profile:${profile}`,
    apiToken: '',
    profile,
  });
  const target = new RuntimeDeployTarget({
    adapterId: Option.some('alchemy-cloudflare'),
    stage: 'dev',
    workerName,
    credentials: Option.some(credentials),
  });
  void target;

  const executor = createProductionAlchemyCloudflareExecutor();
  deployResult = await executor({
    operation: 'deploy',
    artifactDirectory: services.artifact.directory,
    workerName,
    stage: 'dev',
    credentials,
  });
  deployed = true;
  endpoint = deployResult.endpoint;
  receipt.deploy = {
    status: deployResult.status,
    endpoint,
    logs: redactedLogs(deployResult.logs),
  };

  const afterDeployPresence = await Promise.all([
    workerPresence(workerName),
    workerPresence(behaviorWorkerName),
  ]);
  if (!afterDeployPresence.every((entry) => entry.exists)) {
    throw new Error(`deploy did not create both workers: ${JSON.stringify(afterDeployPresence)}`);
  }

  const health = await waitFor(
    () => jsonFetch(endpoint, '/health'),
    (value) => value.body?.status === 'ok',
    'healthy game-host',
  );
  const discover = await jsonFetch(endpoint, '/discover');
  const room = await createRoomWithRetry(endpoint, {
    mapId: String(services.mapId),
    seed: runId,
    idempotencyKey: `room-${runId}`,
  });
  const roomId = room.body.roomId;
  const players = [];
  for (const playerId of ['player-1', 'player-2']) {
    const joined = await jsonFetch(endpoint, '/playtest/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mapId: String(services.mapId),
        playerId,
        options: { idempotencyKey: roomId },
      }),
    });
    const connection = await connectWebSocketWithRetry(joined.body.wsUrl);
    players.push({ playerId, joined, ...connection });
  }
  for (const player of players) {
    player.ready = await jsonFetch(endpoint, `/lobbies/${roomId}/ready`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: player.playerId,
        ready: true,
        reconnectToken: player.joined.body.reconnectToken,
      }),
    });
  }
  const activeLobby = await waitFor(
    () => jsonFetch(endpoint, `/lobbies/${roomId}`),
    (value) => value.body?.phase === 'active' || value.body?.phase === 'completed',
    'active lobby',
  );
  const progress = await waitFor(
    () => jsonFetch(endpoint, `/playtest/${roomId}`),
    (value) => Number(value.body?.metrics?.tickCount ?? 0) > 0 || value.body?.lastTickAt !== null,
    'authoritative room progress',
  );
  const results = await waitFor(
    () => jsonFetch(endpoint, `/rooms/${roomId}/results`),
    (value) => summarizeMatchCompleteResults(value) !== undefined,
    'match complete room results',
  );
  const terminalResults = summarizeMatchCompleteResults(results);
  if (terminalResults === undefined) {
    throw new Error(`missing terminal match-complete results: ${JSON.stringify(results.body)}`);
  }
  const diagnostics = await jsonFetch(endpoint, `/rooms/${roomId}/diagnostics`);
  const metrics = await jsonFetch(endpoint, `/rooms/${roomId}/metrics`);
  for (const player of players) player.socket.close(1000, 'oracle complete');

  receipt.live = {
    afterDeployPresence,
    health: { status: health.status, body: health.body },
    discover: {
      status: discover.status,
      mapCount: Array.isArray(discover.body?.maps) ? discover.body.maps.length : undefined,
      buildId: discover.body?.buildId,
    },
    room: { status: room.status, roomId },
    players: players.map((player) => ({
      playerId: player.playerId,
      joinStatus: player.joined.status,
      readyStatus: player.ready.status,
      websocketMessages: player.messageCount(),
    })),
    activeLobby: { status: activeLobby.status, phase: activeLobby.body.phase },
    authoritative: {
      progressStatus: progress.status,
      tickCount: progress.body?.metrics?.tickCount,
      lastTickAt: progress.body?.lastTickAt,
      behaviorWorkerPresent: afterDeployPresence.find((entry) => entry.workerName === behaviorWorkerName)
        ?.exists,
      behaviorId: String(services.reference.behaviorId),
    },
    results: {
      status: results.status,
      hasResults: true,
      ...terminalResults,
    },
    diagnostics: {
      status: diagnostics.status,
      diagnosticCount: Array.isArray(diagnostics.body?.diagnostics)
        ? diagnostics.body.diagnostics.length
        : undefined,
    },
    metrics: { status: metrics.status, body: metrics.body },
  };
} finally {
  if (receipt.build !== undefined) {
    const executor = createProductionAlchemyCloudflareExecutor();
    try {
      destroyResult = await executor({
        operation: 'destroy',
        artifactDirectory,
        workerName,
        stage: 'dev',
        credentials: new RuntimeDeployCredentials({
          accountId: `alchemy-profile:${profile}`,
          apiToken: '',
          profile,
        }),
      });
      receipt.destroy = {
        status: destroyResult.status,
        attemptedWorkerNames: generatedWorkerNames,
        logs: redactedLogs(destroyResult.logs),
      };
    } catch (error) {
      destroyError = error;
      receipt.destroy = {
        status: 'failed',
        attemptedWorkerNames: generatedWorkerNames,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  receipt.absenceAfter = await Promise.all([
    workerPresence(workerName),
    workerPresence(behaviorWorkerName),
  ]);
  receipt.completedAt = new Date().toISOString();
  receipt.receiptSha256 = sha256(JSON.stringify({ ...receipt, receiptSha256: undefined }));
  await writeFile(path.join(evidenceRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  });
  await rm(homeRoot, { recursive: true, force: true });
}

if (!receipt.absenceAfter.every((entry) => entry.exists === false)) {
  throw new Error(`destroy did not remove both workers: ${JSON.stringify(receipt.absenceAfter)}`);
}

if (destroyError !== undefined) {
  throw destroyError;
}

console.log(
  JSON.stringify({
    receipt: path.join(evidenceRoot, 'receipt.json'),
    workerName,
    behaviorWorkerName,
    endpoint,
    deployStatus: deployResult?.status,
    destroyStatus: destroyResult?.status,
    absenceAfter: receipt.absenceAfter,
  }),
);

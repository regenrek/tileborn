#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as workers from '@distilled.cloud/cloudflare/workers';
import { AlchemyContextLive } from '../node_modules/alchemy/lib/AlchemyContext.js';
import { AuthProviders } from '../node_modules/alchemy/lib/Auth/AuthProvider.js';
import { CredentialsStoreLive } from '../node_modules/alchemy/lib/Auth/Credentials.js';
import { ProfileLive } from '../node_modules/alchemy/lib/Auth/Profile.js';
import { CloudflareAuth } from '../node_modules/alchemy/lib/Cloudflare/Auth/AuthProvider.js';
import * as CloudflareEnvironment from '../node_modules/alchemy/lib/Cloudflare/CloudflareEnvironment.js';
import * as CloudflareCredentials from '../node_modules/alchemy/lib/Cloudflare/Credentials.js';
import { PlatformServices } from '../node_modules/alchemy/lib/Util/PlatformServices.js';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Stream from 'effect/Stream';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import {
  assertMatchingReconnectLocalPlayerIds,
  classifyElectronLifecycleCloseObservations,
  connectWebSocketWithRetry,
  createRoomWithRetry,
  jsonFetch,
  normalizeWebSocketUrl,
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
const preflightOnly = process.env.TILEBORNE_CLOUDFLARE_PROOF_PREFLIGHT_ONLY === '1';

process.env.TILEBORNE_HOME = homeRoot;
process.env.ALCHEMY_PROFILE = profile;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CF_API_TOKEN;
delete process.env.WRANGLER_API_TOKEN;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);
const EXPECTED_ELECTRON_PLAYER_COUNT = 2;
const MAX_CLIENT_RECONNECT_ATTEMPTS = 6;
const MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP = 48;
const MAX_ELECTRON_RECONNECT_TRANSPORT_EVENTS = 2;
const CURRENT_PLAYTEST_START_JOIN_MARKER = 'room idempotency key is required';
const STALE_PLAYTEST_START_MAP_MARKER = 'mapId is required';
const SMOKE_DROP_PARTICIPANT_SOCKET_ROUTE = '/__smoke/rooms/:id/drop-participant-socket';
const SMOKE_TRANSPORT_LOSS_CLOSE_CODE = 4000;
const COMPILED_DEPENDENCY_BUILD_COMMAND = 'pnpm --filter @tileborne/services-build build';

let BATTLE_ROYALE_REFERENCE_PLUGIN_ID;
let BuildService;
let GameBuildOptions;
let MapService;
let PluginInstallerLayer;
let ProjectService;
let RuntimeDeployCredentials;
let RuntimeDeployTarget;
let bootstrapBattleRoyaleReferenceProject;
let createProductionAlchemyCloudflareExecutor;
let makeServicesBuildLayer;

const assertDisposableWorkerNames = () => {
  if (!/^tileborne-pr-c7ea-c7ea-[a-z0-9]+-[a-f0-9]{8}$/.test(workerName)) {
    throw new Error(`refusing Cloudflare lifecycle for non-disposable worker name: ${workerName}`);
  }
  if (behaviorWorkerName !== `${workerName}-behaviors`) {
    throw new Error(
      `refusing Cloudflare lifecycle for unexpected behavior worker name: ${behaviorWorkerName}`,
    );
  }
};

const assertCurrentPlaytestStartContract = async (
  workerPath,
  label,
  options = { requireSmokeControls: false },
) => {
  const source = await readFile(workerPath, 'utf8');
  const playtestStartRoute = /["']\/playtest\/start["'][\s\S]{0,8000}/.exec(source)?.[0];
  if (playtestStartRoute === undefined) {
    throw new Error(`${label} ${workerPath} is missing the /playtest/start route`);
  }
  if (!playtestStartRoute.includes(CURRENT_PLAYTEST_START_JOIN_MARKER)) {
    throw new Error(
      `${label} ${workerPath} was not built from the current /playtest/start join contract`,
    );
  }
  if (playtestStartRoute.includes(STALE_PLAYTEST_START_MAP_MARKER)) {
    throw new Error(
      `${label} ${workerPath} carries stale /playtest/start mapId-required semantics`,
    );
  }
  if (options.requireSmokeControls && !source.includes(SMOKE_DROP_PARTICIPANT_SOCKET_ROUTE)) {
    throw new Error(`${label} ${workerPath} is missing the smoke socket-drop control route`);
  }
  const stats = await stat(workerPath);
  return {
    path: workerPath,
    size: stats.size,
    sha256: sha256(source),
    requiredMarker: CURRENT_PLAYTEST_START_JOIN_MARKER,
    rejectedMarker: STALE_PLAYTEST_START_MAP_MARKER,
    smokeSocketDropRoute: source.includes(SMOKE_DROP_PARTICIPANT_SOCKET_ROUTE),
  };
};

const ensureCompiledLifecycleDependencies = async () => {
  const [command, ...args] = COMPILED_DEPENDENCY_BUILD_COMMAND.split(' ');
  const executed = await execFileAsync(command, args, {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    command: COMPILED_DEPENDENCY_BUILD_COMMAND,
    stdoutSha256: sha256(String(executed.stdout ?? '')),
    stderrSha256: sha256(String(executed.stderr ?? '')),
  };
};

const loadCompiledLifecycleModules = async () => {
  const compiledDependencyBuild = await ensureCompiledLifecycleDependencies();
  const gameHostBuild = await import('../apps/game-host/dist/build/cloudflare.js');
  const compiledGameHostBuildAssetsRoot = path.join(repoRoot, 'apps/game-host/dist/build-assets');
  const buildAssets = gameHostBuild.resolveGameHostBuildAssets(compiledGameHostBuildAssetsRoot);
  const expectedWorkerEntry = path.join(compiledGameHostBuildAssetsRoot, 'worker-entry.js');
  if (buildAssets.workerEntry !== expectedWorkerEntry) {
    throw new Error(
      `lifecycle proof selected unexpected esbuild worker entry: ${buildAssets.workerEntry}`,
    );
  }
  const workerEntryContract = await assertCurrentPlaytestStartContract(
    buildAssets.workerEntry,
    'compiled game-host build-assets worker entry',
  );
  const servicesApp = await import('../packages/services-app/dist/index.js');
  const servicesBuild = await import('../packages/services-build/dist/index.js');
  const servicesPlugin = await import('../packages/services-plugin/dist/index.js');
  MapService = servicesApp.MapService;
  ProjectService = servicesApp.ProjectService;
  BATTLE_ROYALE_REFERENCE_PLUGIN_ID = servicesBuild.BATTLE_ROYALE_REFERENCE_PLUGIN_ID;
  BuildService = servicesBuild.BuildService;
  GameBuildOptions = servicesBuild.GameBuildOptions;
  RuntimeDeployCredentials = servicesBuild.RuntimeDeployCredentials;
  RuntimeDeployTarget = servicesBuild.RuntimeDeployTarget;
  bootstrapBattleRoyaleReferenceProject = servicesBuild.bootstrapBattleRoyaleReferenceProject;
  createProductionAlchemyCloudflareExecutor =
    servicesBuild.createProductionAlchemyCloudflareExecutor;
  makeServicesBuildLayer = servicesBuild.makeServicesBuildLayer;
  PluginInstallerLayer = servicesPlugin.PluginInstallerLayer;
  return {
    compiledDependencyBuild,
    gameHostBuildAssets: {
      root: buildAssets.root,
      workerEntry: buildAssets.workerEntry,
      behaviorWorkerEntry: buildAssets.behaviorWorkerEntry,
      wranglerTemplatePath: buildAssets.wranglerTemplatePath,
      workerEntryContract,
    },
  };
};

const alchemyPlatformLayer = Layer.mergeAll(
  PlatformServices,
  FetchHttpClient.layer,
  ConfigProvider.layer(ConfigProvider.fromEnv()),
  Layer.provide(ProfileLive, PlatformServices),
  Layer.provide(CredentialsStoreLive, PlatformServices),
  Layer.provideMerge(AlchemyContextLive, PlatformServices),
);
const authRegistry = Layer.succeed(AuthProviders, {});
const cloudflareAuthLayer = CloudflareAuth.pipe(
  Layer.provideMerge(authRegistry),
  Layer.provideMerge(alchemyPlatformLayer),
);
const cloudflareReadLayer = Layer.mergeAll(
  CloudflareCredentials.fromAuthProvider(),
  CloudflareEnvironment.fromProfile(),
).pipe(Layer.provideMerge(cloudflareAuthLayer), Layer.provideMerge(alchemyPlatformLayer));

const readWorkerPresence = (accountId, name) =>
  workers.getScriptScriptAndVersionSetting({ accountId, scriptName: name }).pipe(
    Effect.as(true),
    Effect.catchTag('WorkerNotFound', () => Effect.succeed(false)),
    Effect.catchTag('WorkerHasNoVersions', () => Effect.succeed(false)),
  );

const readCloudflareSnapshot = (names) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const resolveEnvironment = yield* CloudflareEnvironment.CloudflareEnvironment;
      const environment = yield* resolveEnvironment;
      const accountId = environment.accountId ?? environment.account;
      if (typeof accountId !== 'string' || accountId.length === 0) {
        return yield* Effect.die(new Error('Alchemy Cloudflare profile has no account id'));
      }
      const presence = [];
      for (const name of names) {
        presence.push({
          workerName: name,
          accountIdRedacted: redactAccount(accountId),
          exists: yield* readWorkerPresence(accountId, name),
        });
      }
      const scripts = yield* workers.listScripts.items({ accountId }).pipe(Stream.runCollect);
      const scriptNames = Array.from(scripts, (script) => script.id ?? '')
        .filter(Boolean)
        .sort();
      return {
        presence,
        account: redactAccount(accountId),
        workerCount: scriptNames.length,
        workerNamesSha256: sha256(JSON.stringify(scriptNames)),
      };
    }).pipe(Effect.provide(cloudflareReadLayer), Effect.provide(alchemyPlatformLayer)),
  );

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

const assertElectronRoomDiagnostics = (diagnostics, expectedOwnerPlayerId) => {
  const body = diagnostics.body?.diagnostics;
  if (diagnostics.status !== 200 || typeof body !== 'object' || body === null) {
    throw new Error(`electron room diagnostics missing: ${JSON.stringify(diagnostics.body)}`);
  }
  if (body.playerCount !== EXPECTED_ELECTRON_PLAYER_COUNT) {
    throw new Error(`electron room player count drifted: ${JSON.stringify(body)}`);
  }
  if (body.readyPlayerCount !== EXPECTED_ELECTRON_PLAYER_COUNT) {
    throw new Error(`electron room ready count drifted: ${JSON.stringify(body)}`);
  }
  if (typeof body.ownerPlayerId !== 'string' || body.ownerPlayerId.length === 0) {
    throw new Error(`electron room owner missing: ${JSON.stringify(body)}`);
  }
  if (expectedOwnerPlayerId !== undefined && body.ownerPlayerId !== expectedOwnerPlayerId) {
    throw new Error(
      `electron room owner drifted from creator ${expectedOwnerPlayerId}: ${JSON.stringify(body)}`,
    );
  }
  if (
    !Number.isInteger(body.connectedPlayerCount) ||
    body.connectedPlayerCount < 0 ||
    body.connectedPlayerCount > EXPECTED_ELECTRON_PLAYER_COUNT
  ) {
    throw new Error(`electron room connected count out of bounds: ${JSON.stringify(body)}`);
  }
  if (
    !Number.isInteger(body.reconnectEligiblePlayerCount) ||
    body.reconnectEligiblePlayerCount < 0 ||
    body.reconnectEligiblePlayerCount > EXPECTED_ELECTRON_PLAYER_COUNT
  ) {
    throw new Error(
      `electron room reconnect-eligible count out of bounds: ${JSON.stringify(body)}`,
    );
  }
  if (!Array.isArray(body.issues) || body.issues.length !== 0) {
    throw new Error(`electron room diagnostics reported issues: ${JSON.stringify(body)}`);
  }
  return body;
};

const assertElectronRoomMetrics = (metrics) => {
  const body = metrics.body?.metrics;
  const transport = body?.transport;
  if (metrics.status !== 200 || typeof body !== 'object' || body === null) {
    throw new Error(`electron room metrics missing: ${JSON.stringify(metrics.body)}`);
  }
  if (body.playerCount !== EXPECTED_ELECTRON_PLAYER_COUNT) {
    throw new Error(`electron room metrics player count drifted: ${JSON.stringify(body)}`);
  }
  if (
    !Number.isInteger(body.connectedClients) ||
    body.connectedClients < 0 ||
    body.connectedClients > EXPECTED_ELECTRON_PLAYER_COUNT
  ) {
    throw new Error(`electron room connected clients out of bounds: ${JSON.stringify(body)}`);
  }
  if (typeof transport !== 'object' || transport === null) {
    throw new Error(`electron room transport metrics missing: ${JSON.stringify(body)}`);
  }
  if (
    !Number.isInteger(transport.trackedClients) ||
    transport.trackedClients < 0 ||
    transport.trackedClients > EXPECTED_ELECTRON_PLAYER_COUNT
  ) {
    throw new Error(`electron room tracked clients out of bounds: ${JSON.stringify(transport)}`);
  }
  if (
    !Number.isInteger(transport.maxPendingSnapshotLagTicks) ||
    transport.maxPendingSnapshotLagTicks >= MAX_UNACKED_SNAPSHOT_TICKS_BEFORE_DROP
  ) {
    throw new Error(`electron room snapshot lag exceeded drop bound: ${JSON.stringify(transport)}`);
  }
  for (const key of ['totalDroppedOutboundFrames', 'totalResyncs', 'totalStaleSnapshotAcks']) {
    if (
      !Number.isInteger(transport[key]) ||
      transport[key] < 0 ||
      transport[key] > MAX_ELECTRON_RECONNECT_TRANSPORT_EVENTS
    ) {
      throw new Error(`electron room ${key} out of bounds: ${JSON.stringify(transport)}`);
    }
  }
  return body;
};

const explicitElectronSession = (baseUrl, roomId, joined) => ({
  baseUrl: baseUrl.replace(/\/$/, ''),
  roomId,
  wsUrl: normalizeWebSocketUrl(joined.wsUrl),
  playerId: joined.playerId,
  handoffToken: joined.handoffToken,
  reconnectToken: joined.reconnectToken,
});

const assertLobbySessionCredentials = (label, value, roomId) => {
  for (const key of ['wsUrl', 'playerId', 'handoffToken', 'reconnectToken']) {
    if (typeof value?.[key] !== 'string' || value[key].length === 0) {
      throw new Error(`${label} lobby session missing ${key}: ${JSON.stringify(value)}`);
    }
  }
  if (value.roomId !== roomId) {
    throw new Error(`${label} lobby session room mismatch: ${JSON.stringify(value)}`);
  }
};

const createElectronProofLobby = async (endpoint, services) => {
  const created = await waitFor(
    () =>
      jsonFetch(endpoint, '/lobbies/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: String(services.mapId),
          seed: `${runId}-electron`,
          reserveCreator: true,
          options: {
            idempotencyKey: `electron-${runId}`,
            minReadyPlayers: EXPECTED_ELECTRON_PLAYER_COUNT,
          },
        }),
      }),
    (value) =>
      value.status === 201 &&
      typeof value.body?.roomId === 'string' &&
      typeof value.body?.joinCode === 'string',
    'created electron proof lobby',
  );
  const roomId = created.body.roomId;
  assertLobbySessionCredentials('creator', created.body, roomId);

  const joined = await jsonFetch(endpoint, '/lobbies/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinCode: created.body.joinCode }),
  });
  if (joined.status !== 201) {
    throw new Error(`electron participant join failed: ${JSON.stringify(joined.body)}`);
  }
  assertLobbySessionCredentials('participant', joined.body, roomId);
  if (joined.body.playerId === created.body.playerId) {
    throw new Error(`electron participant reused creator identity: ${JSON.stringify(joined.body)}`);
  }

  return {
    roomId,
    joinCode: created.body.joinCode,
    creator: explicitElectronSession(endpoint, roomId, created.body),
    participant: explicitElectronSession(endpoint, roomId, joined.body),
  };
};

const readJsonFile = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

const observationCode = (observation) =>
  typeof observation === 'object' && observation !== null && Number.isInteger(observation.code)
    ? observation.code
    : undefined;

const observationAttempt = (observation) =>
  typeof observation === 'object' && observation !== null && Number.isInteger(observation.attempt)
    ? observation.attempt
    : undefined;

const observationReconnectable = (observation) =>
  typeof observation === 'object' &&
  observation !== null &&
  typeof observation.reconnectable === 'boolean'
    ? observation.reconnectable
    : undefined;

const hasCleanNonReconnectableMatchEndedClose = (observations) =>
  observations.some(
    (observation) =>
      observation?._tag === 'close' &&
      observationCode(observation) === 4006 &&
      observation.wasClean === true &&
      observationReconnectable(observation) === false,
  );

const requireTransportObservationArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} transport observations missing: ${JSON.stringify(value)}`);
  }
  return value;
};

const assertReadyTransitionEvidence = (evidence, expectedOwnerPlayerId) => {
  const oneReady = evidence.readyTransitions?.oneReady;
  const twoReady = evidence.readyTransitions?.twoReady;
  const readyTransitions = [
    { label: 'one ready', evidence: oneReady, expectedReadyPlayers: 1 },
    {
      label: 'two ready',
      evidence: twoReady,
      expectedReadyPlayers: EXPECTED_ELECTRON_PLAYER_COUNT,
    },
  ];
  for (const transition of readyTransitions) {
    const server = transition.evidence?.server;
    const clients = transition.evidence?.clients;
    if (
      server?.status !== 200 ||
      server.playerCount !== EXPECTED_ELECTRON_PLAYER_COUNT ||
      server.connectedPlayerCount !== EXPECTED_ELECTRON_PLAYER_COUNT ||
      server.readyPlayerCount !== transition.expectedReadyPlayers ||
      server.ownerPlayerId !== expectedOwnerPlayerId ||
      !Array.isArray(server.issues) ||
      server.issues.length !== 0 ||
      !Array.isArray(clients) ||
      clients.length !== EXPECTED_ELECTRON_PLAYER_COUNT
    ) {
      throw new Error(
        `electron ${transition.label} readiness did not converge: ${JSON.stringify(transition.evidence)}`,
      );
    }
  }
  const firstOneReady = oneReady.clients.find((client) => client.label === 'client-a');
  const secondOneReady = oneReady.clients.find((client) => client.label === 'client-b');
  if (firstOneReady?.localReady !== false || secondOneReady?.localReady !== true) {
    throw new Error(`electron one-ready local state drifted: ${JSON.stringify(oneReady)}`);
  }
  if (!twoReady.clients.every((client) => client.localReady === true)) {
    throw new Error(`electron two-ready local state drifted: ${JSON.stringify(twoReady)}`);
  }
  return {
    oneReady: {
      serverReadyPlayerCount: oneReady.server.readyPlayerCount,
      ownerPlayerId: oneReady.server.ownerPlayerId,
      clients: oneReady.clients,
    },
    twoReady: {
      serverReadyPlayerCount: twoReady.server.readyPlayerCount,
      ownerPlayerId: twoReady.server.ownerPlayerId,
      clients: twoReady.clients,
    },
  };
};

const assertElectronLifecycleEvidence = (evidence, roomId, expectedOwnerPlayerId) => {
  if (typeof evidence !== 'object' || evidence === null) {
    throw new Error('electron lifecycle evidence missing');
  }
  if (evidence.roomId !== roomId) {
    throw new Error(`electron lifecycle evidence room mismatch: ${JSON.stringify(evidence)}`);
  }
  const reconnect = evidence.reconnect;
  if (typeof reconnect !== 'object' || reconnect === null) {
    throw new Error(`electron reconnect evidence missing: ${JSON.stringify(evidence)}`);
  }
  const beforeDisconnect = reconnect.beforeDisconnect;
  const afterReconnect = reconnect.afterReconnect;
  if (
    typeof beforeDisconnect !== 'object' ||
    beforeDisconnect === null ||
    typeof afterReconnect !== 'object' ||
    afterReconnect === null
  ) {
    throw new Error(`electron reconnect session evidence missing: ${JSON.stringify(reconnect)}`);
  }
  const reconnectLocalPlayerId = assertMatchingReconnectLocalPlayerIds(reconnect);
  if (afterReconnect.reconnectAttempts !== 1) {
    throw new Error(
      `electron reconnect attempts not exactly one: ${JSON.stringify(afterReconnect)}`,
    );
  }
  const reconnectDiagnosticsBody = assertElectronRoomDiagnostics(
    reconnect.diagnostics,
    expectedOwnerPlayerId,
  );
  if (reconnectDiagnosticsBody.connectedPlayerCount !== EXPECTED_ELECTRON_PLAYER_COUNT) {
    throw new Error(
      `electron reconnect snapshot did not have both players connected: ${JSON.stringify(reconnectDiagnosticsBody)}`,
    );
  }
  const reconnectMetricsBody = assertElectronRoomMetrics(reconnect.metrics);
  if (
    reconnectMetricsBody.connectedClients !== EXPECTED_ELECTRON_PLAYER_COUNT ||
    reconnectMetricsBody.transport.trackedClients !== EXPECTED_ELECTRON_PLAYER_COUNT
  ) {
    throw new Error(
      `electron reconnect metrics did not prove exactly two live sessions: ${JSON.stringify(reconnectMetricsBody)}`,
    );
  }
  const terminal = evidence.terminal;
  const firstPlayerId = terminal?.first?.session?.localPlayerId;
  const secondPlayerId = terminal?.second?.session?.localPlayerId;
  const resultPlayerIds = terminal?.first?.roomResults?.players?.map((player) => player.playerId);
  if (
    typeof firstPlayerId !== 'string' ||
    typeof secondPlayerId !== 'string' ||
    firstPlayerId === secondPlayerId ||
    !Array.isArray(resultPlayerIds) ||
    new Set(resultPlayerIds).size !== EXPECTED_ELECTRON_PLAYER_COUNT
  ) {
    throw new Error(`electron terminal identities were not distinct: ${JSON.stringify(terminal)}`);
  }
  const readyTransitions = assertReadyTransitionEvidence(evidence, expectedOwnerPlayerId);
  const reconnectObservations = requireTransportObservationArray(
    afterReconnect.transportObservations,
    'electron afterReconnect',
  );
  const forcedDropCloses = reconnectObservations.filter(
    (observation) =>
      observation?._tag === 'close' &&
      observationCode(observation) === SMOKE_TRANSPORT_LOSS_CLOSE_CODE,
  );
  if (forcedDropCloses.length !== 1 || observationReconnectable(forcedDropCloses[0]) !== true) {
    throw new Error(
      `electron forced disconnect did not observe exactly one reconnectable close code ${SMOKE_TRANSPORT_LOSS_CLOSE_CODE}: ${JSON.stringify(reconnectObservations)}`,
    );
  }
  const reconnectAttempts = reconnectObservations.filter(
    (observation) => observation?._tag === 'reconnectAttempt',
  );
  if (reconnectAttempts.length !== 1 || observationAttempt(reconnectAttempts[0]) !== 1) {
    throw new Error(
      `electron reconnect attempt observations were not exactly attempt 1: ${JSON.stringify(reconnectObservations)}`,
    );
  }
  const reconnectOpened = reconnectObservations.filter(
    (observation) => observation?._tag === 'reconnectOpened',
  );
  if (reconnectOpened.length !== 1 || observationAttempt(reconnectOpened[0]) !== 1) {
    throw new Error(
      `electron reconnect opened observations were not exactly attempt 1: ${JSON.stringify(reconnectObservations)}`,
    );
  }
  const firstTerminalCloseObservations = requireTransportObservationArray(
    terminal?.closeObservations?.first,
    'electron first terminal close',
  );
  const secondTerminalCloseObservations = requireTransportObservationArray(
    terminal?.closeObservations?.second,
    'electron second terminal close',
  );
  const lifecycleCloseClassification = classifyElectronLifecycleCloseObservations({
    afterReconnect: reconnectObservations,
    terminalFirst: firstTerminalCloseObservations,
    terminalSecond: secondTerminalCloseObservations,
    forcedNetworkDropCloseCode: SMOKE_TRANSPORT_LOSS_CLOSE_CODE,
  });
  if (!hasCleanNonReconnectableMatchEndedClose(firstTerminalCloseObservations)) {
    throw new Error(
      `electron first terminal match-ended close missing or abnormal: ${JSON.stringify(firstTerminalCloseObservations)}`,
    );
  }
  if (!hasCleanNonReconnectableMatchEndedClose(secondTerminalCloseObservations)) {
    throw new Error(
      `electron second terminal match-ended close missing or abnormal: ${JSON.stringify(secondTerminalCloseObservations)}`,
    );
  }
  return {
    readyTransitions,
    reconnectDiagnostics: reconnectDiagnosticsBody,
    reconnectMetrics: reconnectMetricsBody,
    reconnect: {
      observedReconnectAttempts: afterReconnect.reconnectAttempts,
      localPlayerId: reconnectLocalPlayerId,
    },
    observations: {
      afterReconnect: reconnectObservations,
      terminal: {
        first: firstTerminalCloseObservations,
        second: secondTerminalCloseObservations,
      },
    },
    expectedCloseCodes: lifecycleCloseClassification.expectedCloseCodes,
    abnormalExpectedCloseCodeObserved:
      lifecycleCloseClassification.abnormalExpectedCloseCodeObserved,
    forcedNetworkDropCloseCodeObserved:
      lifecycleCloseClassification.forcedNetworkDropCloseCodeObserved,
  };
};

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
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          makeServicesBuildLayer(undefined, {
            gameHostBuildAssetsRoot: lifecycleCompiledModules.gameHostBuildAssets.root,
            gameHostSmokeControlsEnabled: true,
          }),
          PluginInstallerLayer,
        ),
      ),
    ),
  );
};

const recordBuild = async (services) => {
  const deploymentWorkerPath = path.join(services.artifact.directory, 'worker.js');
  const artifactWorkerContract = await assertCurrentPlaytestStartContract(
    deploymentWorkerPath,
    'final Cloudflare artifact worker',
    { requireSmokeControls: true },
  );
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
    lifecycleCompiledDependencyBuild: lifecycleCompiledModules.compiledDependencyBuild,
    esbuildEntry: lifecycleCompiledModules.gameHostBuildAssets.workerEntry,
    behaviorEsbuildEntry: lifecycleCompiledModules.gameHostBuildAssets.behaviorWorkerEntry,
    buildAssetsRoot: lifecycleCompiledModules.gameHostBuildAssets.root,
    workerEntryContract: lifecycleCompiledModules.gameHostBuildAssets.workerEntryContract,
    deploymentWorkerPath,
    artifactWorkerContract,
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
    [execEntrypoint, 'deploy', '--stage', 'bootstrap', '--yes', stackEntrypoint],
    {
      cwd: evidenceRoot,
      env: {
        ...process.env,
        ALCHEMY_NO_TUI: '1',
      },
      maxBuffer: 1024 * 1024,
    },
  );
  const stdoutLines = String(executed.stdout ?? '')
    .split('\n')
    .filter(Boolean);
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
const lifecycleCompiledModules = await loadCompiledLifecycleModules();

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
    lifecycleCompiledDependencyBuild: COMPILED_DEPENDENCY_BUILD_COMMAND,
    electronOracle:
      'vitest run --config vitest.electron.config.ts src/smoke/cloudflare-multiplayer-lifecycle.electron.test.ts',
    cloudflareLifecycle: `node scripts/prove-alchemy-cloudflare-lifecycle.mjs ${evidenceRoot}`,
  },
  electronOracleObserved: undefined,
  absenceBefore: undefined,
  unrelatedWorkersBefore: undefined,
  build: undefined,
  deploy: undefined,
  live: undefined,
  destroy: undefined,
  absenceAfter: undefined,
  unrelatedWorkersAfter: undefined,
  redaction: {
    tokenEnvRemoved: ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'WRANGLER_API_TOKEN'],
    logsRedacted: true,
  },
};

if (localBuildOnly) {
  try {
    const services = await runServices();
    await recordBuild(services);
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
    await writeFile(
      path.join(evidenceRoot, 'receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
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

if (preflightOnly) {
  try {
    const preflight = await readCloudflareSnapshot(generatedWorkerNames);
    receipt.absenceBefore = preflight.presence;
    receipt.unrelatedWorkersBefore = {
      account: preflight.account,
      workerCount: preflight.workerCount,
      workerNamesSha256: preflight.workerNamesSha256,
    };
    if (preflight.presence.some((entry) => entry.exists)) {
      throw new Error(`disposable worker name was not absent before deploy: ${workerName}`);
    }
  } finally {
    receipt.completedAt = new Date().toISOString();
    receipt.receiptSha256 = sha256(JSON.stringify({ ...receipt, receiptSha256: undefined }));
    await writeFile(
      path.join(evidenceRoot, 'receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rm(homeRoot, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      receipt: path.join(evidenceRoot, 'receipt.json'),
      workerName,
      behaviorWorkerName,
      preflightOnly: true,
      absenceBefore: receipt.absenceBefore,
      unrelatedWorkersBefore: receipt.unrelatedWorkersBefore,
    }),
  );
  process.exit(0);
}

try {
  const before = await readCloudflareSnapshot(generatedWorkerNames);
  receipt.absenceBefore = before.presence;
  receipt.unrelatedWorkersBefore = {
    account: before.account,
    workerCount: before.workerCount,
    workerNamesSha256: before.workerNamesSha256,
  };
  if (before.presence.some((entry) => entry.exists)) {
    throw new Error(`disposable worker name was not absent before deploy: ${workerName}`);
  }

  const services = await runServices();
  await recordBuild(services);
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
  const deployWorkerContract = await assertCurrentPlaytestStartContract(
    path.join(services.artifact.directory, 'worker.js'),
    'Alchemy deployment workerPath',
    { requireSmokeControls: true },
  );
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
    workerPath: deployWorkerContract.path,
    workerContract: deployWorkerContract,
    logs: redactedLogs(deployResult.logs),
  };

  const afterDeployPresence = (await readCloudflareSnapshot(generatedWorkerNames)).presence;
  if (!afterDeployPresence.every((entry) => entry.exists)) {
    throw new Error(`deploy did not create both workers: ${JSON.stringify(afterDeployPresence)}`);
  }

  const electronLobby = await createElectronProofLobby(endpoint, services);
  const electronLobbyReady = await waitFor(
    () => jsonFetch(endpoint, `/lobbies/${electronLobby.roomId}`),
    (value) =>
      value.status === 200 &&
      value.body?.roomId === electronLobby.roomId &&
      value.body?.phase === 'lobby' &&
      value.body?.playerCount === EXPECTED_ELECTRON_PLAYER_COUNT,
    'electron room visible before Electron joins',
  );
  const electronEvidencePath = path.join(evidenceRoot, 'electron-lifecycle-observed.json');
  const electronOracle = await execFileAsync(
    path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
    [
      'run',
      '--config',
      'vitest.electron.config.ts',
      'src/smoke/cloudflare-multiplayer-lifecycle.electron.test.ts',
      '--reporter=verbose',
    ],
    {
      cwd: path.join(repoRoot, 'apps', 'desktop'),
      env: {
        ...process.env,
        TILEBORNE_CLOUDFLARE_ROOM_URL: `${endpoint.replace(/\/$/, '')}/rooms/${electronLobby.roomId}`,
        TILEBORNE_CLOUDFLARE_FIRST_SESSION: JSON.stringify(electronLobby.creator),
        TILEBORNE_CLOUDFLARE_SECOND_SESSION: JSON.stringify(electronLobby.participant),
        TILEBORNE_CLOUDFLARE_RUN_ID: runId,
        TILEBORNE_CLOUDFLARE_ELECTRON_EVIDENCE: electronEvidencePath,
      },
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  const electronOutput = String(electronOracle.stdout ?? '');
  const electronLifecycleEvidence = assertElectronLifecycleEvidence(
    await readJsonFile(electronEvidencePath),
    electronLobby.roomId,
    electronLobby.creator.playerId,
  );
  const electronResults = await waitFor(
    () => jsonFetch(endpoint, `/rooms/${electronLobby.roomId}/results`),
    (value) => summarizeMatchCompleteResults(value) !== undefined,
    'electron room terminal results',
  );
  const electronTerminalResults = summarizeMatchCompleteResults(electronResults);
  if (electronTerminalResults === undefined) {
    throw new Error(`missing electron terminal results: ${JSON.stringify(electronResults.body)}`);
  }
  const electronDiagnostics = await jsonFetch(
    endpoint,
    `/rooms/${electronLobby.roomId}/diagnostics`,
  );
  const electronDiagnosticBody = assertElectronRoomDiagnostics(
    electronDiagnostics,
    electronLobby.creator.playerId,
  );
  const electronMetrics = await jsonFetch(endpoint, `/rooms/${electronLobby.roomId}/metrics`);
  const electronMetricBody = assertElectronRoomMetrics(electronMetrics);
  receipt.electronOracleObserved = {
    status: 'passed',
    roomId: electronLobby.roomId,
    ownerPlayerId: electronLobby.creator.playerId,
    participantPlayerId: electronLobby.participant.playerId,
    preJoinLobby: {
      status: electronLobbyReady.status,
      phase: electronLobbyReady.body?.phase,
      playerCount: electronLobbyReady.body?.playerCount,
      readyPlayers: Array.isArray(electronLobbyReady.body?.players)
        ? electronLobbyReady.body.players.filter((player) => player?.ready === true).length
        : undefined,
    },
    testFiles: /Test Files\s+1 passed \(1\)/.test(electronOutput),
    tests: /Tests\s+1 passed \(1\)/.test(electronOutput),
    outputSha256: sha256(electronOutput),
    reconnectAttemptBound: {
      clientCap: MAX_CLIENT_RECONNECT_ATTEMPTS,
      forcedDisconnects: 1,
      observedReconnectAttempts: electronLifecycleEvidence.reconnect.observedReconnectAttempts,
    },
    readyTransitions: electronLifecycleEvidence.readyTransitions,
    results: {
      status: electronResults.status,
      hasResults: true,
      ...electronTerminalResults,
    },
    diagnostics: {
      status: electronDiagnostics.status,
      phase: electronDiagnosticBody.phase,
      playerCount: electronDiagnosticBody.playerCount,
      readyPlayerCount: electronDiagnosticBody.readyPlayerCount,
      connectedPlayerCount: electronDiagnosticBody.connectedPlayerCount,
      reconnectEligiblePlayerCount: electronDiagnosticBody.reconnectEligiblePlayerCount,
      ownerPlayerId: electronDiagnosticBody.ownerPlayerId,
      issues: electronDiagnosticBody.issues,
    },
    reconnectDiagnostics: {
      status: electronLifecycleEvidence.reconnectDiagnostics.status,
      phase: electronLifecycleEvidence.reconnectDiagnostics.phase,
      playerCount: electronLifecycleEvidence.reconnectDiagnostics.playerCount,
      readyPlayerCount: electronLifecycleEvidence.reconnectDiagnostics.readyPlayerCount,
      connectedPlayerCount: electronLifecycleEvidence.reconnectDiagnostics.connectedPlayerCount,
      reconnectEligiblePlayerCount:
        electronLifecycleEvidence.reconnectDiagnostics.reconnectEligiblePlayerCount,
      ownerPlayerId: electronLifecycleEvidence.reconnectDiagnostics.ownerPlayerId,
      issues: electronLifecycleEvidence.reconnectDiagnostics.issues,
    },
    metrics: {
      status: electronMetrics.status,
      lifecyclePhase: electronMetricBody.lifecyclePhase,
      tick: electronMetricBody.tick,
      playerCount: electronMetricBody.playerCount,
      connectedClients: electronMetricBody.connectedClients,
      transport: electronMetricBody.transport,
    },
    reconnectMetrics: {
      lifecyclePhase: electronLifecycleEvidence.reconnectMetrics.lifecyclePhase,
      tick: electronLifecycleEvidence.reconnectMetrics.tick,
      playerCount: electronLifecycleEvidence.reconnectMetrics.playerCount,
      connectedClients: electronLifecycleEvidence.reconnectMetrics.connectedClients,
      transport: electronLifecycleEvidence.reconnectMetrics.transport,
    },
    expectedCloseClassification: {
      allowed: ['normal reconnect predecessor close', 'match ended without abnormal close'],
      observations: electronLifecycleEvidence.observations,
      expectedCloseCodes: electronLifecycleEvidence.expectedCloseCodes,
      forcedNetworkDropCloseCodeObserved:
        electronLifecycleEvidence.forcedNetworkDropCloseCodeObserved,
      abnormalCloseCodeObserved: electronLifecycleEvidence.abnormalExpectedCloseCodeObserved,
    },
  };

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
      behaviorWorkerPresent: afterDeployPresence.find(
        (entry) => entry.workerName === behaviorWorkerName,
      )?.exists,
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
  const after = await readCloudflareSnapshot(generatedWorkerNames);
  receipt.absenceAfter = after.presence;
  receipt.unrelatedWorkersAfter = {
    account: after.account,
    workerCount: after.workerCount,
    workerNamesSha256: after.workerNamesSha256,
  };
  receipt.completedAt = new Date().toISOString();
  receipt.receiptSha256 = sha256(JSON.stringify({ ...receipt, receiptSha256: undefined }));
  await writeFile(
    path.join(evidenceRoot, 'receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  await rm(homeRoot, { recursive: true, force: true });
}

if (!receipt.absenceAfter.every((entry) => entry.exists === false)) {
  throw new Error(`destroy did not remove both workers: ${JSON.stringify(receipt.absenceAfter)}`);
}

if (
  receipt.unrelatedWorkersBefore.workerCount !== receipt.unrelatedWorkersAfter.workerCount ||
  receipt.unrelatedWorkersBefore.workerNamesSha256 !==
    receipt.unrelatedWorkersAfter.workerNamesSha256
) {
  throw new Error('unrelated Cloudflare Worker inventory changed during the disposable proof');
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

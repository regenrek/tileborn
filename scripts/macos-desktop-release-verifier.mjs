/* global process, setTimeout, window */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';

const fail = (code, message) => {
  throw new Error(`${code}: ${message}`);
};

const parseArgs = (args) => {
  const allowed = new Set([
    'candidate',
    'update-artifact',
    'nonce',
    'failure-matrix',
    'candidate-only',
    'oracle-unstapled-fixtures',
  ]);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !allowed.has(key.slice(2)) || value === undefined) {
      fail('native.invalid-argument', key ?? '<missing>');
    }
    values[key.slice(2)] = value;
  }
  for (const key of allowed) {
    if (key !== 'failure-matrix' && key !== 'oracle-unstapled-fixtures' && !values[key]) {
      fail('native.missing-argument', key);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(values.nonce)) fail('native.invalid-nonce', 'nonce');
  if (
    values['failure-matrix'] !== undefined &&
    values['failure-matrix'] !== '1' &&
    values['failure-matrix'] !== 'true'
  ) {
    fail('native.invalid-failure-matrix', values['failure-matrix']);
  }
  if (
    values['candidate-only'] !== undefined &&
    values['candidate-only'] !== '1' &&
    values['candidate-only'] !== 'true'
  ) {
    fail('native.invalid-candidate-only', values['candidate-only']);
  }
  if (
    values['oracle-unstapled-fixtures'] !== undefined &&
    values['oracle-unstapled-fixtures'] !== '1' &&
    values['oracle-unstapled-fixtures'] !== 'true'
  ) {
    fail('native.invalid-oracle-unstapled-fixtures', values['oracle-unstapled-fixtures']);
  }
  return values;
};

const run = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const processTable = () =>
  run('/bin/ps', ['-axo', 'pid=,command='])
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      return match === null ? undefined : { pid: Number(match[1]), command: match[2] };
    })
    .filter((entry) => entry !== undefined);

const scopedReleaseProcesses = (isolatedRoot) =>
  processTable().filter(
    ({ pid, command }) => pid !== process.pid && command.includes(isolatedRoot),
  );

const waitForNoScopedReleaseProcesses = async ({ isolatedRoot, timeoutMs, phase }) => {
  const deadline = Date.now() + timeoutMs;
  let running = scopedReleaseProcesses(isolatedRoot);
  while (running.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    running = scopedReleaseProcesses(isolatedRoot);
  }
  if (running.length > 0) {
    fail('native.scoped-processes-still-running', `${phase}: ${JSON.stringify(running)}`);
  }
};

const removeAndVerifyScopedReleaseRoot = async ({ isolatedRoot, timeoutMs = 30_000 }) => {
  const deadline = Date.now() + timeoutMs;
  const stableForMs = 2_000;
  let absentSince;
  let lastProcesses = [];
  while (Date.now() < deadline) {
    lastProcesses = scopedReleaseProcesses(isolatedRoot);
    if (lastProcesses.length === 0) {
      rmSync(isolatedRoot, { recursive: true, force: true });
      if (!existsSync(isolatedRoot)) {
        absentSince ??= Date.now();
        if (Date.now() - absentSince >= stableForMs) return;
      } else {
        absentSince = undefined;
      }
    } else {
      absentSince = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(
    'native.scoped-cleanup-incomplete',
    JSON.stringify({
      isolatedRoot,
      rootExists: existsSync(isolatedRoot),
      processes: lastProcesses,
    }),
  );
};

const sha256File = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');
const representativeProject = Object.freeze({
  name: 'Desktop Release Oracle Persistence Payload',
  gameType: 'battle-royale',
  idempotencyKey: 'desktop-release-oracle-persistence-payload',
});
const policyIdentity = Object.freeze({
  architecture: 'arm64',
  bundleId: 'dev.tileborne.app',
});
const authoredLayerId = 'layer:11111111-1111-4111-8111-111111111111';
const authoredObjectLayerId = 'layer:22222222-2222-4222-8222-222222222222';
const authoredObjectId = 'object:33333333-3333-4333-8333-333333333333';
const authoredObjectKind = 'gobj:44444444-4444-4444-8444-444444444444';
const authoredProjectProperties = Object.freeze({
  starterTemplateId: 'desktop-release-oracle',
  starterSeed: representativeProject.idempotencyKey,
  oraclePayload: 'desktop-release-persistence-v1',
});
const authoredMapPayload = Object.freeze({
  layers: [
    {
      kind: 'tile',
      id: authoredLayerId,
      name: 'oracle-authored-tiles',
      visible: true,
      opacity: 1,
      chunks: [
        {
          x: 0,
          y: 0,
          width: 4,
          height: 4,
          tiles: [1, 2, 3, 4, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987],
        },
      ],
    },
    {
      kind: 'object',
      id: authoredObjectLayerId,
      name: 'oracle-authored-objects',
      visible: true,
      opacity: 1,
      objectIds: [authoredObjectId],
    },
  ],
  objects: [
    {
      id: authoredObjectId,
      kind: authoredObjectKind,
      x: 96,
      y: 128,
      width: 32,
      height: 48,
      layerId: authoredObjectLayerId,
      properties: {
        oraclePayload: 'desktop-release-object-v1',
        lootTier: 3,
        spawn: { team: 'blue', slot: 7 },
      },
    },
  ],
});

const stableSemverParts = (version) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (match === null) fail('native.invalid-version', version);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareStableSemver = (left, right) => {
  const leftParts = stableSemverParts(left);
  const rightParts = stableSemverParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
};

const codesignDetails = (target) => {
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', target], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error !== undefined || result.status !== 0) {
    fail('native.codesign-details-failed', target);
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const authority = output.match(/^Authority=(Developer ID Application:.+)$/m)?.[1]?.trim();
  const teamIdentifier = output.match(/^TeamIdentifier=([A-Z0-9]{10})$/m)?.[1];
  const flags = output.match(/^CodeDirectory .+ flags=.+\(([^)]+)\)/m)?.[1] ?? '';
  if (!authority || !teamIdentifier) {
    fail('native.developer-id-missing', target);
  }
  return { authority, teamIdentifier, flags };
};

const verifySignedTarget = (target, type, options = {}) => {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', target]);
  if (options.oracleUnstapledFixtures !== true) {
    run('/usr/bin/xcrun', ['stapler', 'validate', target]);
    if (type === 'installer') {
      run('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        '--verbose=4',
        target,
      ]);
    } else {
      run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', target]);
    }
  }
  return codesignDetails(target);
};

const mountDmg = (dmg, mountPoint) => {
  run('/usr/bin/hdiutil', ['verify', dmg]);
  mkdirSync(mountPoint, { recursive: true });
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, dmg]);
  const apps = readdirSync(mountPoint).filter((entry) => entry.endsWith('.app'));
  if (apps.length !== 1) fail('native.app-count-invalid', `${dmg}: ${apps.length}`);
  return path.join(mountPoint, apps[0]);
};

const extractUpdateApp = (zipPath, destinationRoot) => {
  run('/usr/bin/ditto', ['-x', '-k', zipPath, destinationRoot]);
  const apps = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.app')) {
        apps.push(candidate);
      } else {
        visit(candidate);
      }
    }
  };
  visit(destinationRoot);
  if (apps.length !== 1) fail('native.update-app-count-invalid', `${zipPath}: ${apps.length}`);
  return apps[0];
};

const createZipFromApp = (appPath, zipPath) => {
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, zipPath]);
};

const replacePlistString = (plistPath, key, value) => {
  run('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath]);
};

const thinMachO = ({ source, destination, architecture }) => {
  const result = spawnSync(
    '/usr/bin/lipo',
    [source, '-thin', architecture, '-output', destination],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    fail(
      'native.fixture-architecture-unavailable',
      `${source} does not contain ${architecture}: ${result.stderr ?? result.stdout ?? ''}`,
    );
  }
  const architectures = run('/usr/bin/lipo', ['-archs', destination]).trim().split(/\s+/);
  if (architectures.length !== 1 || architectures[0] !== architecture) {
    fail('native.fixture-architecture-invalid', architectures.join(','));
  }
};

const signFixture = ({ appPath, signingAuthority }) => {
  run('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--options',
    'runtime',
    '--sign',
    signingAuthority,
    appPath,
  ]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
  return codesignDetails(appPath);
};

const createRejectedUpdateArtifact = ({
  mode,
  updateArtifact,
  workRoot,
  targetVersion,
  approvedSigningAuthority,
  approvedTeamIdentifier,
}) => {
  const baselineIdentity = {
    expectedArchitecture: policyIdentity.architecture,
    observedArchitecture: policyIdentity.architecture,
    expectedBundleId: policyIdentity.bundleId,
    observedBundleId: policyIdentity.bundleId,
    expectedTeamIdentifier: approvedTeamIdentifier,
    observedTeamIdentifier: approvedTeamIdentifier,
  };
  if (mode === 'stale-version' || mode === 'same-version') {
    return { zipPath: updateArtifact, identity: baselineIdentity };
  }
  if (mode === 'malformed-metadata' || mode === 'unavailable-feed') {
    return { zipPath: updateArtifact, identity: baselineIdentity };
  }

  const fixtureRoot = path.join(workRoot, mode);
  const extractRoot = path.join(fixtureRoot, 'extract');
  mkdirSync(extractRoot, { recursive: true });
  const appPath = extractUpdateApp(updateArtifact, extractRoot);
  const fixtureZip = path.join(fixtureRoot, `Tileborne-${mode}-${targetVersion}.zip`);
  const identity = { ...baselineIdentity };
  if (mode === 'wrong-architecture') {
    const executable = appMetadata(appPath).executablePath;
    thinMachO({ source: '/usr/bin/true', destination: executable, architecture: 'x86_64' });
    const signed = signFixture({ appPath, signingAuthority: approvedSigningAuthority });
    identity.observedArchitecture = 'x86_64';
    identity.observedTeamIdentifier = signed.teamIdentifier;
  } else if (mode === 'wrong-bundle') {
    replacePlistString(
      path.join(appPath, 'Contents', 'Info.plist'),
      'CFBundleIdentifier',
      'dev.tileborne.other',
    );
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
    identity.observedBundleId = 'dev.tileborne.other';
    identity.observedTeamIdentifier = 'ad-hoc';
  } else if (mode === 'wrong-team') {
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
    identity.observedTeamIdentifier = 'ad-hoc';
  } else if (mode === 'interrupted-download') {
    copyFileSync(updateArtifact, fixtureZip);
    return { zipPath: fixtureZip, identity };
  }
  createZipFromApp(appPath, fixtureZip);
  return { zipPath: fixtureZip, identity };
};

const appMetadata = (appPath) => {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  const bundleId = run('/usr/bin/plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    infoPlist,
  ]).trim();
  const executableName = run('/usr/bin/plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    '-o',
    '-',
    infoPlist,
  ]).trim();
  const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName);
  const architectures = run('/usr/bin/lipo', ['-archs', executablePath]).trim().split(/\s+/);
  if (architectures.length !== 1 || architectures[0] !== 'arm64') {
    fail('native.architecture-invalid', architectures.join(','));
  }
  const provenancePath = path.join(
    appPath,
    'Contents',
    'Resources',
    'tileborne-desktop-provenance.json',
  );
  let releaseProvenance;
  try {
    releaseProvenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  } catch {
    fail('native.embedded-provenance-missing', provenancePath);
  }
  const provenanceKeys = Object.keys(releaseProvenance).sort();
  const expectedKeys = [
    'buildCommand',
    'policyId',
    'schemaVersion',
    'sourceCommit',
    'teamIdentifier',
    'version',
  ];
  if (JSON.stringify(provenanceKeys) !== JSON.stringify(expectedKeys)) {
    fail('native.embedded-provenance-schema-invalid', provenancePath);
  }
  if (
    releaseProvenance.schemaVersion !== 1 ||
    releaseProvenance.policyId !== 'tileborne-desktop-1.0' ||
    releaseProvenance.buildCommand !== 'pnpm --filter @tileborne/desktop package' ||
    !/^[a-f0-9]{40}$/.test(releaseProvenance.sourceCommit) ||
    !/^[A-Z0-9]{10}$/.test(releaseProvenance.teamIdentifier) ||
    typeof releaseProvenance.version !== 'string' ||
    releaseProvenance.version.length === 0
  ) {
    fail('native.embedded-provenance-invalid', provenancePath);
  }
  return { bundleId, executablePath, architecture: 'arm64', releaseProvenance };
};

const waitForBridge = async (app) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const ready = await page
        .evaluate(() => typeof window.tileborne?.projects?.list === 'function')
        .catch(() => false);
      if (ready) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail('native.renderer-timeout', 'Tileborne bridge did not become ready');
};

const launch = async ({
  executablePath,
  isolatedRoot,
  tileborneHome,
  nonce,
  action,
  projectId,
  feedUrl,
  targetVersion,
  expectedProjectEvidence,
}) => {
  const userData = path.join(isolatedRoot, `user-data-${action}`);
  const appData = path.join(isolatedRoot, 'app-data');
  const quitAfterStartupMarker = path.join(isolatedRoot, 'shipit-relaunch-quit-after-startup');
  const isolationConfig = path.join(isolatedRoot, '.tileborne-e2e-isolation.json');
  mkdirSync(userData, { recursive: true });
  mkdirSync(appData, { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TILEBORNE_DISABLE_DEVTOOLS: 'true',
    TILEBORNE_E2E: '1',
    TILEBORNE_E2E_ISOLATION_NONCE: nonce,
    TILEBORNE_E2E_USER_DATA_DIR: userData,
    TILEBORNE_E2E_APP_DATA_DIR: appData,
    TILEBORNE_E2E_ISOLATION_CONFIG: isolationConfig,
    TILEBORNE_E2E_QUIT_AFTER_STARTUP_MARKER: quitAfterStartupMarker,
    TILEBORNE_HOME: tileborneHome,
    ...(feedUrl === undefined ? {} : { TILEBORNE_DESKTOP_UPDATE_LOOPBACK_FEED_URL: feedUrl }),
  };
  delete env.TILEBORNE_REMOTE_DEBUGGING_PORT;
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`],
    cwd: isolatedRoot,
    env,
  });
  try {
    const page = await waitForBridge(app);
    const readProjectEvidence = async (expectedProjectId, expectedMapId) =>
      page.evaluate(
        async ({ projectId: expected, name, mapId }) => {
          const listed = await window.tileborne.projects.list({});
          const summary = listed.projects.find(({ id }) => String(id) === expected);
          if (summary === undefined || summary.name !== name) {
            return { found: false, id: expected, name: summary?.name ?? null };
          }
          const opened = await window.tileborne.projects.get({ projectId: expected });
          const starterMap =
            typeof mapId === 'string'
              ? (await window.tileborne.maps.get({ projectId: expected, mapId })).map
              : undefined;
          return {
            found: true,
            id: String(opened.project.id),
            name: opened.project.name,
            engineVersion: opened.project.engineVersion,
            plugins: opened.project.plugins
              .map((plugin) => ({ id: String(plugin.id), version: String(plugin.version) }))
              .sort((left, right) => left.id.localeCompare(right.id)),
            assetPacks: opened.project.assetPacks
              .map((pack) => ({ id: String(pack.id), version: String(pack.version) }))
              .sort((left, right) => left.id.localeCompare(right.id)),
            maps: opened.project.maps
              .map((map) => ({ id: String(map.id), path: String(map.path) }))
              .sort((left, right) => left.id.localeCompare(right.id)),
            starterMap:
              starterMap === undefined
                ? null
                : {
                    id: String(starterMap.id),
                    width: starterMap.width,
                    height: starterMap.height,
                    tileWidth: starterMap.tileWidth,
                    tileHeight: starterMap.tileHeight,
                    layers: starterMap.layers,
                    objects: starterMap.objects,
                    properties: starterMap.properties,
                  },
          };
        },
        { projectId: expectedProjectId, name: representativeProject.name, mapId: expectedMapId },
      );
    const assertExpectedProjectEvidence = (actual) => {
      if (
        expectedProjectEvidence !== undefined &&
        JSON.stringify(actual) !== JSON.stringify(expectedProjectEvidence)
      ) {
        fail(
          'native.project-payload-mismatch',
          JSON.stringify({ expected: expectedProjectEvidence, actual }),
        );
      }
    };
    if (action === 'create') {
      const created = await page.evaluate(async () =>
        window.tileborne.projects.createGame({
          name: 'Desktop Release Oracle Persistence Payload',
          gameType: 'battle-royale',
          idempotencyKey: 'desktop-release-oracle-persistence-payload',
        }),
      );
      const projectId = String(created.projectId);
      await page.evaluate(
        async ({ projectId: expected, mapId, properties, payload }) => {
          const starterMap = (await window.tileborne.maps.get({ projectId: expected, mapId })).map;
          await window.tileborne.maps.update({
            projectId: expected,
            map: {
              ...starterMap,
              layers: payload.layers,
              objects: payload.objects,
              properties,
            },
          });
        },
        {
          projectId,
          mapId: String(created.mapId),
          properties: authoredProjectProperties,
          payload: authoredMapPayload,
        },
      );
      return await readProjectEvidence(projectId, String(created.mapId));
    }
    if (action === 'update') {
      if (!targetVersion) fail('native.target-version-missing', 'update launch');
      await page.evaluate(async () => window.tileborneDesktopUpdates.check());
      const deadline = Date.now() + 120_000;
      let lastState;
      while (Date.now() < deadline) {
        lastState = await page.evaluate(async () => window.tileborneDesktopUpdates.getState());
        if (lastState.state === 'ready' && lastState.targetVersion === targetVersion) {
          break;
        }
        if (lastState.state === 'error') {
          fail(
            'native.update-check-failed',
            `${lastState.diagnostic?.code ?? 'unknown'}: ${lastState.diagnostic?.message ?? ''}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (lastState?.state !== 'ready' || lastState.targetVersion !== targetVersion) {
        fail('native.update-timeout', JSON.stringify(lastState ?? null));
      }
      writeFileSync(quitAfterStartupMarker, `${Date.now()}\n`);
      await page.evaluate(async () => window.tileborneDesktopUpdates.restart());
      await app.waitForEvent('close', { timeout: 120_000 }).catch((error) => {
        fail(
          'native.update-restart-timeout',
          error instanceof Error ? error.message : String(error),
        );
      });
      await waitForNoScopedReleaseProcesses({
        isolatedRoot,
        timeoutMs: 120_000,
        phase: 'shipit-relaunch',
      });
      return projectId;
    }
    if (action === 'reject') {
      if (!targetVersion) fail('native.target-version-missing', 'reject launch');
      await page.evaluate(async () => window.tileborneDesktopUpdates.check());
      const deadline = Date.now() + 45_000;
      let lastState;
      while (Date.now() < deadline) {
        lastState = await page.evaluate(async () => window.tileborneDesktopUpdates.getState());
        if (lastState.state === 'error' || lastState.state === 'up-to-date') {
          return {
            state: lastState.state,
            diagnosticCode: lastState.diagnostic?.code ?? 'none',
          };
        }
        if (lastState.state === 'ready' && lastState.targetVersion === targetVersion) {
          fail('native.failure-fixture-accepted', JSON.stringify(lastState));
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      fail('native.failure-fixture-timeout', JSON.stringify(lastState ?? null));
    }
    const projectEvidence = await readProjectEvidence(
      projectId,
      expectedProjectEvidence?.starterMap?.id,
    );
    if (
      projectEvidence.found !== true ||
      projectEvidence.id !== projectId ||
      projectEvidence.name !== representativeProject.name ||
      projectEvidence.plugins.length < 1 ||
      projectEvidence.assetPacks.length < 1 ||
      projectEvidence.maps.length < 1 ||
      projectEvidence.starterMap === null
    ) {
      fail('native.project-reopen-failed', JSON.stringify(projectEvidence));
    }
    assertExpectedProjectEvidence(projectEvidence);
    return projectEvidence;
  } finally {
    await app.close().catch(() => undefined);
  }
};

const failureModes = [
  'stale-version',
  'same-version',
  'wrong-architecture',
  'wrong-bundle',
  'wrong-team',
  'malformed-metadata',
  'unavailable-feed',
  'interrupted-download',
];

const feedFixtureForMode = ({ mode, sourceVersion, targetVersion, port }) => {
  if (mode === 'malformed-metadata') {
    return { status: 200, body: '{"url":', contentType: 'application/json' };
  }
  const version =
    mode === 'stale-version'
      ? decrementPatchVersion(sourceVersion)
      : mode === 'same-version'
        ? sourceVersion
        : targetVersion;
  const fileName =
    mode === 'wrong-architecture'
      ? `Tileborne-darwin-x64-${version}.zip`
      : `Tileborne-darwin-arm64-${version}.zip`;
  return {
    status: 200,
    contentType: 'application/json',
    body: `${JSON.stringify({
      url: `http://127.0.0.1:${port}/download/${fileName}`,
      name:
        mode === 'wrong-bundle'
          ? `Tileborne dev.tileborne.other ${version}`
          : mode === 'wrong-team'
            ? `Tileborne wrong-team ${version}`
            : `Tileborne ${version}`,
      notes: `${mode} Tileborne loopback update oracle fixture`,
      pub_date: new Date().toISOString(),
      ...(mode === 'wrong-bundle' ? { bundleId: 'dev.tileborne.other' } : {}),
      ...(mode === 'wrong-team' ? { teamIdentifier: 'ZZZZZZZZZZ' } : {}),
    })}\n`,
  };
};

export const decrementPatchVersion = (version) => {
  const [major, minor, patch] = stableSemverParts(version);
  if (patch > 0) return `${major}.${minor}.${patch - 1}`;
  if (minor > 0) return `${major}.${minor - 1}.999`;
  if (major > 0) return `${major - 1}.999.999`;
  fail('native.stale-version-unavailable', version);
};

const serveSquirrelFeed = async ({ zipPath, version, sourceVersion, mode = 'success' }) => {
  const zipBuffer = readFileSync(zipPath);
  let metadataRequests = 0;
  let artifactRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/feed') {
      metadataRequests += 1;
      if (mode !== 'success') {
        const fixture = feedFixtureForMode({
          mode,
          sourceVersion,
          targetVersion: version,
          port: server.address().port,
        });
        response.writeHead(fixture.status, { 'content-type': fixture.contentType });
        response.end(fixture.body);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        `${JSON.stringify({
          url: `http://127.0.0.1:${server.address().port}/download/Tileborne-darwin-arm64-${version}.zip`,
          name: `Tileborne ${version}`,
          notes: 'Tileborne loopback update oracle fixture',
          pub_date: new Date().toISOString(),
        })}\n`,
      );
      return;
    }
    if (request.url?.startsWith('/download/')) {
      artifactRequests += 1;
      if (mode === 'interrupted-download') {
        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': zipBuffer.byteLength + 1024,
        });
        response.write(zipBuffer.subarray(0, Math.max(1, Math.floor(zipBuffer.byteLength / 8))));
        response.destroy();
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': zipBuffer.byteLength,
      });
      response.end(zipBuffer);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/feed`,
    close: () => new Promise((resolve) => server.close(resolve)),
    evidence: () => ({ metadataRequests, artifactRequests }),
  };
};

const waitForInstalledVersion = async ({ appPath, version }) => {
  const deadline = Date.now() + 120_000;
  let lastVersion = null;
  while (Date.now() < deadline) {
    try {
      lastVersion = appMetadata(appPath).releaseProvenance.version;
      if (lastVersion === version) return;
    } catch {
      // Squirrel may transiently move the bundle while applying the update.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('native.update-install-version-mismatch', lastVersion ?? '<unreadable>');
};

const verifyFailureMatrix = async ({
  installedExecutablePath,
  isolatedRoot,
  tileborneHome,
  projectId,
  nonce,
  updateArtifact,
  sourceVersion,
  targetVersion,
  expectedProjectEvidence,
  approvedSigningAuthority,
  approvedTeamIdentifier,
}) => {
  const results = [];
  const fixtureRoot = path.join(isolatedRoot, 'failure-fixtures');
  for (const mode of failureModes) {
    let fixtureFeed;
    try {
      const fixtureArtifact = createRejectedUpdateArtifact({
        mode,
        updateArtifact,
        workRoot: fixtureRoot,
        targetVersion,
        approvedSigningAuthority,
        approvedTeamIdentifier,
      });
      const feedUrl =
        mode === 'unavailable-feed'
          ? 'http://127.0.0.1:9/feed'
          : (fixtureFeed = await serveSquirrelFeed({
              zipPath: fixtureArtifact.zipPath,
              version: targetVersion,
              sourceVersion,
              mode,
            })).url;
      const rejection = await launch({
        executablePath: installedExecutablePath,
        isolatedRoot,
        tileborneHome,
        nonce,
        action: 'reject',
        projectId,
        feedUrl,
        targetVersion,
      });
      const projectAfterRejection = await launch({
        executablePath: installedExecutablePath,
        isolatedRoot,
        tileborneHome,
        nonce,
        action: 'relaunch',
        projectId,
        expectedProjectEvidence,
      });
      results.push({
        mode,
        rejectionState: rejection.state,
        diagnosticCode: rejection.diagnosticCode,
        fixtureIdentity: fixtureArtifact.identity,
        feedMetadataRequests: fixtureFeed?.evidence().metadataRequests ?? 0,
        feedArtifactRequests: fixtureFeed?.evidence().artifactRequests ?? 0,
        projectAfterRejection,
      });
    } finally {
      if (fixtureFeed !== undefined) {
        await fixtureFeed.close().catch(() => undefined);
      }
    }
  }
  return results;
};

const main = async () => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    fail('native.unsupported-host', `${process.platform}/${process.arch}`);
  }
  const args = parseArgs(process.argv.slice(2));
  const oracleUnstapledFixtures = args['oracle-unstapled-fixtures'] !== undefined;
  const candidateOnly = args['candidate-only'] !== undefined;
  const candidate = path.resolve(args.candidate);
  const updateArtifact = path.resolve(args['update-artifact']);
  if (!existsSync(candidate)) {
    fail('native.artifact-missing', 'candidate installer');
  }
  if (!existsSync(updateArtifact)) {
    fail('native.update-artifact-missing', 'candidate update ZIP');
  }

  const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), 'tileborne-desktop-release-'));
  const candidateMount = path.join(isolatedRoot, 'candidate-mount');
  const updateExtractionRoot = path.join(isolatedRoot, 'update-zip');
  let candidateMounted = false;
  let updateFeed;
  let receipt;
  let mainError;
  try {
    const candidateInstallerSigning = verifySignedTarget(candidate, 'installer', {
      oracleUnstapledFixtures,
    });
    const candidateApp = mountDmg(candidate, candidateMount);
    candidateMounted = true;
    const candidateAppSigning = verifySignedTarget(candidateApp, 'application', {
      oracleUnstapledFixtures,
    });
    const candidateMetadata = appMetadata(candidateApp);
    const updateApp = extractUpdateApp(updateArtifact, updateExtractionRoot);
    const updateAppSigning = verifySignedTarget(updateApp, 'application', {
      oracleUnstapledFixtures,
    });
    const updateMetadata = appMetadata(updateApp);

    const teamIdentifiers = new Set([
      candidateInstallerSigning.teamIdentifier,
      candidateAppSigning.teamIdentifier,
      updateAppSigning.teamIdentifier,
    ]);
    if (teamIdentifiers.size !== 1) fail('native.team-mismatch', [...teamIdentifiers].join(','));
    if (
      candidateMetadata.releaseProvenance.teamIdentifier !== candidateAppSigning.teamIdentifier ||
      candidateMetadata.releaseProvenance.teamIdentifier !==
        candidateInstallerSigning.teamIdentifier
    ) {
      fail('native.candidate-team-provenance-mismatch', 'codesign versus embedded provenance');
    }
    if (!candidateAppSigning.flags.split(',').includes('runtime')) {
      fail('native.hardened-runtime-missing', 'candidate');
    }
    if (candidateMetadata.bundleId !== 'dev.tileborne.app') {
      fail('native.bundle-id-mismatch', 'candidate');
    }
    if (updateMetadata.bundleId !== candidateMetadata.bundleId) {
      fail('native.update-bundle-id-mismatch', updateMetadata.bundleId);
    }
    if (
      updateMetadata.releaseProvenance.sourceCommit !==
      candidateMetadata.releaseProvenance.sourceCommit
    ) {
      fail('native.update-source-mismatch', updateMetadata.releaseProvenance.sourceCommit);
    }
    if (
      updateMetadata.releaseProvenance.teamIdentifier !==
      candidateMetadata.releaseProvenance.teamIdentifier
    ) {
      fail('native.update-team-provenance-mismatch', 'candidate versus update');
    }
    if (
      !candidateOnly &&
      compareStableSemver(
        updateMetadata.releaseProvenance.version,
        candidateMetadata.releaseProvenance.version,
      ) <= 0
    ) {
      fail('native.update-version-not-newer', updateMetadata.releaseProvenance.version);
    }
    if (!updateAppSigning.flags.split(',').includes('runtime')) {
      fail('native.update-hardened-runtime-missing', 'update');
    }

    const temporaryApplications = path.join(isolatedRoot, 'Applications');
    const installedApp = path.join(temporaryApplications, 'Tileborne.app');
    mkdirSync(temporaryApplications, { recursive: true });
    run('/usr/bin/ditto', [candidateApp, installedApp]);
    const installedMetadata = appMetadata(installedApp);
    const tileborneHome = path.join(isolatedRoot, 'tileborne-home');
    const firstLaunchProject = await launch({
      executablePath: installedMetadata.executablePath,
      isolatedRoot,
      tileborneHome,
      nonce: args.nonce,
      action: 'create',
    });
    const projectId = firstLaunchProject.id;
    const failureMatrix =
      candidateOnly || args['failure-matrix'] === undefined
        ? undefined
        : await verifyFailureMatrix({
            installedExecutablePath: installedMetadata.executablePath,
            isolatedRoot,
            tileborneHome,
            nonce: args.nonce,
            projectId,
            updateArtifact,
            sourceVersion: candidateMetadata.releaseProvenance.version,
            targetVersion: updateMetadata.releaseProvenance.version,
            expectedProjectEvidence: firstLaunchProject,
            approvedSigningAuthority: candidateAppSigning.authority,
            approvedTeamIdentifier: candidateAppSigning.teamIdentifier,
          });
    if (!candidateOnly) {
      updateFeed = await serveSquirrelFeed({
        zipPath: updateArtifact,
        version: updateMetadata.releaseProvenance.version,
        sourceVersion: candidateMetadata.releaseProvenance.version,
      });
      await launch({
        executablePath: installedMetadata.executablePath,
        isolatedRoot,
        tileborneHome,
        nonce: args.nonce,
        action: 'update',
        projectId,
        feedUrl: updateFeed.url,
        targetVersion: updateMetadata.releaseProvenance.version,
      });
      await waitForInstalledVersion({
        appPath: installedApp,
        version: updateMetadata.releaseProvenance.version,
      });
    }
    const relaunchedMetadata = appMetadata(installedApp);
    const relaunchedProject = await launch({
      executablePath: relaunchedMetadata.executablePath,
      isolatedRoot,
      tileborneHome,
      nonce: args.nonce,
      action: 'relaunch',
      projectId,
      expectedProjectEvidence: firstLaunchProject,
    });

    receipt = JSON.stringify({
      schemaVersion: 1,
      nonce: args.nonce,
      candidate: {
        candidateArtifactSha256: sha256File(candidate),
        format: 'udif',
        candidateArchitecture: candidateMetadata.architecture,
        bundleId: candidateMetadata.bundleId,
        embeddedSourceCommit: candidateMetadata.releaseProvenance.sourceCommit,
        embeddedVersion: candidateMetadata.releaseProvenance.version,
        candidateEmbeddedTeamIdentifier: candidateMetadata.releaseProvenance.teamIdentifier,
        candidateAuthority: candidateAppSigning.authority,
        candidateTeamIdentifier: candidateAppSigning.teamIdentifier,
        candidateHardenedRuntime: 'runtime',
        candidateStaple: oracleUnstapledFixtures ? 'oracle-unstapled-fixture' : 'validated',
        candidateGatekeeper: oracleUnstapledFixtures ? 'oracle-local-signed-only' : 'accepted',
        ...(oracleUnstapledFixtures
          ? {
              oracleFixtureScope:
                'local signed automatic-update oracle; production release verification remains stapler/Gatekeeper gated',
            }
          : {}),
      },
      install: {
        location: 'temporary-applications',
        firstLaunchProject: firstLaunchProject,
        sourceVersion: candidateMetadata.releaseProvenance.version,
        targetVersion: updateMetadata.releaseProvenance.version,
        loopbackFeedUrl: updateFeed?.url ?? null,
        feedMetadataRequests: updateFeed?.evidence().metadataRequests ?? 0,
        feedArtifactRequests: updateFeed?.evidence().artifactRequests ?? 0,
        relaunchProject: relaunchedProject,
        ...(candidateOnly
          ? {
              candidateOnly:
                'release-fast focused native candidate smoke; stable A-to-B update proof remains owned by release-stable',
            }
          : {}),
        ...(failureMatrix === undefined ? {} : { failureMatrix }),
      },
      update: {
        updateArtifactSha256: sha256File(updateArtifact),
        format: 'zip',
        updateArchitecture: updateMetadata.architecture,
        bundleId: updateMetadata.bundleId,
        embeddedSourceCommit: updateMetadata.releaseProvenance.sourceCommit,
        embeddedVersion: updateMetadata.releaseProvenance.version,
        updateEmbeddedTeamIdentifier: updateMetadata.releaseProvenance.teamIdentifier,
        updateAuthority: updateAppSigning.authority,
        updateTeamIdentifier: updateAppSigning.teamIdentifier,
        updateHardenedRuntime: 'runtime',
        updateStaple: oracleUnstapledFixtures ? 'oracle-unstapled-fixture' : 'validated',
        updateGatekeeper: oracleUnstapledFixtures ? 'oracle-local-signed-only' : 'accepted',
        ...(oracleUnstapledFixtures
          ? {
              oracleFixtureScope:
                'local signed automatic-update oracle; production release verification remains stapler/Gatekeeper gated',
            }
          : {}),
      },
    });
  } catch (error) {
    mainError = error;
  }

  let cleanupError;
  if (updateFeed !== undefined) {
    await updateFeed.close().catch(() => undefined);
  }
  if (candidateMounted) {
    try {
      run('/usr/bin/hdiutil', ['detach', candidateMount]);
    } catch (error) {
      cleanupError = error;
    }
  }
  try {
    await removeAndVerifyScopedReleaseRoot({ isolatedRoot });
  } catch (error) {
    cleanupError ??= error;
  }
  if (mainError !== undefined) throw mainError;
  if (cleanupError !== undefined) throw cleanupError;
  process.stdout.write(`${receipt}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

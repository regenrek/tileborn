/* global process, setTimeout, window */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const fail = (code, message) => {
  throw new Error(`${code}: ${message}`);
};

const parseArgs = (args) => {
  const allowed = new Set(['candidate', 'retained', 'backup-output', 'nonce']);
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
    if (!values[key]) fail('native.missing-argument', key);
  }
  if (!/^[a-f0-9]{64}$/.test(values.nonce)) fail('native.invalid-nonce', 'nonce');
  return values;
};

const run = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const sha256File = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');

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

const verifySignedTarget = (target, type) => {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', target]);
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
  const expectedKeys = ['buildCommand', 'policyId', 'schemaVersion', 'sourceCommit', 'version'];
  if (JSON.stringify(provenanceKeys) !== JSON.stringify(expectedKeys)) {
    fail('native.embedded-provenance-schema-invalid', provenancePath);
  }
  if (
    releaseProvenance.schemaVersion !== 1 ||
    releaseProvenance.policyId !== 'tileborne-desktop-1.0' ||
    releaseProvenance.buildCommand !== 'pnpm --filter @tileborne/desktop package' ||
    !/^[a-f0-9]{40}$/.test(releaseProvenance.sourceCommit) ||
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

const launch = async ({ executablePath, isolatedRoot, tileborneHome, action, projectId }) => {
  const userData = path.join(isolatedRoot, `user-data-${action}`);
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TILEBORNE_DISABLE_DEVTOOLS: 'true',
    TILEBORNE_E2E: '1',
    TILEBORNE_HOME: tileborneHome,
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
    if (action === 'create') {
      const created = await page.evaluate(async () =>
        window.tileborne.projects.createGame({
          name: 'Desktop Rollback Oracle',
          gameType: 'battle-royale',
          idempotencyKey: 'desktop-release-rollback-oracle',
        }),
      );
      return String(created.projectId);
    }
    const projects = await page.evaluate(async () => window.tileborne.projects.list({}));
    const ids = projects.projects.map(({ id }) => String(id));
    if (!projectId || !ids.includes(projectId)) {
      fail('native.project-reopen-failed', projectId ?? '<missing>');
    }
    return projectId;
  } finally {
    await app.close().catch(() => undefined);
  }
};

const main = async () => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    fail('native.unsupported-host', `${process.platform}/${process.arch}`);
  }
  const args = parseArgs(process.argv.slice(2));
  const candidate = path.resolve(args.candidate);
  const retained = path.resolve(args.retained);
  const backupOutput = path.resolve(args['backup-output']);
  if (!existsSync(candidate) || !existsSync(retained)) {
    fail('native.artifact-missing', 'candidate or retained installer');
  }

  const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), 'tileborne-desktop-release-'));
  const candidateMount = path.join(isolatedRoot, 'candidate-mount');
  const retainedMount = path.join(isolatedRoot, 'retained-mount');
  let candidateMounted = false;
  let retainedMounted = false;
  try {
    const candidateInstallerSigning = verifySignedTarget(candidate, 'installer');
    const retainedInstallerSigning = verifySignedTarget(retained, 'installer');
    const candidateApp = mountDmg(candidate, candidateMount);
    candidateMounted = true;
    const retainedApp = mountDmg(retained, retainedMount);
    retainedMounted = true;
    const candidateAppSigning = verifySignedTarget(candidateApp, 'application');
    const retainedAppSigning = verifySignedTarget(retainedApp, 'application');
    const candidateMetadata = appMetadata(candidateApp);
    const retainedMetadata = appMetadata(retainedApp);

    const teamIdentifiers = new Set([
      candidateInstallerSigning.teamIdentifier,
      retainedInstallerSigning.teamIdentifier,
      candidateAppSigning.teamIdentifier,
      retainedAppSigning.teamIdentifier,
    ]);
    if (teamIdentifiers.size !== 1) fail('native.team-mismatch', [...teamIdentifiers].join(','));
    if (!candidateAppSigning.flags.split(',').includes('runtime')) {
      fail('native.hardened-runtime-missing', 'candidate');
    }
    if (!retainedAppSigning.flags.split(',').includes('runtime')) {
      fail('native.hardened-runtime-missing', 'retained');
    }
    if (
      candidateMetadata.bundleId !== 'dev.tileborne.app' ||
      retainedMetadata.bundleId !== candidateMetadata.bundleId
    ) {
      fail('native.bundle-id-mismatch', 'candidate/retained');
    }

    const temporaryApplications = path.join(isolatedRoot, 'Applications');
    const installedApp = path.join(temporaryApplications, 'Tileborne.app');
    mkdirSync(temporaryApplications, { recursive: true });
    run('/usr/bin/ditto', [candidateApp, installedApp]);
    const installedMetadata = appMetadata(installedApp);
    const tileborneHome = path.join(isolatedRoot, 'tileborne-home');
    const projectId = await launch({
      executablePath: installedMetadata.executablePath,
      isolatedRoot,
      tileborneHome,
      action: 'create',
    });
    const relaunchedProjectId = await launch({
      executablePath: installedMetadata.executablePath,
      isolatedRoot,
      tileborneHome,
      action: 'relaunch',
      projectId,
    });

    mkdirSync(path.dirname(backupOutput), { recursive: true });
    rmSync(backupOutput, { force: true });
    run('/usr/bin/ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      tileborneHome,
      backupOutput,
    ]);
    const backupSha256 = sha256File(backupOutput);
    const backupSizeBytes = statSync(backupOutput).size;
    const restoredBackupRoot = path.join(isolatedRoot, 'restored-project-backup');
    mkdirSync(restoredBackupRoot, { recursive: true });
    run('/usr/bin/ditto', ['-x', '-k', backupOutput, restoredBackupRoot]);
    const restoredTileborneHome = path.join(restoredBackupRoot, path.basename(tileborneHome));
    if (!existsSync(restoredTileborneHome)) {
      fail('native.backup-restore-missing', restoredTileborneHome);
    }

    rmSync(installedApp, { recursive: true, force: true });
    run('/usr/bin/ditto', [retainedApp, installedApp]);
    const retainedInstalledMetadata = appMetadata(installedApp);
    const reopenedProjectId = await launch({
      executablePath: retainedInstalledMetadata.executablePath,
      isolatedRoot,
      tileborneHome: restoredTileborneHome,
      action: 'rollback',
      projectId,
    });

    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        nonce: args.nonce,
        candidate: {
          candidateArtifactSha256: sha256File(candidate),
          retainedArtifactSha256: sha256File(retained),
          format: 'udif',
          candidateArchitecture: candidateMetadata.architecture,
          retainedArchitecture: retainedMetadata.architecture,
          bundleId: candidateMetadata.bundleId,
          embeddedSourceCommit: candidateMetadata.releaseProvenance.sourceCommit,
          embeddedVersion: candidateMetadata.releaseProvenance.version,
          candidateAuthority: candidateAppSigning.authority,
          retainedAuthority: retainedAppSigning.authority,
          candidateTeamIdentifier: candidateAppSigning.teamIdentifier,
          retainedTeamIdentifier: retainedAppSigning.teamIdentifier,
          candidateHardenedRuntime: 'runtime',
          retainedHardenedRuntime: 'runtime',
          candidateStaple: 'validated',
          retainedStaple: 'validated',
          candidateGatekeeper: 'accepted',
          retainedGatekeeper: 'accepted',
        },
        install: {
          location: 'temporary-applications',
          firstLaunchProjectId: projectId,
          relaunchProjectId: relaunchedProjectId,
        },
        rollback: {
          action: 'retained-installer-reinstalled',
          backupSha256,
          backupSizeBytes,
          reopenedProjectId,
        },
      })}\n`,
    );
  } finally {
    if (candidateMounted) {
      try {
        run('/usr/bin/hdiutil', ['detach', candidateMount]);
      } catch {
        // The temporary root is removed below; detach is best-effort cleanup.
      }
    }
    if (retainedMounted) {
      try {
        run('/usr/bin/hdiutil', ['detach', retainedMount]);
      } catch {
        // The temporary root is removed below; detach is best-effort cleanup.
      }
    }
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

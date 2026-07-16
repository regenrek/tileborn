#!/usr/bin/env node

/* global Buffer, console, process */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const SENSITIVE_RELEASE_ENVIRONMENT = Object.freeze([
  'TILEBORNE_DESKTOP_RELEASE',
  'TILEBORNE_APPLE_SIGNING_IDENTITY',
  'TILEBORNE_APPLE_TEAM_ID',
  'TILEBORNE_APPLE_API_KEY_PATH',
  'TILEBORNE_APPLE_API_KEY_ID',
  'TILEBORNE_APPLE_API_ISSUER',
  'TILEBORNE_DESKTOP_PUBLISH_APPROVED',
  'GH_TOKEN',
]);
const SHA256 = /^[a-f0-9]{64}$/;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, args, allowFailure = false) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
};

const assert = (condition, code, message) => {
  if (!condition) throw new Error(`${code}: ${message}`);
};

const outputDirectories = (root) => {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === 'dist' || entry.name === '.vite' || entry.name === 'out') {
        found.push(path.relative(root, child));
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  return found.sort();
};

const sanitizeEnvironment = () => {
  const env = { ...process.env };
  for (const name of SENSITIVE_RELEASE_ENVIRONMENT) delete env[name];
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
};

const writePrivate = (file, bytes) => {
  writeFileSync(file, bytes, { mode: 0o600 });
  chmodSync(file, 0o600);
};

const run = ({ root, evidenceRoot, id, command, args, expect = 'success', env = {} }) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...sanitizeEnvironment(), ...env },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const stdoutFile = `${id}.stdout.log`;
  const stderrFile = `${id}.stderr.log`;
  writePrivate(path.join(evidenceRoot, stdoutFile), stdout);
  writePrivate(path.join(evidenceRoot, stderrFile), stderr);
  const receipt = {
    command: [command, ...args],
    exitCode: result.status,
    signal: result.signal,
    stdout: { file: stdoutFile, bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
    stderr: { file: stderrFile, bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
  };
  const succeeded = result.error === undefined && result.status === 0;
  if ((expect === 'success' && !succeeded) || (expect === 'failure' && succeeded)) {
    throw new Error(
      `${id} ${expect === 'success' ? 'failed' : 'unexpectedly succeeded'}: ${JSON.stringify({ ...receipt, error: result.error?.message })}`,
    );
  }
  return { receipt, stdout, stderr, succeeded };
};

const findFiles = (root, predicate) => {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (predicate(child, entry)) found.push(child);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(child);
    }
  };
  visit(root);
  return found.sort();
};

const copyTree = (source, destination) => {
  execFileSync('/usr/bin/ditto', [source, destination], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
};

const treeManifest = (root) => {
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      const stats = lstatSync(absolute);
      if (stats.isDirectory()) {
        visit(absolute);
      } else if (stats.isSymbolicLink()) {
        entries.push({ path: relative, kind: 'symlink', target: readlinkSync(absolute) });
      } else if (stats.isFile()) {
        entries.push({
          path: relative,
          kind: 'file',
          sizeBytes: stats.size,
          sha256: sha256(readFileSync(absolute)),
        });
      }
    }
  };
  visit(root);
  const bytes = `${JSON.stringify(entries)}\n`;
  return {
    fileCount: entries.filter(({ kind }) => kind === 'file').length,
    symlinkCount: entries.filter(({ kind }) => kind === 'symlink').length,
    sizeBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
    sha256: sha256(bytes),
  };
};

const plistValue = (appPath, key) =>
  execFileSync(
    '/usr/bin/plutil',
    ['-extract', key, 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  ).trim();

export const deriveBinaryDecision = ({
  canonicalDecision,
  developerIdSignature,
  hardenedRuntime,
  notarizationStaple,
  gatekeeper,
  creatorSmoke,
  artifactDigest,
}) => {
  const blockers = [];
  if (developerIdSignature !== 'valid') blockers.push('signing.developer-id-invalid');
  if (hardenedRuntime !== 'enabled') blockers.push('signing.hardened-runtime-missing');
  if (notarizationStaple !== 'valid') blockers.push('notarization.staple-invalid');
  if (gatekeeper !== 'accepted') blockers.push('gatekeeper.assessment-rejected');
  if (creatorSmoke !== 'passed') blockers.push('native.creator-smoke-failed');
  if (!SHA256.test(artifactDigest)) blockers.push('artifact.sha256-invalid');
  if (canonicalDecision !== 'go') blockers.push('contract.not-go');
  return Object.freeze({
    decision: blockers.length === 0 ? 'go' : 'no-go',
    blockers: Object.freeze(blockers),
  });
};

const atomicReceipt = (evidenceRoot, receipt) => {
  const pending = path.join(evidenceRoot, 'native-desktop-closeout-receipt.pending.json');
  const closed = path.join(evidenceRoot, 'native-desktop-closeout-receipt.json');
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  writePrivate(pending, bytes);
  const descriptor = openSync(pending, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(pending, closed);
  const directoryDescriptor = openSync(evidenceRoot, 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
  return { file: closed, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) };
};

export const runNativeDesktopReleaseCloseout = ({ root = process.cwd(), evidenceRoot }) => {
  assert(
    process.platform === 'darwin' && process.arch === 'arm64',
    'native.unsupported-host',
    `${process.platform}/${process.arch}`,
  );
  assert(
    typeof evidenceRoot === 'string' && evidenceRoot.length > 0,
    'closeout.evidence-root-missing',
    'pass an external evidence directory',
  );
  const checkoutRoot = realpathSync(root);
  assert(
    realpathSync(git(checkoutRoot, ['rev-parse', '--show-toplevel'])) === checkoutRoot,
    'closeout.not-root',
    checkoutRoot,
  );
  assert(
    git(checkoutRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true) === null,
    'closeout.not-detached',
    'detached HEAD required',
  );
  const head = git(checkoutRoot, ['rev-parse', 'HEAD']);
  const initialStatus = git(checkoutRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assert(initialStatus === '', 'closeout.dirty-checkout', initialStatus);
  const preexistingOutputs = outputDirectories(checkoutRoot);
  assert(
    preexistingOutputs.length === 0,
    'closeout.preexisting-output',
    JSON.stringify(preexistingOutputs),
  );

  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  chmodSync(evidenceRoot, 0o700);
  const resolvedEvidenceRoot = realpathSync(evidenceRoot);
  assert(
    !resolvedEvidenceRoot.startsWith(`${checkoutRoot}${path.sep}`),
    'closeout.evidence-inside-checkout',
    resolvedEvidenceRoot,
  );

  const commands = {};
  commands.frozenInstall = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '01-frozen-install',
    command: 'pnpm',
    args: ['install', '--frozen-lockfile'],
  }).receipt;
  commands.releaseGates = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '02-release-gates',
    command: 'pnpm',
    args: ['release:gates'],
  }).receipt;
  commands.forgeMake = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '03-forge-make',
    command: 'pnpm',
    args: ['--filter', '@tileborne/desktop', 'package'],
  }).receipt;

  const outRoot = path.join(checkoutRoot, 'apps', 'desktop', 'out');
  const apps = findFiles(
    outRoot,
    (candidate, entry) => entry.isDirectory() && path.basename(candidate) === 'Tileborne.app',
  );
  const dmgs = findFiles(
    outRoot,
    (candidate, entry) => entry.isFile() && candidate.toLowerCase().endsWith('.dmg'),
  );
  assert(apps.length >= 1, 'artifact.app-missing', JSON.stringify(apps));
  assert(dmgs.length === 1, 'artifact.dmg-count-invalid', JSON.stringify(dmgs));
  const sourceApp =
    apps.find((candidate) => candidate.includes('Tileborne-darwin-arm64')) ?? apps[0];
  const sourceDmg = dmgs[0];
  const externalArtifacts = path.join(resolvedEvidenceRoot, 'artifacts');
  mkdirSync(externalArtifacts, { mode: 0o700 });
  const externalApp = path.join(externalArtifacts, 'Tileborne.app');
  const externalDmg = path.join(externalArtifacts, path.basename(sourceDmg));
  copyTree(sourceApp, externalApp);
  copyFileSync(sourceDmg, externalDmg);
  chmodSync(externalDmg, 0o600);

  commands.dmgVerify = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '04-hdiutil-verify',
    command: '/usr/bin/hdiutil',
    args: ['verify', externalDmg],
  }).receipt;
  const mountPoint = path.join(resolvedEvidenceRoot, 'mounted-dmg');
  mkdirSync(mountPoint);
  commands.dmgAttach = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '05-hdiutil-attach',
    command: '/usr/bin/hdiutil',
    args: ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, externalDmg],
  }).receipt;
  let installedApp;
  try {
    const mountedApps = findFiles(
      mountPoint,
      (candidate, entry) => entry.isDirectory() && path.basename(candidate) === 'Tileborne.app',
    );
    assert(
      mountedApps.length === 1,
      'artifact.mounted-app-count-invalid',
      JSON.stringify(mountedApps),
    );
    const installRoot = path.join(resolvedEvidenceRoot, 'Applications');
    mkdirSync(installRoot);
    installedApp = path.join(installRoot, 'Tileborne.app');
    copyTree(mountedApps[0], installedApp);
  } finally {
    commands.dmgDetach = run({
      root: checkoutRoot,
      evidenceRoot: resolvedEvidenceRoot,
      id: '06-hdiutil-detach',
      command: '/usr/bin/hdiutil',
      args: ['detach', mountPoint],
    }).receipt;
  }

  commands.packagedCreatorSmoke = run({
    root: path.join(checkoutRoot, 'apps', 'desktop'),
    evidenceRoot: resolvedEvidenceRoot,
    id: '07-external-installed-app-smoke',
    command: 'pnpm',
    args: [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.smoke.config.ts',
      'src/smoke/packaged-runtime-closure.smoke.spec.ts',
    ],
    env: { TILEBORNE_PACKAGED_APP_PATH: installedApp },
  }).receipt;

  const executable = path.join(
    installedApp,
    'Contents',
    'MacOS',
    plistValue(installedApp, 'CFBundleExecutable'),
  );
  const fileProbe = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '08-file-architecture',
    command: '/usr/bin/file',
    args: [executable],
  });
  commands.fileArchitecture = fileProbe.receipt;
  const lipoProbe = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '09-lipo-architecture',
    command: '/usr/bin/lipo',
    args: ['-archs', executable],
  });
  commands.lipoArchitecture = lipoProbe.receipt;
  const codesignDisplay = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '10-codesign-display',
    command: '/usr/bin/codesign',
    args: ['-dv', '--verbose=4', installedApp],
  });
  commands.codesignDisplay = codesignDisplay.receipt;
  const codesignStrict = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '11-codesign-strict',
    command: '/usr/bin/codesign',
    args: ['--verify', '--deep', '--strict', '--verbose=4', installedApp],
    expect: 'any',
  });
  commands.codesignStrict = codesignStrict.receipt;
  const stapler = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '12-stapler-validate',
    command: '/usr/bin/xcrun',
    args: ['stapler', 'validate', externalDmg],
    expect: 'any',
  });
  commands.staplerValidate = stapler.receipt;
  const notary = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '13-notary-credential-boundary',
    command: '/usr/bin/xcrun',
    args: ['notarytool', 'history'],
    expect: 'any',
  });
  commands.notaryCredentialBoundary = notary.receipt;
  const gatekeeper = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '14-gatekeeper-assess',
    command: '/usr/sbin/spctl',
    args: ['--assess', '--type', 'execute', '--verbose=4', installedApp],
    expect: 'any',
  });
  commands.gatekeeperAssess = gatekeeper.receipt;

  const appTree = treeManifest(installedApp);
  const dmgBytes = readFileSync(externalDmg);
  const dmg = {
    fileName: path.basename(externalDmg),
    sizeBytes: dmgBytes.byteLength,
    sha256: sha256(dmgBytes),
  };
  const version = JSON.parse(
    readFileSync(path.join(checkoutRoot, 'apps/desktop/package.json'), 'utf8'),
  ).version;
  const manifest = {
    schemaVersion: 1,
    policyId: 'tileborne-desktop-1.0',
    artifact: { ...dmg, kind: 'dmg', platform: 'darwin', architecture: 'arm64', version },
    provenance: {
      sourceCommit: head,
      buildCommand: 'pnpm --filter @tileborne/desktop package',
      builderOs: 'darwin',
      builderArchitecture: 'arm64',
      builtAt: new Date().toISOString(),
    },
  };
  const manifestFile = path.join(resolvedEvidenceRoot, 'candidate-manifest.json');
  writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const canonicalStatus = run({
    root: checkoutRoot,
    evidenceRoot: resolvedEvidenceRoot,
    id: '15-canonical-status',
    command: 'node',
    args: [
      'scripts/desktop-release-contract.mjs',
      'status',
      '--artifact',
      externalDmg,
      '--manifest',
      manifestFile,
      '--backup-output',
      path.join(resolvedEvidenceRoot, 'project-backup.zip'),
      '--output',
      path.join(resolvedEvidenceRoot, 'canonical-status.json'),
      '--expect',
      'no-go',
    ],
  });
  commands.canonicalStatus = canonicalStatus.receipt;
  const status = JSON.parse(canonicalStatus.stdout);

  const display = `${codesignDisplay.stdout}\n${codesignDisplay.stderr}`;
  const developerIdSignature =
    codesignStrict.succeeded && /Developer ID Application:/.test(display) ? 'valid' : 'invalid';
  const hardenedRuntime = /flags=.*runtime/.test(display) ? 'enabled' : 'missing';
  const notarizationStaple = stapler.succeeded ? 'valid' : 'invalid';
  const gatekeeperAssessment = gatekeeper.succeeded ? 'accepted' : 'rejected';
  const binary = deriveBinaryDecision({
    canonicalDecision: status.decision,
    developerIdSignature,
    hardenedRuntime,
    notarizationStaple,
    gatekeeper: gatekeeperAssessment,
    creatorSmoke: 'passed',
    artifactDigest: dmg.sha256,
  });
  const canonicalBlockers = status.blockers.map(({ code }) => code);
  const blockerCodes = [
    ...new Set([
      ...binary.blockers.filter((code) => code !== 'contract.not-go'),
      'notarization.credentials-missing',
      ...canonicalBlockers,
    ]),
  ].sort();
  const postStatus = git(checkoutRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assert(postStatus === '', 'closeout.post-run-dirty', postStatus);
  assert(
    lipoProbe.stdout.trim().split(/\s+/).includes('arm64'),
    'native.architecture-mismatch',
    lipoProbe.stdout.trim(),
  );
  assert(
    plistValue(installedApp, 'CFBundleIdentifier') === 'dev.tileborne.app',
    'native.bundle-id-mismatch',
    plistValue(installedApp, 'CFBundleIdentifier'),
  );
  assert(
    plistValue(installedApp, 'CFBundleShortVersionString') === version,
    'native.version-mismatch',
    plistValue(installedApp, 'CFBundleShortVersionString'),
  );

  const receipt = {
    schemaVersion: 1,
    state: 'closed',
    decision: binary.decision,
    blockerCodes,
    checkout: {
      root: checkoutRoot,
      head,
      detached: true,
      initialStatus,
      preexistingOutputs,
      postStatus,
    },
    host: { platform: process.platform, architecture: process.arch, release: os.release() },
    candidate: {
      platform: 'darwin',
      architecture: 'arm64',
      version,
      bundleId: 'dev.tileborne.app',
      app: { path: installedApp, ...appTree },
      dmg: { path: externalDmg, ...dmg },
    },
    nativeEvidence: {
      developerIdSignature,
      hardenedRuntime,
      notarizationStaple,
      notaryCredentials: notary.succeeded ? 'available' : 'missing',
      gatekeeper: gatekeeperAssessment,
      creatorOpenPlaytestShipSmoke: 'passed',
    },
    canonicalStatus: {
      decision: status.decision,
      artifactDecision: status.artifactDecision,
      publicationDecision: status.publicationDecision,
      blockers: status.blockers,
      knownLimitations: status.knownLimitations,
    },
    unsupported: status.knownLimitations,
    externalOwners: [
      {
        blocker: 'signing.approved-team-missing',
        owner: 'Apple Developer release owner',
        remediation:
          'Provide the approved TeamIdentifier and Developer ID Application identity through protected CI/operator secrets.',
      },
      {
        blocker: 'notarization.credentials-missing',
        owner: 'Apple notarization credential owner',
        remediation:
          'Provide the approved App Store Connect API key path, key id, and issuer through protected CI/operator secrets.',
      },
      {
        blocker: 'rollback.retained-artifact-missing',
        owner: 'Tileborne release owner',
        remediation:
          'Approve a strictly earlier signed/notarized LKG in scripts/desktop-release-policy.json and supply its exact retained DMG.',
      },
      {
        blocker: 'publish.approval-missing',
        owner: 'Tileborne release approver',
        remediation:
          'After artifact-only verification is ready, set TILEBORNE_DESKTOP_PUBLISH_APPROVED=1 for the approved final verification only.',
      },
      {
        blocker: 'publish.credential-missing',
        owner: 'GitHub release credential owner',
        remediation:
          'Provide a scoped GH_TOKEN through the protected release environment only after approval.',
      },
    ],
    remediationCommands: [
      'TILEBORNE_DESKTOP_RELEASE=1 pnpm --filter @tileborne/desktop package',
      'node scripts/desktop-release-contract.mjs status --artifact "$CANDIDATE" --retained-artifact "$RETAINED_DMG" --backup-output "$BACKUP_OUTPUT" --manifest "$MANIFEST" --output "$STATUS_OUTPUT" --skip-publication 1 --expect no-go',
      'node scripts/desktop-release-contract.mjs verify --artifact "$CANDIDATE" --retained-artifact "$RETAINED_DMG" --backup-output "$BACKUP_OUTPUT" --manifest "$MANIFEST" --output "$FINAL_STATUS_OUTPUT" --expect go',
    ],
    commands,
  };
  assert(
    receipt.decision === 'no-go',
    'closeout.unexpected-go',
    'unsigned local development candidate must remain no-go',
  );
  return atomicReceipt(resolvedEvidenceRoot, receipt);
};

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const result = runNativeDesktopReleaseCloseout({
      root: repoRoot,
      evidenceRoot: process.argv[2],
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}

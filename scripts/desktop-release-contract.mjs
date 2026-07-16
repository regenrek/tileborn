/* global console, process */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
export const desktopReleasePolicyPath = path.join(repoRoot, 'scripts/desktop-release-policy.json');

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RECEIPT_KEYS = ['schemaVersion', 'policyId'];

export class DesktopReleaseContractError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'DesktopReleaseContractError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new DesktopReleaseContractError(code, message);
};

const object = (value, at) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('contract.invalid-type', `${at} must be an object`);
  }
  return value;
};

const exactKeys = (value, keys, at) => {
  const record = object(value, at);
  const expected = new Set(keys);
  const missing = keys.filter((key) => !(key in record));
  const extra = Object.keys(record).filter((key) => !expected.has(key));
  if (missing.length > 0) fail('contract.missing-field', `${at}: ${missing.join(', ')}`);
  if (extra.length > 0) fail('contract.unknown-field', `${at}: ${extra.join(', ')}`);
  return record;
};

const string = (value, at, pattern) => {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    fail('contract.invalid-string', `${at} is invalid`);
  }
  return value;
};

const boolean = (value, at) => {
  if (typeof value !== 'boolean') fail('contract.invalid-boolean', `${at} must be boolean`);
  return value;
};

const positiveInteger = (value, at) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('contract.invalid-integer', `${at} must be a positive safe integer`);
  }
  return value;
};

const literal = (value, expected, at) => {
  if (value !== expected) fail('contract.invalid-literal', `${at} must be ${String(expected)}`);
  return value;
};

const oneOf = (value, allowed, at) => {
  if (!allowed.includes(value)) {
    fail('contract.invalid-enum', `${at} must be one of ${allowed.join(', ')}`);
  }
  return value;
};

const uniqueStrings = (value, at) => {
  if (!Array.isArray(value) || value.length === 0) {
    fail('contract.invalid-array', `${at} must be a non-empty array`);
  }
  const result = value.map((entry, index) => string(entry, `${at}[${index}]`));
  if (new Set(result).size !== result.length) fail('contract.duplicate-value', at);
  return result;
};

export function loadDesktopReleasePolicy(policyPath = desktopReleasePolicyPath) {
  return validateDesktopReleasePolicy(JSON.parse(readFileSync(policyPath, 'utf8')));
}

export function validateDesktopReleasePolicy(value) {
  const policy = exactKeys(
    value,
    [
      'schemaVersion',
      'policyId',
      'candidate',
      'requiredEvidence',
      'support',
      'publication',
      'rollback',
    ],
    'policy',
  );
  literal(policy.schemaVersion, 1, 'policy.schemaVersion');
  literal(policy.policyId, 'tileborne-desktop-1.0', 'policy.policyId');

  const candidate = exactKeys(
    policy.candidate,
    ['platform', 'architecture', 'artifactKind', 'channel'],
    'policy.candidate',
  );
  literal(candidate.platform, 'darwin', 'policy.candidate.platform');
  literal(candidate.architecture, 'arm64', 'policy.candidate.architecture');
  literal(candidate.artifactKind, 'dmg', 'policy.candidate.artifactKind');
  literal(candidate.channel, 'github-release', 'policy.candidate.channel');

  const evidence = uniqueStrings(policy.requiredEvidence, 'policy.requiredEvidence');
  const expectedEvidence = [
    'artifact-sha256',
    'source-provenance',
    'developer-id-signature',
    'apple-notarization',
    'stapled-ticket',
    'gatekeeper-install-first-launch-relaunch',
    'retained-installer-rollback',
    'verified-project-backup',
  ];
  if (JSON.stringify(evidence) !== JSON.stringify(expectedEvidence)) {
    fail('policy.required-evidence-drift', 'required evidence must match the 1.0 contract');
  }

  if (!Array.isArray(policy.support)) fail('contract.invalid-array', 'policy.support');
  const support = policy.support.map((entry, index) => {
    const record = exactKeys(entry, ['id', 'status', 'reason'], `policy.support[${index}]`);
    return {
      id: string(record.id, `policy.support[${index}].id`),
      status: oneOf(
        record.status,
        ['candidate', 'unsupported', 'operator-blocked'],
        `policy.support[${index}].status`,
      ),
      reason: string(record.reason, `policy.support[${index}].reason`),
    };
  });
  if (new Set(support.map(({ id }) => id)).size !== support.length) {
    fail('contract.duplicate-value', 'policy.support ids');
  }
  const expectedSupport = new Map([
    ['platform.macos-arm64', 'candidate'],
    ['platform.macos-x64', 'unsupported'],
    ['platform.windows', 'unsupported'],
    ['platform.linux', 'unsupported'],
    ['capability.auto-update', 'unsupported'],
    ['capability.remote-crash-reporting', 'unsupported'],
    ['capability.publish', 'operator-blocked'],
  ]);
  for (const [id, status] of expectedSupport) {
    if (support.find((entry) => entry.id === id)?.status !== status) {
      fail('policy.support-drift', `${id} must be explicitly ${status}`);
    }
  }
  if (support.length !== expectedSupport.size) {
    fail('policy.support-drift', 'support entries must exactly match the approved 1.0 matrix');
  }

  const publication = exactKeys(
    policy.publication,
    ['approvalEnvironment', 'credentialEnvironment', 'approvedValue'],
    'policy.publication',
  );
  literal(
    publication.approvalEnvironment,
    'TILEBORNE_DESKTOP_PUBLISH_APPROVED',
    'policy.publication.approvalEnvironment',
  );
  literal(
    publication.credentialEnvironment,
    'GH_TOKEN',
    'policy.publication.credentialEnvironment',
  );
  literal(publication.approvedValue, '1', 'policy.publication.approvedValue');

  const rollback = exactKeys(
    policy.rollback,
    [
      'mode',
      'retention',
      'requireArtifactDigest',
      'requireProjectBackupBeforeDowngrade',
      'requireBackupVerification',
      'requireReinstallSmoke',
      'requireProjectReopenSmoke',
      'automaticRollback',
    ],
    'policy.rollback',
  );
  literal(rollback.mode, 'manual-retained-installer', 'policy.rollback.mode');
  literal(rollback.retention, 'current-and-last-known-good', 'policy.rollback.retention');
  for (const key of [
    'requireArtifactDigest',
    'requireProjectBackupBeforeDowngrade',
    'requireBackupVerification',
    'requireReinstallSmoke',
    'requireProjectReopenSmoke',
  ]) {
    literal(rollback[key], true, `policy.rollback.${key}`);
  }
  literal(rollback.automaticRollback, 'unsupported', 'policy.rollback.automaticRollback');
  return policy;
}

export function validateDesktopReleaseManifest(value, policy = loadDesktopReleasePolicy()) {
  const manifest = exactKeys(
    value,
    [...RECEIPT_KEYS, 'artifact', 'provenance', 'signing', 'notarization'],
    'manifest',
  );
  validateReceiptHeader(manifest, policy, 'manifest');
  const artifact = exactKeys(
    manifest.artifact,
    ['fileName', 'kind', 'platform', 'architecture', 'version', 'sizeBytes', 'sha256'],
    'manifest.artifact',
  );
  const fileName = string(artifact.fileName, 'manifest.artifact.fileName');
  if (path.basename(fileName) !== fileName) fail('manifest.invalid-file-name', fileName);
  literal(artifact.kind, policy.candidate.artifactKind, 'manifest.artifact.kind');
  literal(artifact.platform, policy.candidate.platform, 'manifest.artifact.platform');
  literal(artifact.architecture, policy.candidate.architecture, 'manifest.artifact.architecture');
  string(artifact.version, 'manifest.artifact.version');
  positiveInteger(artifact.sizeBytes, 'manifest.artifact.sizeBytes');
  string(artifact.sha256, 'manifest.artifact.sha256', SHA256);

  const provenance = exactKeys(
    manifest.provenance,
    ['sourceCommit', 'buildCommand', 'builderOs', 'builderArchitecture', 'builtAt'],
    'manifest.provenance',
  );
  string(provenance.sourceCommit, 'manifest.provenance.sourceCommit', SOURCE_COMMIT);
  literal(
    provenance.buildCommand,
    'pnpm --filter @tileborne/desktop package',
    'manifest.provenance.buildCommand',
  );
  literal(provenance.builderOs, 'darwin', 'manifest.provenance.builderOs');
  literal(provenance.builderArchitecture, 'arm64', 'manifest.provenance.builderArchitecture');
  string(provenance.builtAt, 'manifest.provenance.builtAt', ISO_TIMESTAMP);

  const signing = exactKeys(
    manifest.signing,
    ['verified', 'identity', 'teamIdentifier', 'hardenedRuntime', 'verifiedTargets'],
    'manifest.signing',
  );
  boolean(signing.verified, 'manifest.signing.verified');
  const identity = string(signing.identity, 'manifest.signing.identity');
  if (!identity.startsWith('Developer ID Application:')) {
    fail('manifest.invalid-signing-identity', 'Developer ID Application identity required');
  }
  string(signing.teamIdentifier, 'manifest.signing.teamIdentifier', /^[A-Z0-9]{10}$/);
  boolean(signing.hardenedRuntime, 'manifest.signing.hardenedRuntime');
  const targets = uniqueStrings(signing.verifiedTargets, 'manifest.signing.verifiedTargets');
  if (JSON.stringify(targets) !== JSON.stringify(['application', 'installer'])) {
    fail('manifest.signing-target-drift', 'application and installer must both verify');
  }

  const notarization = exactKeys(
    manifest.notarization,
    ['verified', 'status', 'requestId', 'stapledTargets'],
    'manifest.notarization',
  );
  boolean(notarization.verified, 'manifest.notarization.verified');
  oneOf(notarization.status, ['accepted', 'rejected'], 'manifest.notarization.status');
  string(notarization.requestId, 'manifest.notarization.requestId');
  const stapledTargets = uniqueStrings(
    notarization.stapledTargets,
    'manifest.notarization.stapledTargets',
  );
  if (JSON.stringify(stapledTargets) !== JSON.stringify(['application', 'installer'])) {
    fail('manifest.stapled-target-drift', 'application and installer must both be stapled');
  }
  return manifest;
}

export function validateInstallLaunchReceipt(value, policy = loadDesktopReleasePolicy()) {
  const receipt = exactKeys(
    value,
    [
      ...RECEIPT_KEYS,
      'artifactSha256',
      'platform',
      'architecture',
      'gatekeeperAssessment',
      'mountedDmg',
      'copiedToApplications',
      'firstLaunch',
      'relaunch',
      'testedAt',
    ],
    'installReceipt',
  );
  validateReceiptHeader(receipt, policy, 'installReceipt');
  string(receipt.artifactSha256, 'installReceipt.artifactSha256', SHA256);
  literal(receipt.platform, 'darwin', 'installReceipt.platform');
  literal(receipt.architecture, 'arm64', 'installReceipt.architecture');
  oneOf(
    receipt.gatekeeperAssessment,
    ['accepted', 'rejected'],
    'installReceipt.gatekeeperAssessment',
  );
  for (const key of ['mountedDmg', 'copiedToApplications', 'firstLaunch', 'relaunch']) {
    boolean(receipt[key], `installReceipt.${key}`);
  }
  string(receipt.testedAt, 'installReceipt.testedAt', ISO_TIMESTAMP);
  return receipt;
}

export function validateRollbackReceipt(value, policy = loadDesktopReleasePolicy()) {
  const receipt = exactKeys(
    value,
    [
      ...RECEIPT_KEYS,
      'candidateArtifactSha256',
      'retainedInstaller',
      'projectBackup',
      'reinstallSucceeded',
      'projectReopenSucceeded',
      'testedAt',
    ],
    'rollbackReceipt',
  );
  validateReceiptHeader(receipt, policy, 'rollbackReceipt');
  string(receipt.candidateArtifactSha256, 'rollbackReceipt.candidateArtifactSha256', SHA256);
  const retained = exactKeys(
    receipt.retainedInstaller,
    ['version', 'sha256', 'checksumVerified', 'developerIdVerified', 'notarizationVerified'],
    'rollbackReceipt.retainedInstaller',
  );
  string(retained.version, 'rollbackReceipt.retainedInstaller.version');
  string(retained.sha256, 'rollbackReceipt.retainedInstaller.sha256', SHA256);
  for (const key of ['checksumVerified', 'developerIdVerified', 'notarizationVerified']) {
    boolean(retained[key], `rollbackReceipt.retainedInstaller.${key}`);
  }
  const backup = exactKeys(
    receipt.projectBackup,
    ['createdBeforeDowngrade', 'verified', 'projectCount'],
    'rollbackReceipt.projectBackup',
  );
  boolean(backup.createdBeforeDowngrade, 'rollbackReceipt.projectBackup.createdBeforeDowngrade');
  boolean(backup.verified, 'rollbackReceipt.projectBackup.verified');
  positiveInteger(backup.projectCount, 'rollbackReceipt.projectBackup.projectCount');
  boolean(receipt.reinstallSucceeded, 'rollbackReceipt.reinstallSucceeded');
  boolean(receipt.projectReopenSucceeded, 'rollbackReceipt.projectReopenSucceeded');
  string(receipt.testedAt, 'rollbackReceipt.testedAt', ISO_TIMESTAMP);
  return receipt;
}

function validateReceiptHeader(receipt, policy, at) {
  literal(receipt.schemaVersion, 1, `${at}.schemaVersion`);
  literal(receipt.policyId, policy.policyId, `${at}.policyId`);
}

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

export function currentSourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const addBlocker = (blockers, code, message) => blockers.push({ code, message });

/**
 * Evaluate an immutable desktop release evidence set. Validation failures are
 * converted into stable blockers so the status receipt always fails closed.
 */
export function evaluateDesktopRelease({
  artifactPath,
  retainedArtifactPath,
  manifest,
  installReceipt,
  rollbackReceipt,
  environment = process.env,
  expectedSourceCommit = currentSourceCommit(),
  requirePublication = true,
  policy = loadDesktopReleasePolicy(),
} = {}) {
  validateDesktopReleasePolicy(policy);
  const blockers = [];
  let validManifest;
  let validInstall;
  let validRollback;

  if (manifest === undefined) {
    addBlocker(blockers, 'artifact.manifest-missing', 'Desktop release manifest is required.');
  } else {
    try {
      validManifest = validateDesktopReleaseManifest(manifest, policy);
    } catch (error) {
      addBlocker(blockers, error.code ?? 'artifact.manifest-invalid', String(error.message));
    }
  }

  if (artifactPath === undefined || !existsSync(artifactPath)) {
    addBlocker(blockers, 'artifact.file-missing', 'Candidate DMG is required.');
  } else if (validManifest !== undefined) {
    const digest = sha256File(artifactPath);
    const size = statSync(artifactPath).size;
    if (digest !== validManifest.artifact.sha256) {
      addBlocker(blockers, 'artifact.sha256-mismatch', 'Candidate digest does not match manifest.');
    }
    if (size !== validManifest.artifact.sizeBytes) {
      addBlocker(blockers, 'artifact.size-mismatch', 'Candidate size does not match manifest.');
    }
    if (path.basename(artifactPath) !== validManifest.artifact.fileName) {
      addBlocker(blockers, 'artifact.name-mismatch', 'Candidate name does not match manifest.');
    }
  }

  if (
    validManifest !== undefined &&
    validManifest.provenance.sourceCommit !== expectedSourceCommit
  ) {
    addBlocker(
      blockers,
      'provenance.source-commit-mismatch',
      'Manifest source commit does not match the evaluated checkout.',
    );
  }

  if (validManifest !== undefined) {
    if (!validManifest.signing.verified) {
      addBlocker(blockers, 'signing.unverified', 'Developer ID signature receipt is not verified.');
    }
    if (!validManifest.signing.hardenedRuntime) {
      addBlocker(blockers, 'signing.hardened-runtime-missing', 'Hardened runtime is required.');
    }
    if (!validManifest.notarization.verified || validManifest.notarization.status !== 'accepted') {
      addBlocker(blockers, 'notarization.unverified', 'Apple notarization must be accepted.');
    }
  }

  if (installReceipt === undefined) {
    addBlocker(
      blockers,
      'install.receipt-missing',
      'Native Gatekeeper install/launch receipt is required.',
    );
  } else {
    try {
      validInstall = validateInstallLaunchReceipt(installReceipt, policy);
      if (validManifest && validInstall.artifactSha256 !== validManifest.artifact.sha256) {
        addBlocker(
          blockers,
          'install.artifact-mismatch',
          'Install receipt is for another artifact.',
        );
      }
      if (validInstall.gatekeeperAssessment !== 'accepted') {
        addBlocker(
          blockers,
          'install.gatekeeper-rejected',
          'Gatekeeper must accept the candidate.',
        );
      }
      for (const key of ['mountedDmg', 'copiedToApplications', 'firstLaunch', 'relaunch']) {
        if (!validInstall[key]) addBlocker(blockers, `install.${key}-unverified`, `${key} failed.`);
      }
    } catch (error) {
      addBlocker(blockers, error.code ?? 'install.receipt-invalid', String(error.message));
    }
  }

  if (rollbackReceipt === undefined) {
    addBlocker(
      blockers,
      'rollback.receipt-missing',
      'Manual retained-installer rollback receipt is required.',
    );
  } else {
    try {
      validRollback = validateRollbackReceipt(rollbackReceipt, policy);
      if (
        validManifest &&
        validRollback.candidateArtifactSha256 !== validManifest.artifact.sha256
      ) {
        addBlocker(
          blockers,
          'rollback.artifact-mismatch',
          'Rollback receipt is for another candidate.',
        );
      }
      for (const [pathName, value] of [
        ['rollback.retained-digest-unverified', validRollback.retainedInstaller.checksumVerified],
        [
          'rollback.retained-signature-unverified',
          validRollback.retainedInstaller.developerIdVerified,
        ],
        [
          'rollback.retained-notarization-unverified',
          validRollback.retainedInstaller.notarizationVerified,
        ],
        [
          'rollback.backup-not-before-downgrade',
          validRollback.projectBackup.createdBeforeDowngrade,
        ],
        ['rollback.backup-unverified', validRollback.projectBackup.verified],
        ['rollback.reinstall-unverified', validRollback.reinstallSucceeded],
        ['rollback.project-reopen-unverified', validRollback.projectReopenSucceeded],
      ]) {
        if (!value) addBlocker(blockers, pathName, 'Required rollback evidence is false.');
      }
      if (retainedArtifactPath === undefined || !existsSync(retainedArtifactPath)) {
        addBlocker(
          blockers,
          'rollback.retained-artifact-missing',
          'The last-known-good retained installer is required.',
        );
      } else if (sha256File(retainedArtifactPath) !== validRollback.retainedInstaller.sha256) {
        addBlocker(
          blockers,
          'rollback.retained-artifact-mismatch',
          'Retained installer digest does not match the rollback receipt.',
        );
      }
    } catch (error) {
      addBlocker(blockers, error.code ?? 'rollback.receipt-invalid', String(error.message));
    }
  }

  if (requirePublication) {
    if (environment[policy.publication.approvalEnvironment] !== policy.publication.approvedValue) {
      addBlocker(
        blockers,
        'publish.approval-missing',
        'Explicit desktop publication approval is absent.',
      );
    }
    if (!environment[policy.publication.credentialEnvironment]) {
      addBlocker(
        blockers,
        'publish.credential-missing',
        'Scoped publication credential is absent.',
      );
    }
  }

  const knownLimitations = policy.support
    .filter(({ status }) => status !== 'candidate')
    .map(({ id, status, reason }) => ({ id, status, reason }));
  return {
    schemaVersion: 1,
    policyId: policy.policyId,
    candidate: { ...policy.candidate },
    decision: blockers.length === 0 ? 'go' : 'no-go',
    artifactDecision:
      blockers.filter(({ code }) => !code.startsWith('publish.')).length === 0
        ? 'ready'
        : 'blocked',
    publicationDecision:
      requirePublication && blockers.some(({ code }) => code.startsWith('publish.'))
        ? 'operator-blocked'
        : requirePublication
          ? 'approved'
          : 'not-requested',
    blockers,
    knownLimitations,
  };
}

function readJson(filePath, label) {
  if (filePath === undefined) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(
      'contract.invalid-json',
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) fail('cli.invalid-argument', key ?? '<missing>');
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail('cli.missing-value', key);
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function usage() {
  console.error(
    'Usage: node scripts/desktop-release-contract.mjs <policy|status|verify> [--artifact path --retained-artifact path --manifest path --install-receipt path --rollback-receipt path --output path --expect go|no-go --skip-publication 1]',
  );
}

function main(argv) {
  const [command, ...rawArgs] = argv;
  if (command === 'policy') {
    const policy = loadDesktopReleasePolicy();
    console.log(JSON.stringify({ policyId: policy.policyId, status: 'valid' }));
    return;
  }
  if (command !== 'status' && command !== 'verify') {
    usage();
    process.exitCode = 2;
    return;
  }
  const args = parseArgs(rawArgs);
  const status = evaluateDesktopRelease({
    artifactPath: args.artifact,
    retainedArtifactPath: args['retained-artifact'],
    manifest: readJson(args.manifest, 'manifest'),
    installReceipt: readJson(args['install-receipt'], 'install receipt'),
    rollbackReceipt: readJson(args['rollback-receipt'], 'rollback receipt'),
    requirePublication: args['skip-publication'] !== '1',
  });
  const serialized = `${JSON.stringify(status, null, 2)}\n`;
  if (args.output) writeFileSync(args.output, serialized, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(serialized);
  if (args.expect && args.expect !== status.decision) {
    console.error(`Expected ${args.expect}, observed ${status.decision}`);
    process.exitCode = 1;
  }
  if (command === 'verify' && status.decision !== 'go') process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

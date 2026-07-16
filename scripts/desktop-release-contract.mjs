/* global Buffer, console, process */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
export const desktopReleasePolicyPath = path.join(repoRoot, 'scripts/desktop-release-policy.json');

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const nativeVerifierPath = path.join(repoRoot, 'scripts/macos-desktop-release-verifier.mjs');

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

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemVer(value) {
  const match = SEMVER.exec(value);
  if (!match) fail('contract.invalid-semver', value);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

export function compareSemVer(left, right) {
  const a = parseSemVer(left);
  const b = parseSemVer(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined || bPart === undefined) return aPart === undefined ? -1 : 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) < Number(bPart) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

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
      'signing',
      'lastKnownGoodReleases',
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

  const signing = exactKeys(
    policy.signing,
    ['approvedTeamIdentifierEnvironment'],
    'policy.signing',
  );
  literal(
    signing.approvedTeamIdentifierEnvironment,
    'TILEBORNE_APPLE_TEAM_ID',
    'policy.signing.approvedTeamIdentifierEnvironment',
  );

  if (!Array.isArray(policy.lastKnownGoodReleases)) {
    fail('contract.invalid-array', 'policy.lastKnownGoodReleases');
  }
  const seenLkgDigests = new Set();
  for (const [index, entry] of policy.lastKnownGoodReleases.entries()) {
    const record = exactKeys(
      entry,
      ['version', 'sourceCommit', 'sha256', 'teamIdentifier'],
      `policy.lastKnownGoodReleases[${index}]`,
    );
    parseSemVer(string(record.version, `policy.lastKnownGoodReleases[${index}].version`));
    string(
      record.sourceCommit,
      `policy.lastKnownGoodReleases[${index}].sourceCommit`,
      SOURCE_COMMIT,
    );
    const digest = string(record.sha256, `policy.lastKnownGoodReleases[${index}].sha256`, SHA256);
    string(
      record.teamIdentifier,
      `policy.lastKnownGoodReleases[${index}].teamIdentifier`,
      /^[A-Z0-9]{10}$/,
    );
    if (seenLkgDigests.has(digest)) {
      fail('contract.duplicate-value', 'policy.lastKnownGoodReleases sha256');
    }
    seenLkgDigests.add(digest);
  }

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
    ['schemaVersion', 'policyId', 'artifact', 'provenance'],
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

  return manifest;
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

export function hasUdifTrailer(filePath) {
  const bytes = readFileSync(filePath);
  return (
    bytes.length >= 512 &&
    bytes.subarray(bytes.length - 512, bytes.length - 508).equals(Buffer.from('koly'))
  );
}

export function hasZipHeader(filePath) {
  const bytes = readFileSync(filePath);
  return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

export function currentSourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const addBlocker = (blockers, code, message) => blockers.push({ code, message });

const defaultCommandRunner = ({ file, args, env }) =>
  spawnSync(file, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function validateNativeEvidence(value, expected) {
  const evidence = exactKeys(
    value,
    ['schemaVersion', 'nonce', 'candidate', 'install', 'rollback'],
    'nativeEvidence',
  );
  literal(evidence.schemaVersion, 1, 'nativeEvidence.schemaVersion');
  literal(evidence.nonce, expected.nonce, 'nativeEvidence.nonce');
  const candidate = exactKeys(
    evidence.candidate,
    [
      'candidateArtifactSha256',
      'retainedArtifactSha256',
      'format',
      'candidateArchitecture',
      'retainedArchitecture',
      'bundleId',
      'embeddedSourceCommit',
      'embeddedVersion',
      'candidateEmbeddedTeamIdentifier',
      'retainedEmbeddedSourceCommit',
      'retainedEmbeddedVersion',
      'retainedEmbeddedTeamIdentifier',
      'candidateAuthority',
      'retainedAuthority',
      'candidateTeamIdentifier',
      'retainedTeamIdentifier',
      'candidateHardenedRuntime',
      'retainedHardenedRuntime',
      'candidateStaple',
      'retainedStaple',
      'candidateGatekeeper',
      'retainedGatekeeper',
    ],
    'nativeEvidence.candidate',
  );
  literal(
    candidate.candidateArtifactSha256,
    expected.candidateSha256,
    'nativeEvidence.candidate.candidateArtifactSha256',
  );
  literal(
    candidate.retainedArtifactSha256,
    expected.retainedSha256,
    'nativeEvidence.candidate.retainedArtifactSha256',
  );
  literal(candidate.format, 'udif', 'nativeEvidence.candidate.format');
  literal(
    candidate.candidateArchitecture,
    'arm64',
    'nativeEvidence.candidate.candidateArchitecture',
  );
  literal(candidate.retainedArchitecture, 'arm64', 'nativeEvidence.candidate.retainedArchitecture');
  literal(candidate.bundleId, 'dev.tileborne.app', 'nativeEvidence.candidate.bundleId');
  literal(
    candidate.embeddedSourceCommit,
    expected.sourceCommit,
    'nativeEvidence.candidate.embeddedSourceCommit',
  );
  literal(candidate.embeddedVersion, expected.version, 'nativeEvidence.candidate.embeddedVersion');
  for (const key of [
    'candidateEmbeddedTeamIdentifier',
    'retainedEmbeddedTeamIdentifier',
    'candidateTeamIdentifier',
    'retainedTeamIdentifier',
  ]) {
    literal(candidate[key], expected.approvedTeamIdentifier, `nativeEvidence.candidate.${key}`);
  }
  string(
    candidate.retainedEmbeddedSourceCommit,
    'nativeEvidence.candidate.retainedEmbeddedSourceCommit',
    SOURCE_COMMIT,
  );
  parseSemVer(
    string(candidate.retainedEmbeddedVersion, 'nativeEvidence.candidate.retainedEmbeddedVersion'),
  );
  for (const key of ['candidateAuthority', 'retainedAuthority']) {
    const authority = string(candidate[key], `nativeEvidence.candidate.${key}`);
    if (!authority.startsWith('Developer ID Application:')) {
      fail('native.invalid-signing-authority', `${key} is not Developer ID Application`);
    }
  }
  for (const key of ['candidateHardenedRuntime', 'retainedHardenedRuntime']) {
    literal(candidate[key], 'runtime', `nativeEvidence.candidate.${key}`);
  }
  for (const key of ['candidateStaple', 'retainedStaple']) {
    literal(candidate[key], 'validated', `nativeEvidence.candidate.${key}`);
  }
  for (const key of ['candidateGatekeeper', 'retainedGatekeeper']) {
    literal(candidate[key], 'accepted', `nativeEvidence.candidate.${key}`);
  }

  const install = exactKeys(
    evidence.install,
    ['location', 'firstLaunchProjectId', 'relaunchProjectId'],
    'nativeEvidence.install',
  );
  literal(install.location, 'temporary-applications', 'nativeEvidence.install.location');
  string(install.firstLaunchProjectId, 'nativeEvidence.install.firstLaunchProjectId');
  literal(
    install.relaunchProjectId,
    install.firstLaunchProjectId,
    'nativeEvidence.install.relaunchProjectId',
  );

  const rollback = exactKeys(
    evidence.rollback,
    ['action', 'backupSha256', 'backupSizeBytes', 'reopenedProjectId'],
    'nativeEvidence.rollback',
  );
  literal(rollback.action, 'retained-installer-reinstalled', 'nativeEvidence.rollback.action');
  string(rollback.backupSha256, 'nativeEvidence.rollback.backupSha256', SHA256);
  positiveInteger(rollback.backupSizeBytes, 'nativeEvidence.rollback.backupSizeBytes');
  literal(
    rollback.reopenedProjectId,
    install.firstLaunchProjectId,
    'nativeEvidence.rollback.reopenedProjectId',
  );
  return evidence;
}

export function verifyMacOsReleaseEvidence({
  artifactPath,
  retainedArtifactPath,
  backupArtifactPath,
  candidateSha256,
  retainedSha256,
  sourceCommit,
  version,
  approvedTeamIdentifier,
  commandRunner = defaultCommandRunner,
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
}) {
  if (hostPlatform !== 'darwin' || hostArchitecture !== 'arm64') {
    fail(
      'native.unsupported-host',
      `native release verification requires darwin/arm64, observed ${hostPlatform}/${hostArchitecture}`,
    );
  }
  const nonce = randomBytes(32).toString('hex');
  const result = commandRunner({
    file: process.execPath,
    args: [
      nativeVerifierPath,
      '--candidate',
      artifactPath,
      '--retained',
      retainedArtifactPath,
      '--backup-output',
      backupArtifactPath,
      '--nonce',
      nonce,
    ],
    env: process.env,
  });
  if (result.error !== undefined || result.status !== 0) {
    const detail = String(result.stderr ?? '').trim();
    fail(
      'native.verification-failed',
      detail.length > 0 ? detail : (result.error?.message ?? `exit ${String(result.status)}`),
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout));
  } catch {
    fail('native.invalid-output', 'native verifier did not emit one JSON evidence object');
  }
  return validateNativeEvidence(parsed, {
    nonce,
    candidateSha256,
    retainedSha256,
    sourceCommit,
    version,
    approvedTeamIdentifier,
  });
}

export function verifyPublicationBoundary({ environment, commandRunner = defaultCommandRunner }) {
  const result = commandRunner({
    file: 'gh',
    args: ['auth', 'status', '--hostname', 'github.com', '--active'],
    env: environment,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail('publish.credential-unverified', 'GitHub credential is not active at operator boundary');
  }
  return 'verified';
}

/**
 * Evaluate an immutable desktop release evidence set. Validation failures are
 * converted into stable blockers so the status receipt always fails closed.
 */
export function evaluateDesktopRelease({
  artifactPath,
  retainedArtifactPath,
  backupArtifactPath,
  manifest,
  environment = process.env,
  expectedSourceCommit = currentSourceCommit(),
  requirePublication = true,
  policy = loadDesktopReleasePolicy(),
  nativeCommandRunner = defaultCommandRunner,
  publicationCommandRunner = defaultCommandRunner,
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
} = {}) {
  validateDesktopReleasePolicy(policy);
  const blockers = [];
  let validManifest;
  let candidateSha256;
  let retainedSha256;
  let nativeEvidence;
  let approvedTeamIdentifier;

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
    candidateSha256 = sha256File(artifactPath);
    const size = statSync(artifactPath).size;
    if (candidateSha256 !== validManifest.artifact.sha256) {
      addBlocker(blockers, 'artifact.sha256-mismatch', 'Candidate digest does not match manifest.');
    }
    if (size !== validManifest.artifact.sizeBytes) {
      addBlocker(blockers, 'artifact.size-mismatch', 'Candidate size does not match manifest.');
    }
    if (path.basename(artifactPath) !== validManifest.artifact.fileName) {
      addBlocker(blockers, 'artifact.name-mismatch', 'Candidate name does not match manifest.');
    }
    if (path.extname(artifactPath).toLowerCase() !== '.dmg' || !hasUdifTrailer(artifactPath)) {
      addBlocker(
        blockers,
        'artifact.format-invalid',
        'Candidate must be a real UDIF DMG before native verification.',
      );
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

  if (retainedArtifactPath === undefined || !existsSync(retainedArtifactPath)) {
    addBlocker(
      blockers,
      'rollback.retained-artifact-missing',
      'A last-known-good retained DMG is required.',
    );
  } else {
    retainedSha256 = sha256File(retainedArtifactPath);
    if (candidateSha256 !== undefined && retainedSha256 === candidateSha256) {
      addBlocker(
        blockers,
        'rollback.retained-artifact-not-prior',
        'Rollback requires a distinct last-known-good installer.',
      );
    }
    if (
      path.extname(retainedArtifactPath).toLowerCase() !== '.dmg' ||
      !hasUdifTrailer(retainedArtifactPath)
    ) {
      addBlocker(
        blockers,
        'rollback.retained-format-invalid',
        'Retained installer must be a real UDIF DMG.',
      );
    }
  }
  if (backupArtifactPath === undefined) {
    addBlocker(
      blockers,
      'rollback.backup-output-missing',
      'Native rollback verifier requires a backup archive output path.',
    );
  }

  const configuredTeamIdentifier = environment[policy.signing.approvedTeamIdentifierEnvironment];
  if (typeof configuredTeamIdentifier !== 'string' || configuredTeamIdentifier.length === 0) {
    addBlocker(
      blockers,
      'signing.approved-team-missing',
      'Explicit approved Apple TeamIdentifier is required.',
    );
  } else if (!/^[A-Z0-9]{10}$/.test(configuredTeamIdentifier)) {
    addBlocker(
      blockers,
      'signing.approved-team-invalid',
      'Approved Apple TeamIdentifier must be ten uppercase letters/digits.',
    );
  } else {
    approvedTeamIdentifier = configuredTeamIdentifier;
  }

  const preNativeBlockers = blockers.length;
  if (
    preNativeBlockers === 0 &&
    artifactPath !== undefined &&
    retainedArtifactPath !== undefined &&
    backupArtifactPath !== undefined &&
    candidateSha256 !== undefined &&
    retainedSha256 !== undefined &&
    validManifest !== undefined &&
    approvedTeamIdentifier !== undefined
  ) {
    try {
      nativeEvidence = verifyMacOsReleaseEvidence({
        artifactPath,
        retainedArtifactPath,
        backupArtifactPath,
        candidateSha256,
        retainedSha256,
        sourceCommit: validManifest.provenance.sourceCommit,
        version: validManifest.artifact.version,
        approvedTeamIdentifier,
        commandRunner: nativeCommandRunner,
        hostPlatform,
        hostArchitecture,
      });
      if (!existsSync(backupArtifactPath) || !hasZipHeader(backupArtifactPath)) {
        addBlocker(
          blockers,
          'rollback.backup-format-invalid',
          'Native verifier did not produce a ZIP project backup.',
        );
      } else {
        const backupSha256 = sha256File(backupArtifactPath);
        const backupSizeBytes = statSync(backupArtifactPath).size;
        if (
          backupSha256 !== nativeEvidence.rollback.backupSha256 ||
          backupSizeBytes !== nativeEvidence.rollback.backupSizeBytes
        ) {
          addBlocker(
            blockers,
            'rollback.backup-provenance-mismatch',
            'Backup archive does not match native rollback evidence.',
          );
        }
      }
      if (
        compareSemVer(
          nativeEvidence.candidate.retainedEmbeddedVersion,
          validManifest.artifact.version,
        ) >= 0
      ) {
        addBlocker(
          blockers,
          'rollback.lkg-version-not-earlier',
          'Retained installer must have a strictly earlier SemVer than the candidate.',
        );
      }
      const approvedLkg = policy.lastKnownGoodReleases.some(
        (entry) =>
          entry.version === nativeEvidence.candidate.retainedEmbeddedVersion &&
          entry.sourceCommit === nativeEvidence.candidate.retainedEmbeddedSourceCommit &&
          entry.sha256 === retainedSha256 &&
          entry.teamIdentifier === nativeEvidence.candidate.retainedEmbeddedTeamIdentifier,
      );
      if (!approvedLkg) {
        addBlocker(
          blockers,
          'rollback.lkg-not-approved',
          'Retained installer does not match the operator-approved LKG allowlist.',
        );
      }
    } catch (error) {
      addBlocker(blockers, error.code ?? 'native.verification-failed', String(error.message));
    }
  }

  if (!requirePublication) {
    addBlocker(
      blockers,
      'publish.not-requested',
      'Artifact verification does not authorize publication.',
    );
  } else {
    const approved =
      environment[policy.publication.approvalEnvironment] === policy.publication.approvedValue;
    if (!approved) {
      addBlocker(
        blockers,
        'publish.approval-missing',
        'Explicit desktop publication approval is absent.',
      );
    }
    const credential = environment[policy.publication.credentialEnvironment];
    if (!credential) {
      addBlocker(
        blockers,
        'publish.credential-missing',
        'Scoped publication credential is absent.',
      );
    } else if (approved) {
      try {
        verifyPublicationBoundary({
          environment,
          commandRunner: publicationCommandRunner,
        });
      } catch (error) {
        addBlocker(blockers, error.code ?? 'publish.credential-unverified', String(error.message));
      }
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
    publicationDecision: !requirePublication
      ? 'not-requested'
      : blockers.some(({ code }) => code.startsWith('publish.'))
        ? 'operator-blocked'
        : 'approved',
    blockers,
    knownLimitations,
    ...(nativeEvidence === undefined
      ? {}
      : {
          nativeEvidence: {
            candidateTeamIdentifier: nativeEvidence.candidate.candidateTeamIdentifier,
            projectId: nativeEvidence.install.firstLaunchProjectId,
            backupSha256: nativeEvidence.rollback.backupSha256,
          },
        }),
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
  const allowed = new Set([
    'artifact',
    'retained-artifact',
    'backup-output',
    'manifest',
    'output',
    'expect',
    'skip-publication',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) fail('cli.invalid-argument', key ?? '<missing>');
    if (!allowed.has(key.slice(2))) fail('cli.invalid-argument', key);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail('cli.missing-value', key);
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function usage() {
  console.error(
    'Usage: node scripts/desktop-release-contract.mjs <policy|status|verify> [--artifact path --retained-artifact path --backup-output path --manifest path --output path --expect go|no-go --skip-publication 1]',
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
    backupArtifactPath: args['backup-output'],
    manifest: readJson(args.manifest, 'manifest'),
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

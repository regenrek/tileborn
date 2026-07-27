/* global Buffer, console, process */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
export const desktopReleasePolicyPath = path.join(repoRoot, 'scripts/desktop-release-policy.json');

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const nativeVerifierPath = path.join(repoRoot, 'scripts/macos-desktop-release-verifier.mjs');

const expectedDarwinArm64ZipName = (version) => `Tileborne-darwin-arm64-${version}.zip`;
const versionFromDarwinArm64ZipName = (fileName) =>
  /^Tileborne-darwin-arm64-(.+)\.zip$/.exec(fileName)?.[1];

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

const array = (value, at) => {
  if (!Array.isArray(value)) {
    fail('contract.invalid-array', `${at} must be an array`);
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
      'owners',
      'requiredEvidence',
      'support',
      'publication',
      'operatorOnlyMutations',
      'signing',
      'credentialPresenceChecks',
    ],
    'policy',
  );
  literal(policy.schemaVersion, 1, 'policy.schemaVersion');
  literal(policy.policyId, 'tileborne-desktop-1.0', 'policy.policyId');

  const candidate = exactKeys(
    policy.candidate,
    [
      'platform',
      'architecture',
      'artifactKind',
      'updateArtifactKind',
      'updateArtifactNamePattern',
      'channel',
    ],
    'policy.candidate',
  );
  literal(candidate.platform, 'darwin', 'policy.candidate.platform');
  literal(candidate.architecture, 'arm64', 'policy.candidate.architecture');
  literal(candidate.artifactKind, 'dmg', 'policy.candidate.artifactKind');
  literal(candidate.updateArtifactKind, 'zip', 'policy.candidate.updateArtifactKind');
  literal(
    candidate.updateArtifactNamePattern,
    'Tileborne-darwin-arm64-${version}.zip',
    'policy.candidate.updateArtifactNamePattern',
  );
  literal(candidate.channel, 'github-release', 'policy.candidate.channel');

  if (!Array.isArray(policy.owners)) fail('contract.invalid-array', 'policy.owners');
  const owners = policy.owners.map((entry, index) => {
    const record = exactKeys(entry, ['id', 'owner', 'scope'], `policy.owners[${index}]`);
    return {
      id: string(record.id, `policy.owners[${index}].id`),
      owner: string(record.owner, `policy.owners[${index}].owner`),
      scope: string(record.scope, `policy.owners[${index}].scope`),
    };
  });
  if (new Set(owners.map(({ id }) => id)).size !== owners.length) {
    fail('contract.duplicate-value', 'policy.owners ids');
  }
  const expectedOwners = new Map([
    ['updater.runtime-state-machine', 'apps/desktop/src/main/updater.ts'],
    ['updater.ipc-contract', 'packages/ipc-contracts/src/contracts/desktop-updates.ts'],
    ['updater.renderer-presentation', 'apps/desktop/src/renderer'],
    ['updater.preload-bridge', 'apps/desktop/src/preload/preload.ts'],
    ['release.packaging-provenance', 'apps/desktop/scripts/desktop-release-forge.cjs'],
    ['electron.metadata-entitlements', 'apps/desktop/electron-forge.config.cjs'],
    ['project.relaunch-persistence-semantics', 'packages/services-app/src/project'],
  ]);
  for (const [id, owner] of expectedOwners) {
    if (owners.find((entry) => entry.id === id)?.owner !== owner) {
      fail('policy.owner-drift', `${id} must be owned by ${owner}`);
    }
  }
  if (owners.length !== expectedOwners.size) {
    fail('policy.owner-drift', 'owners must exactly match the approved 1.0 boundaries');
  }

  const evidence = uniqueStrings(policy.requiredEvidence, 'policy.requiredEvidence');
  const expectedEvidence = [
    'artifact-sha256',
    'source-provenance',
    'developer-id-signature',
    'apple-notarization',
    'stapled-ticket',
    'gatekeeper-install-first-launch-relaunch',
    'verified-project-relaunch-persistence',
    'verified-signed-a-to-b-update',
  ];
  if (JSON.stringify(evidence) !== JSON.stringify(expectedEvidence)) {
    fail('policy.required-evidence-drift', 'required evidence must match the 1.0 contract');
  }

  if (!Array.isArray(policy.support)) fail('contract.invalid-array', 'policy.support');
  const support = policy.support.map((entry, index) => {
    const record = exactKeys(
      entry,
      ['id', 'status', 'documentationLabel', 'reason'],
      `policy.support[${index}]`,
    );
    return {
      id: string(record.id, `policy.support[${index}].id`),
      status: oneOf(
        record.status,
        ['candidate', 'unsupported', 'operator-blocked'],
        `policy.support[${index}].status`,
      ),
      documentationLabel: string(
        record.documentationLabel,
        `policy.support[${index}].documentationLabel`,
      ),
      reason: string(record.reason, `policy.support[${index}].reason`),
    };
  });
  if (new Set(support.map(({ id }) => id)).size !== support.length) {
    fail('contract.duplicate-value', 'policy.support ids');
  }
  if (
    new Set(support.map(({ documentationLabel }) => documentationLabel)).size !== support.length
  ) {
    fail('contract.duplicate-value', 'policy.support documentation labels');
  }
  const expectedSupport = new Map([
    ['platform.macos-arm64', 'candidate'],
    ['platform.macos-x64', 'unsupported'],
    ['platform.windows', 'unsupported'],
    ['platform.linux', 'unsupported'],
    ['capability.auto-update', 'candidate'],
    ['capability.remote-crash-reporting', 'unsupported'],
    ['capability.publish', 'operator-blocked'],
    ['channel.mac-app-store', 'unsupported'],
    ['channel.npm', 'unsupported'],
    ['channel.homebrew', 'unsupported'],
    ['channel.cloudflare-deploy', 'unsupported'],
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

  if (!Array.isArray(policy.operatorOnlyMutations)) {
    fail('contract.invalid-array', 'policy.operatorOnlyMutations');
  }
  const operatorOnlyMutations = policy.operatorOnlyMutations.map((entry, index) => {
    const record = exactKeys(
      entry,
      ['id', 'status', 'documentationLabel', 'reason'],
      `policy.operatorOnlyMutations[${index}]`,
    );
    return {
      id: string(record.id, `policy.operatorOnlyMutations[${index}].id`),
      status: oneOf(
        record.status,
        ['operator-blocked'],
        `policy.operatorOnlyMutations[${index}].status`,
      ),
      documentationLabel: string(
        record.documentationLabel,
        `policy.operatorOnlyMutations[${index}].documentationLabel`,
      ),
      reason: string(record.reason, `policy.operatorOnlyMutations[${index}].reason`),
    };
  });
  if (new Set(operatorOnlyMutations.map(({ id }) => id)).size !== operatorOnlyMutations.length) {
    fail('contract.duplicate-value', 'policy.operatorOnlyMutations ids');
  }
  const expectedOperatorOnlyMutations = new Set([
    'operation.git-tag-create',
    'operation.git-tag-push',
    'operation.github-release-create',
    'operation.github-release-upload',
  ]);
  for (const id of expectedOperatorOnlyMutations) {
    if (operatorOnlyMutations.find((entry) => entry.id === id)?.status !== 'operator-blocked') {
      fail('policy.operator-mutation-drift', `${id} must be explicitly operator-blocked`);
    }
  }
  if (operatorOnlyMutations.length !== expectedOperatorOnlyMutations.size) {
    fail(
      'policy.operator-mutation-drift',
      'operator-only mutations must exactly match the approved 1.0 boundary',
    );
  }

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

  if (!Array.isArray(policy.credentialPresenceChecks)) {
    fail('contract.invalid-array', 'policy.credentialPresenceChecks');
  }
  const credentialPresenceChecks = policy.credentialPresenceChecks.map((entry, index) => {
    const record = exactKeys(
      entry,
      ['name', 'owner', 'check'],
      `policy.credentialPresenceChecks[${index}]`,
    );
    return {
      name: string(record.name, `policy.credentialPresenceChecks[${index}].name`),
      owner: string(record.owner, `policy.credentialPresenceChecks[${index}].owner`),
      check: string(record.check, `policy.credentialPresenceChecks[${index}].check`),
    };
  });
  if (
    new Set(credentialPresenceChecks.map(({ name }) => name)).size !==
    credentialPresenceChecks.length
  ) {
    fail('contract.duplicate-value', 'policy.credentialPresenceChecks names');
  }
  const expectedCredentialPresenceChecks = new Map([
    ['TILEBORNE_APPLE_SIGNING_IDENTITY', 'apps/desktop/scripts/desktop-release-forge.cjs'],
    ['TILEBORNE_APPLE_TEAM_ID', 'scripts/desktop-release-contract.mjs'],
    ['TILEBORNE_APPLE_API_KEY_PATH', 'apps/desktop/scripts/desktop-release-forge.cjs'],
    ['TILEBORNE_APPLE_API_KEY_ID', 'apps/desktop/scripts/desktop-release-forge.cjs'],
    ['TILEBORNE_APPLE_API_ISSUER', 'apps/desktop/scripts/desktop-release-forge.cjs'],
    ['TILEBORNE_DESKTOP_PUBLISH_APPROVED', 'scripts/desktop-release-contract.mjs'],
    ['GH_TOKEN', 'scripts/desktop-release-contract.mjs'],
  ]);
  for (const [name, owner] of expectedCredentialPresenceChecks) {
    if (credentialPresenceChecks.find((entry) => entry.name === name)?.owner !== owner) {
      fail('policy.credential-check-drift', `${name} must be checked by ${owner}`);
    }
  }
  if (credentialPresenceChecks.length !== expectedCredentialPresenceChecks.size) {
    fail(
      'policy.credential-check-drift',
      'credential presence checks must exactly match the approved 1.0 boundary',
    );
  }

  return policy;
}

export function validateDesktopReleaseManifest(value, policy = loadDesktopReleasePolicy()) {
  const manifest = exactKeys(
    value,
    [
      'schemaVersion',
      'policyId',
      'artifact',
      'updateArtifact',
      'provenance',
      'runner',
      'signing',
      'notarization',
      'verification',
    ],
    'manifest',
  );
  validateReceiptHeader(manifest, policy, 'manifest');
  const artifact = exactKeys(
    manifest.artifact,
    ['fileName', 'kind', 'platform', 'architecture', 'bundleId', 'version', 'sizeBytes', 'sha256'],
    'manifest.artifact',
  );
  const fileName = string(artifact.fileName, 'manifest.artifact.fileName');
  if (path.basename(fileName) !== fileName) fail('manifest.invalid-file-name', fileName);
  literal(artifact.kind, policy.candidate.artifactKind, 'manifest.artifact.kind');
  literal(artifact.platform, policy.candidate.platform, 'manifest.artifact.platform');
  literal(artifact.architecture, policy.candidate.architecture, 'manifest.artifact.architecture');
  literal(artifact.bundleId, 'dev.tileborne.app', 'manifest.artifact.bundleId');
  string(artifact.version, 'manifest.artifact.version');
  positiveInteger(artifact.sizeBytes, 'manifest.artifact.sizeBytes');
  string(artifact.sha256, 'manifest.artifact.sha256', SHA256);

  const updateArtifact = exactKeys(
    manifest.updateArtifact,
    ['fileName', 'kind', 'platform', 'architecture', 'bundleId', 'version', 'sizeBytes', 'sha256'],
    'manifest.updateArtifact',
  );
  const updateFileName = string(updateArtifact.fileName, 'manifest.updateArtifact.fileName');
  if (path.basename(updateFileName) !== updateFileName) {
    fail('manifest.invalid-update-file-name', updateFileName);
  }
  literal(updateArtifact.kind, policy.candidate.updateArtifactKind, 'manifest.updateArtifact.kind');
  literal(updateArtifact.platform, policy.candidate.platform, 'manifest.updateArtifact.platform');
  literal(
    updateArtifact.architecture,
    policy.candidate.architecture,
    'manifest.updateArtifact.architecture',
  );
  literal(updateArtifact.bundleId, artifact.bundleId, 'manifest.updateArtifact.bundleId');
  string(updateArtifact.version, 'manifest.updateArtifact.version');
  positiveInteger(updateArtifact.sizeBytes, 'manifest.updateArtifact.sizeBytes');
  string(updateArtifact.sha256, 'manifest.updateArtifact.sha256', SHA256);
  literal(
    updateFileName,
    expectedDarwinArm64ZipName(updateArtifact.version),
    'manifest.updateArtifact.fileName',
  );

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

  const runner = exactKeys(manifest.runner, ['id', 'os', 'architecture'], 'manifest.runner');
  string(runner.id, 'manifest.runner.id');
  literal(runner.os, 'darwin', 'manifest.runner.os');
  literal(runner.architecture, 'arm64', 'manifest.runner.architecture');

  const signing = exactKeys(
    manifest.signing,
    ['authority', 'teamIdentifier', 'hardenedRuntime'],
    'manifest.signing',
  );
  const authority = string(signing.authority, 'manifest.signing.authority');
  if (!authority.startsWith('Developer ID Application:')) {
    fail('manifest.invalid-signing-authority', 'Developer ID Application authority required');
  }
  string(signing.teamIdentifier, 'manifest.signing.teamIdentifier', /^[A-Z0-9]{10}$/);
  oneOf(signing.hardenedRuntime, ['runtime', 'disabled'], 'manifest.signing.hardenedRuntime');

  const notarization = exactKeys(
    manifest.notarization,
    ['method', 'credentialReference', 'staple'],
    'manifest.notarization',
  );
  literal(notarization.method, 'app-store-connect-api-key', 'manifest.notarization.method');
  literal(
    notarization.credentialReference,
    'TILEBORNE_APPLE_API_KEY_PATH',
    'manifest.notarization.credentialReference',
  );
  oneOf(notarization.staple, ['validated', 'missing'], 'manifest.notarization.staple');

  const verification = exactKeys(
    manifest.verification,
    ['checksum', 'codesign', 'notarization', 'stapler', 'gatekeeper'],
    'manifest.verification',
  );
  const checksum = exactKeys(
    verification.checksum,
    ['algorithm', 'value'],
    'manifest.verification.checksum',
  );
  literal(checksum.algorithm, 'sha256', 'manifest.verification.checksum.algorithm');
  const checksumValue = string(checksum.value, 'manifest.verification.checksum.value', SHA256);
  if (checksumValue !== artifact.sha256) {
    fail('manifest.verification-checksum-mismatch', 'checksum evidence must match artifact sha256');
  }
  const codesign = exactKeys(
    verification.codesign,
    ['commandId', 'status'],
    'manifest.verification.codesign',
  );
  string(codesign.commandId, 'manifest.verification.codesign.commandId');
  oneOf(codesign.status, ['pending', 'valid', 'invalid'], 'manifest.verification.codesign.status');
  const notaryEvidence = exactKeys(
    verification.notarization,
    ['commandId', 'status'],
    'manifest.verification.notarization',
  );
  string(notaryEvidence.commandId, 'manifest.verification.notarization.commandId');
  oneOf(
    notaryEvidence.status,
    ['pending', 'available', 'missing'],
    'manifest.verification.notarization.status',
  );
  const stapler = exactKeys(
    verification.stapler,
    ['commandId', 'status'],
    'manifest.verification.stapler',
  );
  string(stapler.commandId, 'manifest.verification.stapler.commandId');
  oneOf(stapler.status, ['pending', 'valid', 'invalid'], 'manifest.verification.stapler.status');
  const gatekeeper = exactKeys(
    verification.gatekeeper,
    ['commandId', 'status'],
    'manifest.verification.gatekeeper',
  );
  string(gatekeeper.commandId, 'manifest.verification.gatekeeper.commandId');
  oneOf(
    gatekeeper.status,
    ['pending', 'accepted', 'rejected'],
    'manifest.verification.gatekeeper.status',
  );

  return manifest;
}

const pendingVerification = (artifactSha256) => ({
  checksum: { algorithm: 'sha256', value: artifactSha256 },
  codesign: { commandId: 'manifest-generation', status: 'pending' },
  notarization: { commandId: 'manifest-generation', status: 'pending' },
  stapler: { commandId: 'manifest-generation', status: 'pending' },
  gatekeeper: { commandId: 'manifest-generation', status: 'pending' },
});

export function generateDesktopReleaseManifest({
  artifactPath,
  updateArtifactPath,
  version,
  updateVersion,
  sourceCommit,
  builtAt,
  runnerId,
  signingAuthority,
  teamIdentifier,
  verification,
  policy = loadDesktopReleasePolicy(),
}) {
  if (typeof artifactPath !== 'string' || artifactPath.length === 0) {
    fail('manifest.artifact-missing', 'artifact path is required');
  }
  if (!existsSync(artifactPath)) {
    fail('manifest.artifact-missing', 'artifact path does not exist');
  }
  if (typeof updateArtifactPath !== 'string' || updateArtifactPath.length === 0) {
    fail('manifest.update-artifact-missing', 'update artifact path is required');
  }
  if (!existsSync(updateArtifactPath)) {
    fail('manifest.update-artifact-missing', 'update artifact path does not exist');
  }
  const artifactVersion = string(version, 'manifest.input.version');
  const updateArtifactVersion = string(
    updateVersion ?? versionFromDarwinArm64ZipName(path.basename(updateArtifactPath)),
    'manifest.input.updateVersion',
  );
  const artifactSha256 = sha256File(artifactPath);
  const updateArtifactSha256 = sha256File(updateArtifactPath);
  const manifest = {
    schemaVersion: 1,
    policyId: policy.policyId,
    artifact: {
      fileName: path.basename(artifactPath),
      kind: policy.candidate.artifactKind,
      platform: policy.candidate.platform,
      architecture: policy.candidate.architecture,
      bundleId: 'dev.tileborne.app',
      version: artifactVersion,
      sizeBytes: statSync(artifactPath).size,
      sha256: artifactSha256,
    },
    updateArtifact: {
      fileName: path.basename(updateArtifactPath),
      kind: policy.candidate.updateArtifactKind,
      platform: policy.candidate.platform,
      architecture: policy.candidate.architecture,
      bundleId: 'dev.tileborne.app',
      version: updateArtifactVersion,
      sizeBytes: statSync(updateArtifactPath).size,
      sha256: updateArtifactSha256,
    },
    provenance: {
      sourceCommit: string(sourceCommit, 'manifest.input.sourceCommit', SOURCE_COMMIT),
      buildCommand: 'pnpm --filter @tileborne/desktop package',
      builderOs: 'darwin',
      builderArchitecture: 'arm64',
      builtAt: string(builtAt, 'manifest.input.builtAt', ISO_TIMESTAMP),
    },
    runner: {
      id: string(runnerId, 'manifest.input.runnerId'),
      os: 'darwin',
      architecture: 'arm64',
    },
    signing: {
      authority: string(signingAuthority, 'manifest.input.signingAuthority'),
      teamIdentifier: string(teamIdentifier, 'manifest.input.teamIdentifier', /^[A-Z0-9]{10}$/),
      hardenedRuntime: 'runtime',
    },
    notarization: {
      method: 'app-store-connect-api-key',
      credentialReference: 'TILEBORNE_APPLE_API_KEY_PATH',
      staple: 'validated',
    },
    verification: verification ?? pendingVerification(artifactSha256),
  };
  return validateDesktopReleaseManifest(manifest, policy);
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
  const validateProjectEvidence = (project, at) => {
    const entry = exactKeys(
      project,
      ['found', 'id', 'name', 'engineVersion', 'plugins', 'assetPacks', 'maps', 'starterMap'],
      at,
    );
    literal(entry.found, true, `${at}.found`);
    string(entry.id, `${at}.id`);
    literal(entry.name, 'Desktop Release Oracle Persistence Payload', `${at}.name`);
    string(entry.engineVersion, `${at}.engineVersion`);
    const plugins = array(entry.plugins, `${at}.plugins`);
    if (plugins.length < 1) fail('native.project-plugin-missing', `${at}.plugins`);
    for (const [index, plugin] of plugins.entries()) {
      const pluginEntry = exactKeys(plugin, ['id', 'version'], `${at}.plugins[${index}]`);
      string(pluginEntry.id, `${at}.plugins[${index}].id`);
      string(pluginEntry.version, `${at}.plugins[${index}].version`);
    }
    const assetPacks = array(entry.assetPacks, `${at}.assetPacks`);
    if (assetPacks.length < 1) fail('native.project-asset-pack-missing', `${at}.assetPacks`);
    for (const [index, pack] of assetPacks.entries()) {
      const packEntry = exactKeys(pack, ['id', 'version'], `${at}.assetPacks[${index}]`);
      string(packEntry.id, `${at}.assetPacks[${index}].id`);
      string(packEntry.version, `${at}.assetPacks[${index}].version`);
    }
    const maps = array(entry.maps, `${at}.maps`);
    if (maps.length < 1) fail('native.project-map-missing', `${at}.maps`);
    for (const [index, map] of maps.entries()) {
      const mapEntry = exactKeys(map, ['id', 'path'], `${at}.maps[${index}]`);
      string(mapEntry.id, `${at}.maps[${index}].id`);
      string(mapEntry.path, `${at}.maps[${index}].path`);
    }
    const starterMap = exactKeys(
      entry.starterMap,
      ['id', 'width', 'height', 'tileWidth', 'tileHeight', 'layers', 'objects', 'properties'],
      `${at}.starterMap`,
    );
    string(starterMap.id, `${at}.starterMap.id`);
    for (const key of ['width', 'height', 'tileWidth', 'tileHeight']) {
      positiveInteger(starterMap[key], `${at}.starterMap.${key}`);
    }
    const layers = array(starterMap.layers, `${at}.starterMap.layers`);
    if (layers.length < 1) fail('native.project-layer-missing', `${at}.starterMap.layers`);
    const objects = array(starterMap.objects, `${at}.starterMap.objects`);
    if (objects.length < 1) fail('native.project-object-missing', `${at}.starterMap.objects`);
    object(starterMap.properties, `${at}.starterMap.properties`);
    return entry;
  };

  const evidence = exactKeys(
    value,
    ['schemaVersion', 'nonce', 'candidate', 'install', 'update'],
    'nativeEvidence',
  );
  literal(evidence.schemaVersion, 1, 'nativeEvidence.schemaVersion');
  literal(evidence.nonce, expected.nonce, 'nativeEvidence.nonce');
  const candidate = exactKeys(
    evidence.candidate,
    [
      'candidateArtifactSha256',
      'format',
      'candidateArchitecture',
      'bundleId',
      'embeddedSourceCommit',
      'embeddedVersion',
      'candidateEmbeddedTeamIdentifier',
      'candidateAuthority',
      'candidateTeamIdentifier',
      'candidateHardenedRuntime',
      'candidateStaple',
      'candidateGatekeeper',
    ],
    'nativeEvidence.candidate',
  );
  literal(
    candidate.candidateArtifactSha256,
    expected.candidateSha256,
    'nativeEvidence.candidate.candidateArtifactSha256',
  );
  literal(candidate.format, expected.format, 'nativeEvidence.candidate.format');
  literal(
    candidate.candidateArchitecture,
    'arm64',
    'nativeEvidence.candidate.candidateArchitecture',
  );
  literal(candidate.bundleId, 'dev.tileborne.app', 'nativeEvidence.candidate.bundleId');
  literal(
    candidate.embeddedSourceCommit,
    expected.sourceCommit,
    'nativeEvidence.candidate.embeddedSourceCommit',
  );
  literal(candidate.embeddedVersion, expected.version, 'nativeEvidence.candidate.embeddedVersion');
  for (const key of ['candidateEmbeddedTeamIdentifier', 'candidateTeamIdentifier']) {
    literal(candidate[key], expected.approvedTeamIdentifier, `nativeEvidence.candidate.${key}`);
  }
  const authority = string(
    candidate.candidateAuthority,
    'nativeEvidence.candidate.candidateAuthority',
  );
  if (!authority.startsWith('Developer ID Application:')) {
    fail('native.invalid-signing-authority', 'candidateAuthority is not Developer ID Application');
  }
  literal(
    candidate.candidateHardenedRuntime,
    'runtime',
    'nativeEvidence.candidate.candidateHardenedRuntime',
  );
  literal(candidate.candidateStaple, 'validated', 'nativeEvidence.candidate.candidateStaple');
  literal(
    candidate.candidateGatekeeper,
    'accepted',
    'nativeEvidence.candidate.candidateGatekeeper',
  );

  const installRecord = object(evidence.install, 'nativeEvidence.install');
  const allowedInstallKeys = new Set([
    'location',
    'firstLaunchProject',
    'sourceVersion',
    'targetVersion',
    'loopbackFeedUrl',
    'feedMetadataRequests',
    'feedArtifactRequests',
    'relaunchProject',
    'failureMatrix',
  ]);
  const missingInstallKeys = [
    'location',
    'firstLaunchProject',
    'sourceVersion',
    'targetVersion',
    'loopbackFeedUrl',
    'feedMetadataRequests',
    'feedArtifactRequests',
    'relaunchProject',
  ].filter((key) => !(key in installRecord));
  const extraInstallKeys = Object.keys(installRecord).filter((key) => !allowedInstallKeys.has(key));
  if (missingInstallKeys.length > 0) {
    fail('contract.missing-field', `nativeEvidence.install: ${missingInstallKeys.join(', ')}`);
  }
  if (extraInstallKeys.length > 0) {
    fail('contract.unknown-field', `nativeEvidence.install: ${extraInstallKeys.join(', ')}`);
  }
  const install = installRecord;
  const requiredFailureModes = [
    'stale-version',
    'same-version',
    'wrong-architecture',
    'wrong-bundle',
    'wrong-team',
    'malformed-metadata',
    'unavailable-feed',
    'interrupted-download',
  ];
  const expectedFailureOutcomes = new Map([
    ['stale-version', { state: 'error', code: 'non-newer-version', artifactRequests: 1 }],
    ['same-version', { state: 'error', code: 'non-newer-version', artifactRequests: 1 }],
    ['wrong-architecture', { state: 'error', code: 'policy-mismatch', artifactRequests: 1 }],
    ['wrong-bundle', { state: 'error', code: 'updater-error', artifactRequests: 1 }],
    ['wrong-team', { state: 'error', code: 'signature-failed', artifactRequests: 1 }],
    ['malformed-metadata', { state: 'error', code: 'updater-error', artifactRequests: 0 }],
    ['unavailable-feed', { state: 'error', code: 'feed-unavailable', artifactRequests: 0 }],
    ['interrupted-download', { state: 'error', code: 'feed-unavailable', artifactRequests: 1 }],
  ]);
  if (!Array.isArray(install.failureMatrix)) {
    fail('native.failure-matrix-missing', 'Native verifier must prove rejected update fixtures.');
  }
  if (install.failureMatrix.length !== requiredFailureModes.length) {
    fail('native.failure-matrix-incomplete', 'Native failure matrix must cover every mode once.');
  }
  const firstLaunchProject = validateProjectEvidence(
    install.firstLaunchProject,
    'nativeEvidence.install.firstLaunchProject',
  );
  const observedFailureModes = new Set();
  for (const [index, result] of install.failureMatrix.entries()) {
    const entry = exactKeys(
      result,
      [
        'mode',
        'rejectionState',
        'diagnosticCode',
        'fixtureIdentity',
        'feedMetadataRequests',
        'feedArtifactRequests',
        'projectAfterRejection',
      ],
      `nativeEvidence.install.failureMatrix[${index}]`,
    );
    const mode = string(entry.mode, `nativeEvidence.install.failureMatrix[${index}].mode`);
    if (!requiredFailureModes.includes(mode)) {
      fail('native.failure-matrix-unknown-mode', mode);
    }
    if (observedFailureModes.has(mode)) {
      fail('native.failure-matrix-duplicate-mode', mode);
    }
    observedFailureModes.add(mode);
    const expectedOutcome = expectedFailureOutcomes.get(mode);
    literal(
      entry.rejectionState,
      expectedOutcome.state,
      `nativeEvidence.install.failureMatrix[${index}].rejectionState`,
    );
    literal(
      entry.diagnosticCode,
      expectedOutcome.code,
      `nativeEvidence.install.failureMatrix[${index}].diagnosticCode`,
    );
    const identity = exactKeys(
      entry.fixtureIdentity,
      [
        'expectedArchitecture',
        'observedArchitecture',
        'expectedBundleId',
        'observedBundleId',
        'expectedTeamIdentifier',
        'observedTeamIdentifier',
      ],
      `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity`,
    );
    literal(
      identity.expectedArchitecture,
      'arm64',
      `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.expectedArchitecture`,
    );
    literal(
      identity.expectedBundleId,
      'dev.tileborne.app',
      `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.expectedBundleId`,
    );
    string(
      identity.expectedTeamIdentifier,
      `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.expectedTeamIdentifier`,
    );
    if (mode === 'wrong-architecture') {
      literal(
        identity.observedArchitecture,
        'x86_64',
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedArchitecture`,
      );
    } else {
      literal(
        identity.observedArchitecture,
        'arm64',
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedArchitecture`,
      );
    }
    if (mode === 'wrong-bundle') {
      literal(
        identity.observedBundleId,
        'dev.tileborne.other',
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedBundleId`,
      );
    } else {
      literal(
        identity.observedBundleId,
        'dev.tileborne.app',
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedBundleId`,
      );
    }
    if (mode === 'wrong-team') {
      literal(
        identity.observedTeamIdentifier,
        'ad-hoc',
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedTeamIdentifier`,
      );
    } else if (mode === 'wrong-architecture') {
      literal(
        identity.observedTeamIdentifier,
        expected.approvedTeamIdentifier,
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedTeamIdentifier`,
      );
    } else {
      string(
        identity.observedTeamIdentifier,
        `nativeEvidence.install.failureMatrix[${index}].fixtureIdentity.observedTeamIdentifier`,
      );
    }
    if (expectedOutcome.artifactRequests > 0) {
      positiveInteger(
        entry.feedArtifactRequests,
        `nativeEvidence.install.failureMatrix[${index}].feedArtifactRequests`,
      );
    } else {
      literal(
        entry.feedArtifactRequests,
        0,
        `nativeEvidence.install.failureMatrix[${index}].feedArtifactRequests`,
      );
    }
    if (!Number.isSafeInteger(entry.feedMetadataRequests) || entry.feedMetadataRequests < 0) {
      fail(
        'contract.invalid-integer',
        `nativeEvidence.install.failureMatrix[${index}].feedMetadataRequests must be a non-negative safe integer`,
      );
    }
    if (mode !== 'unavailable-feed') {
      positiveInteger(
        entry.feedMetadataRequests,
        `nativeEvidence.install.failureMatrix[${index}].feedMetadataRequests`,
      );
    } else {
      literal(
        entry.feedMetadataRequests,
        0,
        `nativeEvidence.install.failureMatrix[${index}].feedMetadataRequests`,
      );
    }
    literal(
      validateProjectEvidence(
        entry.projectAfterRejection,
        `nativeEvidence.install.failureMatrix[${index}].projectAfterRejection`,
      ).id,
      firstLaunchProject.id,
      `nativeEvidence.install.failureMatrix[${index}].projectAfterRejection.id`,
    );
    literal(
      JSON.stringify(entry.projectAfterRejection),
      JSON.stringify(firstLaunchProject),
      `nativeEvidence.install.failureMatrix[${index}].projectAfterRejection`,
    );
  }
  for (const mode of requiredFailureModes) {
    if (!observedFailureModes.has(mode)) {
      fail('native.failure-matrix-missing-mode', mode);
    }
  }
  literal(install.location, 'temporary-applications', 'nativeEvidence.install.location');
  literal(install.sourceVersion, expected.version, 'nativeEvidence.install.sourceVersion');
  literal(install.targetVersion, expected.updateVersion, 'nativeEvidence.install.targetVersion');
  const loopbackFeedUrl = string(install.loopbackFeedUrl, 'nativeEvidence.install.loopbackFeedUrl');
  if (!/^http:\/\/127\.0\.0\.1:\d+\/feed$/.test(loopbackFeedUrl)) {
    fail('native.invalid-loopback-feed', 'native verifier must use an ephemeral loopback feed');
  }
  positiveInteger(install.feedMetadataRequests, 'nativeEvidence.install.feedMetadataRequests');
  positiveInteger(install.feedArtifactRequests, 'nativeEvidence.install.feedArtifactRequests');
  literal(
    validateProjectEvidence(install.relaunchProject, 'nativeEvidence.install.relaunchProject').id,
    firstLaunchProject.id,
    'nativeEvidence.install.relaunchProject.id',
  );
  literal(
    JSON.stringify(install.relaunchProject),
    JSON.stringify(firstLaunchProject),
    'nativeEvidence.install.relaunchProject',
  );

  const update = exactKeys(
    evidence.update,
    [
      'updateArtifactSha256',
      'format',
      'updateArchitecture',
      'bundleId',
      'embeddedSourceCommit',
      'embeddedVersion',
      'updateEmbeddedTeamIdentifier',
      'updateAuthority',
      'updateTeamIdentifier',
      'updateHardenedRuntime',
      'updateStaple',
      'updateGatekeeper',
    ],
    'nativeEvidence.update',
  );
  literal(
    update.updateArtifactSha256,
    expected.updateSha256,
    'nativeEvidence.update.updateArtifactSha256',
  );
  literal(update.format, 'zip', 'nativeEvidence.update.format');
  literal(update.updateArchitecture, 'arm64', 'nativeEvidence.update.updateArchitecture');
  literal(update.bundleId, 'dev.tileborne.app', 'nativeEvidence.update.bundleId');
  literal(
    update.embeddedSourceCommit,
    expected.sourceCommit,
    'nativeEvidence.update.embeddedSourceCommit',
  );
  literal(update.embeddedVersion, expected.updateVersion, 'nativeEvidence.update.embeddedVersion');
  for (const key of ['updateEmbeddedTeamIdentifier', 'updateTeamIdentifier']) {
    literal(update[key], expected.approvedTeamIdentifier, `nativeEvidence.update.${key}`);
  }
  const updateAuthority = string(update.updateAuthority, 'nativeEvidence.update.updateAuthority');
  if (!updateAuthority.startsWith('Developer ID Application:')) {
    fail(
      'native.invalid-update-signing-authority',
      'updateAuthority is not Developer ID Application',
    );
  }
  literal(update.updateHardenedRuntime, 'runtime', 'nativeEvidence.update.updateHardenedRuntime');
  literal(update.updateStaple, 'validated', 'nativeEvidence.update.updateStaple');
  literal(update.updateGatekeeper, 'accepted', 'nativeEvidence.update.updateGatekeeper');
  return evidence;
}

export function verifyMacOsReleaseEvidence({
  artifactPath,
  updateArtifactPath,
  candidateSha256,
  updateCandidateSha256,
  sourceCommit,
  version,
  updateVersion,
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
      '--update-artifact',
      updateArtifactPath,
      '--nonce',
      nonce,
      '--failure-matrix',
      '1',
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
    format: 'udif',
    sourceCommit,
    version,
    updateVersion,
    updateSha256: updateCandidateSha256,
    approvedTeamIdentifier,
  });
}

const commandOutput = ({ file, args, commandRunner, env = process.env, errorCode }) => {
  const result = commandRunner({ file, args, env });
  if (result.error !== undefined || result.status !== 0) {
    const detail = String(result.stderr ?? '').trim();
    fail(
      errorCode,
      detail.length > 0 ? detail : (result.error?.message ?? `exit ${String(result.status)}`),
    );
  }
  const stdout = String(result.stdout ?? '').trim();
  return stdout.length > 0 ? stdout : String(result.stderr ?? '').trim();
};

const findAppBundles = (root) => {
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
  visit(root);
  return apps;
};

function verifyMacOsUpdateArtifactEvidence({
  updateArtifactPath,
  updateCandidateSha256,
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
  const extractionRoot = mkdtempSync(path.join(os.tmpdir(), 'tileborne-update-zip-'));
  try {
    commandOutput({
      file: '/usr/bin/ditto',
      args: ['-x', '-k', updateArtifactPath, extractionRoot],
      commandRunner,
      errorCode: 'artifact.update-format-invalid',
    });
    const apps = findAppBundles(extractionRoot);
    if (apps.length !== 1) {
      fail(
        'artifact.update-app-count-invalid',
        `Candidate update ZIP must contain exactly one app bundle, found ${apps.length}`,
      );
    }
    const appPath = apps[0];
    const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
    const bundleId = commandOutput({
      file: '/usr/bin/plutil',
      args: ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist],
      commandRunner,
      errorCode: 'artifact.update-metadata-invalid',
    });
    const bundleVersion = commandOutput({
      file: '/usr/bin/plutil',
      args: ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist],
      commandRunner,
      errorCode: 'artifact.update-metadata-invalid',
    });
    const executableName = commandOutput({
      file: '/usr/bin/plutil',
      args: ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', infoPlist],
      commandRunner,
      errorCode: 'artifact.update-metadata-invalid',
    });
    const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName);
    const architectures = commandOutput({
      file: '/usr/bin/lipo',
      args: ['-archs', executablePath],
      commandRunner,
      errorCode: 'artifact.update-architecture-invalid',
    })
      .split(/\s+/)
      .filter(Boolean);
    if (architectures.length !== 1 || architectures[0] !== 'arm64') {
      fail('artifact.update-architecture-invalid', architectures.join(','));
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
      fail('artifact.update-provenance-invalid', provenancePath);
    }
    const provenance = exactKeys(
      releaseProvenance,
      ['schemaVersion', 'policyId', 'sourceCommit', 'version', 'teamIdentifier', 'buildCommand'],
      'artifact.update.provenance',
    );
    literal(provenance.schemaVersion, 1, 'artifact.update.provenance.schemaVersion');
    literal(provenance.policyId, 'tileborne-desktop-1.0', 'artifact.update.provenance.policyId');
    literal(provenance.sourceCommit, sourceCommit, 'artifact.update.provenance.sourceCommit');
    literal(provenance.version, version, 'artifact.update.provenance.version');
    literal(
      provenance.teamIdentifier,
      approvedTeamIdentifier,
      'artifact.update.provenance.teamIdentifier',
    );
    literal(
      provenance.buildCommand,
      'pnpm --filter @tileborne/desktop package',
      'artifact.update.provenance.buildCommand',
    );
    literal(bundleId, 'dev.tileborne.app', 'artifact.update.bundleId');
    literal(bundleVersion, version, 'artifact.update.version');

    const display = commandOutput({
      file: '/usr/bin/codesign',
      args: ['-dv', '--verbose=4', appPath],
      commandRunner,
      errorCode: 'artifact.update-signature-invalid',
    });
    commandOutput({
      file: '/usr/bin/codesign',
      args: ['--verify', '--deep', '--strict', '--verbose=4', appPath],
      commandRunner,
      errorCode: 'artifact.update-signature-invalid',
    });
    commandOutput({
      file: '/usr/bin/xcrun',
      args: ['stapler', 'validate', appPath],
      commandRunner,
      errorCode: 'artifact.update-notarization-invalid',
    });
    commandOutput({
      file: '/usr/sbin/spctl',
      args: ['--assess', '--type', 'execute', '--verbose=4', appPath],
      commandRunner,
      errorCode: 'artifact.update-gatekeeper-invalid',
    });
    const authority = /^Authority=(Developer ID Application:[^\n]+)$/m.exec(display)?.[1];
    const teamIdentifier = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(display)?.[1];
    const flags = /^CodeDirectory .+ flags=.+\(([^)]+)\)/m.exec(display)?.[1] ?? '';
    if (typeof authority !== 'string' || typeof teamIdentifier !== 'string') {
      fail('artifact.update-signature-invalid', 'Developer ID Application signature is required');
    }
    literal(teamIdentifier, approvedTeamIdentifier, 'artifact.update.teamIdentifier');
    if (!flags.split(',').includes('runtime')) {
      fail('artifact.update-hardened-runtime-invalid', 'hardened runtime is required');
    }
    return {
      candidateArtifactSha256: updateCandidateSha256,
      format: 'zip',
      candidateArchitecture: 'arm64',
      bundleId,
      embeddedSourceCommit: provenance.sourceCommit,
      embeddedVersion: provenance.version,
      candidateEmbeddedTeamIdentifier: provenance.teamIdentifier,
      candidateAuthority: authority,
      candidateTeamIdentifier: teamIdentifier,
      candidateHardenedRuntime: 'runtime',
      candidateStaple: 'validated',
      candidateGatekeeper: 'accepted',
    };
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
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
  updateArtifactPath,
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
  let updateCandidateSha256;
  let nativeEvidence;
  let updateEvidence;
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

  if (updateArtifactPath === undefined || !existsSync(updateArtifactPath)) {
    addBlocker(blockers, 'artifact.update-file-missing', 'Candidate update ZIP is required.');
  } else if (validManifest !== undefined) {
    updateCandidateSha256 = sha256File(updateArtifactPath);
    const size = statSync(updateArtifactPath).size;
    if (updateCandidateSha256 !== validManifest.updateArtifact.sha256) {
      addBlocker(
        blockers,
        'artifact.update-sha256-mismatch',
        'Candidate update ZIP digest does not match manifest.',
      );
    }
    if (size !== validManifest.updateArtifact.sizeBytes) {
      addBlocker(
        blockers,
        'artifact.update-size-mismatch',
        'Candidate update ZIP size does not match manifest.',
      );
    }
    if (path.basename(updateArtifactPath) !== validManifest.updateArtifact.fileName) {
      addBlocker(
        blockers,
        'artifact.update-name-mismatch',
        'Candidate update ZIP name does not match manifest.',
      );
    }
    if (path.extname(updateArtifactPath).toLowerCase() !== '.zip') {
      addBlocker(
        blockers,
        'artifact.update-format-invalid',
        'Candidate update artifact must be the Squirrel.Mac ZIP.',
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
    candidateSha256 !== undefined &&
    validManifest !== undefined &&
    updateCandidateSha256 !== undefined &&
    approvedTeamIdentifier !== undefined
  ) {
    try {
      nativeEvidence = verifyMacOsReleaseEvidence({
        artifactPath,
        updateArtifactPath,
        candidateSha256,
        updateCandidateSha256,
        sourceCommit: validManifest.provenance.sourceCommit,
        version: validManifest.artifact.version,
        updateVersion: validManifest.updateArtifact.version,
        approvedTeamIdentifier,
        commandRunner: nativeCommandRunner,
        hostPlatform,
        hostArchitecture,
      });
      updateEvidence = verifyMacOsUpdateArtifactEvidence({
        updateArtifactPath,
        updateCandidateSha256,
        sourceCommit: validManifest.provenance.sourceCommit,
        version: validManifest.updateArtifact.version,
        approvedTeamIdentifier,
        commandRunner: nativeCommandRunner,
        hostPlatform,
        hostArchitecture,
      });
      const updateBindings = [
        ['bundleId', 'artifact.update-bundle-id-mismatch'],
        ['embeddedSourceCommit', 'artifact.update-source-mismatch'],
        ['candidateEmbeddedTeamIdentifier', 'artifact.update-embedded-team-mismatch'],
        ['candidateAuthority', 'artifact.update-authority-mismatch'],
        ['candidateTeamIdentifier', 'artifact.update-team-mismatch'],
        ['candidateHardenedRuntime', 'artifact.update-hardened-runtime-mismatch'],
        ['candidateStaple', 'artifact.update-staple-mismatch'],
        ['candidateGatekeeper', 'artifact.update-gatekeeper-mismatch'],
      ];
      for (const [key, code] of updateBindings) {
        if (nativeEvidence.candidate[key] !== updateEvidence[key]) {
          addBlocker(
            blockers,
            code,
            'Candidate update ZIP app does not match verified DMG-installed app evidence.',
          );
        }
      }
      if (validManifest.signing.authority !== nativeEvidence.candidate.candidateAuthority) {
        addBlocker(
          blockers,
          'manifest.signing-authority-mismatch',
          'Manifest signing authority does not match verified native evidence.',
        );
      }
      if (
        validManifest.signing.teamIdentifier !== approvedTeamIdentifier ||
        validManifest.signing.teamIdentifier !== nativeEvidence.candidate.candidateTeamIdentifier
      ) {
        addBlocker(
          blockers,
          'manifest.signing-team-mismatch',
          'Manifest signing TeamIdentifier does not match the approved team and verified native evidence.',
        );
      }
      if (
        validManifest.signing.hardenedRuntime !== nativeEvidence.candidate.candidateHardenedRuntime
      ) {
        addBlocker(
          blockers,
          'manifest.hardened-runtime-mismatch',
          'Manifest hardened-runtime value does not match verified native evidence.',
        );
      }
      if (validManifest.notarization.staple !== nativeEvidence.candidate.candidateStaple) {
        addBlocker(
          blockers,
          'manifest.notarization-staple-mismatch',
          'Manifest notarization staple value does not match verified native evidence.',
        );
      }
      if (validManifest.verification.codesign.status !== 'valid') {
        addBlocker(
          blockers,
          'manifest.codesign-evidence-missing',
          'Manifest must attach redacted successful codesign evidence.',
        );
      }
      if (validManifest.verification.notarization.status !== 'available') {
        addBlocker(
          blockers,
          'manifest.notarization-evidence-missing',
          'Manifest must attach redacted notarization credential-boundary evidence.',
        );
      }
      if (validManifest.verification.stapler.status !== 'valid') {
        addBlocker(
          blockers,
          'manifest.stapler-evidence-missing',
          'Manifest must attach redacted successful stapler validation evidence.',
        );
      }
      if (validManifest.verification.gatekeeper.status !== 'accepted') {
        addBlocker(
          blockers,
          'manifest.gatekeeper-evidence-missing',
          'Manifest must attach redacted successful Gatekeeper assessment evidence.',
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
  const supportStatus = policy.support.map(({ id, documentationLabel, status, reason }) => ({
    id,
    documentationLabel,
    status,
    reason,
  }));
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
    supportStatus,
    knownLimitations,
    ...(nativeEvidence === undefined
      ? {}
      : {
          nativeEvidence: {
            candidateTeamIdentifier: nativeEvidence.candidate.candidateTeamIdentifier,
            projectId: nativeEvidence.install.firstLaunchProject.id,
            updateArtifactSha256: updateEvidence?.candidateArtifactSha256,
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
    'update-artifact',
    'manifest',
    'output',
    'expect',
    'skip-publication',
    'version',
    'source-commit',
    'built-at',
    'runner-id',
    'signing-authority',
    'team-id',
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
    'Usage: node scripts/desktop-release-contract.mjs <policy|manifest|status|verify> [--artifact path --update-artifact path --manifest path --output path --expect go|no-go --skip-publication 1 --version 1.0.0 --source-commit <sha> --built-at <iso> --runner-id <id> --signing-authority <authority> --team-id <team>]',
  );
}

function main(argv) {
  const [command, ...rawArgs] = argv;
  if (command === 'policy') {
    const policy = loadDesktopReleasePolicy();
    console.log(JSON.stringify({ policyId: policy.policyId, status: 'valid' }));
    return;
  }
  if (command === 'manifest') {
    const args = parseArgs(rawArgs);
    const manifest = generateDesktopReleaseManifest({
      artifactPath: args.artifact,
      updateArtifactPath: args['update-artifact'],
      version: args.version,
      sourceCommit: args['source-commit'],
      builtAt: args['built-at'],
      runnerId: args['runner-id'],
      signingAuthority: args['signing-authority'],
      teamIdentifier: args['team-id'],
    });
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (args.output) writeFileSync(args.output, serialized, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(serialized);
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
    updateArtifactPath: args['update-artifact'],
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

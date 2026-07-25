import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopReleaseContractError,
  evaluateDesktopRelease,
  generateDesktopReleaseManifest,
  hasUdifTrailer,
  loadDesktopReleasePolicy,
  sha256File,
  validateDesktopReleaseManifest,
  validateDesktopReleasePolicy,
} from './desktop-release-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeVerifierPath = path.join(repoRoot, 'scripts/macos-desktop-release-verifier.mjs');
const require = createRequire(import.meta.url);
const {
  createDesktopBuildProvenance,
  createDesktopReleaseForgeSettings,
  createDesktopReleaseProvenance,
  validateDesktopReleaseMakeResults,
} = require('../apps/desktop/scripts/desktop-release-forge.cjs') as {
  readonly createDesktopReleaseForgeSettings: (input?: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: string;
    readonly architecture?: string;
    readonly existsSync?: (candidate: string) => boolean;
  }) => {
    readonly enabled: boolean;
    readonly teamIdentifier?: string;
    readonly packagerConfig?: {
      readonly osxSign: Readonly<Record<string, unknown>>;
      readonly osxNotarize: Readonly<Record<string, unknown>>;
    };
    readonly dmgConfig?: Readonly<Record<string, unknown>>;
    readonly entitlementsPath?: string;
  };
  readonly createDesktopBuildProvenance: (input: {
    readonly sourceCommit: string;
    readonly version: string;
    readonly teamIdentifier?: string | null;
  }) => Readonly<Record<string, unknown>>;
  readonly createDesktopReleaseProvenance: (input: {
    readonly sourceCommit: string;
    readonly version: string;
    readonly teamIdentifier: string;
  }) => Readonly<Record<string, unknown>>;
  readonly validateDesktopReleaseMakeResults: (input: {
    readonly makeResults: unknown;
    readonly provenanceInjected: boolean;
    readonly existsSync?: (candidate: string) => boolean;
  }) => string;
};

type CommandInput = {
  readonly file: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
};
type CommandResult = {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error;
};

type MutableNativeOutput = {
  candidate: {
    candidateEmbeddedTeamIdentifier: string;
    retainedEmbeddedSourceCommit: string;
    retainedEmbeddedVersion: string;
    retainedEmbeddedTeamIdentifier: string;
    candidateTeamIdentifier: string;
    retainedTeamIdentifier: string;
  };
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const writeUdifFixture = (filePath: string, marker: string): void => {
  const bytes = Buffer.alloc(1024, marker);
  bytes.write('koly', bytes.length - 512, 'ascii');
  writeFileSync(filePath, bytes);
};

const createEvidence = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-desktop-release-'));
  temporaryDirectories.push(directory);
  const artifactPath = path.join(directory, 'Tileborne-1.0.0-arm64.dmg');
  const retainedArtifactPath = path.join(directory, 'Tileborne-0.9.0-arm64.dmg');
  const backupArtifactPath = path.join(directory, 'project-backup.zip');
  writeUdifFixture(artifactPath, 'A');
  writeUdifFixture(retainedArtifactPath, 'B');
  const candidateSha256 = sha256File(artifactPath);
  const retainedSha256 = sha256File(retainedArtifactPath);
  const manifest = generateDesktopReleaseManifest({
    artifactPath,
    version: '1.0.0',
    sourceCommit: 'a'.repeat(40),
    builtAt: '2026-07-16T09:00:00.000Z',
    runnerId: 'github-actions:run-123',
    signingAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
    teamIdentifier: 'ABCDEFGHIJ',
    verification: {
      checksum: { algorithm: 'sha256', value: candidateSha256 },
      codesign: { commandId: '11-codesign-strict', status: 'valid' },
      notarization: { commandId: '13-notary-credential-boundary', status: 'available' },
      stapler: { commandId: '12-stapler-validate', status: 'valid' },
      gatekeeper: { commandId: '14-gatekeeper-assess', status: 'accepted' },
    },
  });
  return {
    directory,
    artifactPath,
    retainedArtifactPath,
    backupArtifactPath,
    candidateSha256,
    retainedSha256,
    manifest,
  };
};

const nativeRunnerFor = (evidence: ReturnType<typeof createEvidence>) =>
  vi.fn((input: CommandInput): CommandResult => {
    expect(input.file).toBe(process.execPath);
    expect(input.args[0]).toBe(nativeVerifierPath);
    const argument = (name: string): string => {
      const index = input.args.indexOf(name);
      if (index < 0 || input.args[index + 1] === undefined) throw new Error(`missing ${name}`);
      return input.args[index + 1]!;
    };
    expect(argument('--candidate')).toBe(evidence.artifactPath);
    expect(argument('--retained')).toBe(evidence.retainedArtifactPath);
    expect(argument('--backup-output')).toBe(evidence.backupArtifactPath);
    const nonce = argument('--nonce');
    const backupBytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('platform-owned backup archive'),
    ]);
    writeFileSync(evidence.backupArtifactPath, backupBytes);
    const backupSha256 = createHash('sha256').update(backupBytes).digest('hex');
    return {
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        nonce,
        candidate: {
          candidateArtifactSha256: evidence.candidateSha256,
          retainedArtifactSha256: evidence.retainedSha256,
          format: 'udif',
          candidateArchitecture: 'arm64',
          retainedArchitecture: 'arm64',
          bundleId: 'dev.tileborne.app',
          embeddedSourceCommit: 'a'.repeat(40),
          embeddedVersion: '1.0.0',
          candidateEmbeddedTeamIdentifier: 'ABCDEFGHIJ',
          retainedEmbeddedSourceCommit: 'b'.repeat(40),
          retainedEmbeddedVersion: '0.9.0',
          retainedEmbeddedTeamIdentifier: 'ABCDEFGHIJ',
          candidateAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
          retainedAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
          candidateTeamIdentifier: 'ABCDEFGHIJ',
          retainedTeamIdentifier: 'ABCDEFGHIJ',
          candidateHardenedRuntime: 'runtime',
          retainedHardenedRuntime: 'runtime',
          candidateStaple: 'validated',
          retainedStaple: 'validated',
          candidateGatekeeper: 'accepted',
          retainedGatekeeper: 'accepted',
        },
        install: {
          location: 'temporary-applications',
          firstLaunchProjectId: 'project:native-oracle',
          relaunchProjectId: 'project:native-oracle',
        },
        rollback: {
          action: 'retained-installer-reinstalled',
          backupSha256,
          backupSizeBytes: backupBytes.length,
          reopenedProjectId: 'project:native-oracle',
        },
      }),
    };
  });

const nativeRunnerWithMutation = (
  evidence: ReturnType<typeof createEvidence>,
  mutate: (output: MutableNativeOutput) => void,
) => {
  const validRunner = nativeRunnerFor(evidence);
  return vi.fn((input: CommandInput): CommandResult => {
    const result = validRunner(input);
    const output = JSON.parse(result.stdout ?? '{}') as MutableNativeOutput;
    mutate(output);
    return { ...result, stdout: JSON.stringify(output) };
  });
};

const publicationRunner = vi.fn((input: CommandInput): CommandResult => {
  expect(input.file).toBe('gh');
  expect(input.args).toEqual(['auth', 'status', '--hostname', 'github.com', '--active']);
  return { status: 0, stdout: 'active account' };
});

const policyWithApprovedLkg = (evidence: ReturnType<typeof createEvidence>) => ({
  ...loadDesktopReleasePolicy(),
  lastKnownGoodReleases: [
    {
      version: '0.9.0',
      sourceCommit: 'b'.repeat(40),
      sha256: evidence.retainedSha256,
      teamIdentifier: 'ABCDEFGHIJ',
    },
  ],
});

const evaluateReady = (
  evidence: ReturnType<typeof createEvidence>,
  options: {
    readonly requirePublication?: boolean;
    readonly nativeRunner?: ReturnType<typeof vi.fn>;
    readonly policy?: ReturnType<typeof loadDesktopReleasePolicy>;
  } = {},
) =>
  evaluateDesktopRelease({
    artifactPath: evidence.artifactPath,
    retainedArtifactPath: evidence.retainedArtifactPath,
    backupArtifactPath: evidence.backupArtifactPath,
    manifest: evidence.manifest,
    environment: {
      TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1',
      GH_TOKEN: 'external-token-never-recorded',
      TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
    },
    expectedSourceCommit: 'a'.repeat(40),
    requirePublication: options.requirePublication ?? true,
    nativeCommandRunner: options.nativeRunner ?? nativeRunnerFor(evidence),
    publicationCommandRunner: publicationRunner,
    hostPlatform: 'darwin',
    hostArchitecture: 'arm64',
    policy: options.policy ?? policyWithApprovedLkg(evidence),
  });

describe('desktop 1.0 release contract', () => {
  it('owns the exact support limitations and manual rollback policy', () => {
    const policy = loadDesktopReleasePolicy();
    expect(policy.candidate).toEqual({
      platform: 'darwin',
      architecture: 'arm64',
      artifactKind: 'dmg',
      channel: 'github-release',
    });
    expect(
      policy.owners.map(({ id, owner }: { id: string; owner: string }) => [id, owner]),
    ).toEqual([
      ['release.packaging-provenance', 'apps/desktop/scripts/desktop-release-forge.cjs'],
      ['electron.metadata-entitlements', 'apps/desktop/electron-forge.config.cjs'],
      ['project.backup-reopen-semantics', 'packages/services-app/src/project'],
    ]);
    expect(
      policy.support.map(({ id, status }: { id: string; status: string }) => [id, status]),
    ).toEqual([
      ['platform.macos-arm64', 'candidate'],
      ['platform.macos-x64', 'unsupported'],
      ['platform.windows', 'unsupported'],
      ['platform.linux', 'unsupported'],
      ['capability.auto-update', 'unsupported'],
      ['capability.remote-crash-reporting', 'unsupported'],
      ['capability.publish', 'operator-blocked'],
      ['channel.mac-app-store', 'unsupported'],
      ['channel.npm', 'unsupported'],
      ['channel.homebrew', 'unsupported'],
      ['channel.cloudflare-deploy', 'unsupported'],
    ]);
    expect(
      policy.operatorOnlyMutations.map(({ id, status }: { id: string; status: string }) => [
        id,
        status,
      ]),
    ).toEqual([
      ['operation.git-tag-create', 'operator-blocked'],
      ['operation.git-tag-push', 'operator-blocked'],
      ['operation.github-release-create', 'operator-blocked'],
      ['operation.github-release-upload', 'operator-blocked'],
    ]);
    expect(
      policy.credentialPresenceChecks.map(({ name, owner }: { name: string; owner: string }) => [
        name,
        owner,
      ]),
    ).toEqual([
      ['TILEBORNE_APPLE_SIGNING_IDENTITY', 'apps/desktop/scripts/desktop-release-forge.cjs'],
      ['TILEBORNE_APPLE_TEAM_ID', 'scripts/desktop-release-contract.mjs'],
      ['TILEBORNE_APPLE_API_KEY_PATH', 'apps/desktop/scripts/desktop-release-forge.cjs'],
      ['TILEBORNE_APPLE_API_KEY_ID', 'apps/desktop/scripts/desktop-release-forge.cjs'],
      ['TILEBORNE_APPLE_API_ISSUER', 'apps/desktop/scripts/desktop-release-forge.cjs'],
      ['TILEBORNE_DESKTOP_PUBLISH_APPROVED', 'scripts/desktop-release-contract.mjs'],
      ['GH_TOKEN', 'scripts/desktop-release-contract.mjs'],
    ]);
    expect(policy.rollback).toMatchObject({
      mode: 'manual-retained-installer',
      requireArtifactDigest: true,
      requireProjectBackupBeforeDowngrade: true,
      requireBackupVerification: true,
      automaticRollback: 'unsupported',
    });
  });

  it('keeps the manifest closed and rejects self-asserted security evidence', () => {
    const policy = loadDesktopReleasePolicy();
    expect(() => validateDesktopReleasePolicy({ ...policy, inferredMakerSupport: true })).toThrow(
      DesktopReleaseContractError,
    );
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        owners: policy.owners.map((owner: { id: string }) =>
          owner.id === 'electron.metadata-entitlements'
            ? { ...owner, owner: 'scripts/desktop-release-contract.mjs' }
            : owner,
        ),
      }),
    ).toThrow(/policy\.owner-drift/);
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        support: policy.support.filter(
          (support: { id: string }) => support.id !== 'channel.mac-app-store',
        ),
      }),
    ).toThrow(/policy\.support-drift/);
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        operatorOnlyMutations: policy.operatorOnlyMutations.filter(
          (operation: { id: string }) => operation.id !== 'operation.git-tag-push',
        ),
      }),
    ).toThrow(/policy\.operator-mutation-drift/);
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        operatorOnlyMutations: policy.operatorOnlyMutations.map((operation: { id: string }) =>
          operation.id === 'operation.github-release-upload'
            ? { ...operation, status: 'candidate' }
            : operation,
        ),
      }),
    ).toThrow(/contract\.invalid-enum/);
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        credentialPresenceChecks: policy.credentialPresenceChecks.map((check: { name: string }) =>
          check.name === 'GH_TOKEN'
            ? { ...check, owner: 'apps/desktop/scripts/desktop-release-forge.cjs' }
            : check,
        ),
      }),
    ).toThrow(/policy\.credential-check-drift/);
    const { manifest } = createEvidence();
    expect(() =>
      validateDesktopReleaseManifest({
        ...manifest,
        callerProvidedReceipts: { signing: true, notarization: true },
      }),
    ).toThrow(/contract\.unknown-field/);
    expect(() =>
      validateDesktopReleaseManifest({
        ...manifest,
        signing: { ...manifest.signing, verified: true },
      }),
    ).toThrow(/contract\.unknown-field/);
    expect(() =>
      validateDesktopReleaseManifest({
        ...manifest,
        artifact: { ...manifest.artifact, platform: 'win32' },
      }),
    ).toThrow(/contract\.invalid-literal/);
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        lastKnownGoodReleases: [
          {
            version: '01.0.0',
            sourceCommit: 'b'.repeat(40),
            sha256: 'f'.repeat(64),
            teamIdentifier: 'ABCDEFGHIJ',
          },
        ],
      }),
    ).toThrow(/contract\.invalid-semver/);
  });

  it('generates a deterministic closed desktop candidate manifest', () => {
    const evidence = createEvidence();
    const input = {
      artifactPath: evidence.artifactPath,
      version: '1.0.0',
      sourceCommit: 'a'.repeat(40),
      builtAt: '2026-07-16T09:00:00.000Z',
      runnerId: 'github-actions:run-123',
      signingAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
      teamIdentifier: 'ABCDEFGHIJ',
    };
    const first = generateDesktopReleaseManifest(input);
    const second = generateDesktopReleaseManifest(input);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      artifact: {
        bundleId: 'dev.tileborne.app',
        fileName: path.basename(evidence.artifactPath),
        sha256: evidence.candidateSha256,
      },
      provenance: {
        sourceCommit: 'a'.repeat(40),
        builtAt: '2026-07-16T09:00:00.000Z',
      },
      runner: {
        id: 'github-actions:run-123',
        os: 'darwin',
        architecture: 'arm64',
      },
      signing: {
        authority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
        teamIdentifier: 'ABCDEFGHIJ',
        hardenedRuntime: 'runtime',
      },
      notarization: {
        method: 'app-store-connect-api-key',
        credentialReference: 'TILEBORNE_APPLE_API_KEY_PATH',
        staple: 'validated',
      },
      verification: {
        checksum: { algorithm: 'sha256', value: evidence.candidateSha256 },
        codesign: { commandId: 'manifest-generation', status: 'pending' },
        notarization: { commandId: 'manifest-generation', status: 'pending' },
        stapler: { commandId: 'manifest-generation', status: 'pending' },
        gatekeeper: { commandId: 'manifest-generation', status: 'pending' },
      },
    });
  });

  it('requires completed redacted verification evidence before artifact GO', () => {
    const evidence = createEvidence();
    const pendingManifest = generateDesktopReleaseManifest({
      artifactPath: evidence.artifactPath,
      version: '1.0.0',
      sourceCommit: 'a'.repeat(40),
      builtAt: '2026-07-16T09:00:00.000Z',
      runnerId: 'github-actions:run-123',
      signingAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
      teamIdentifier: 'ABCDEFGHIJ',
    });
    const status = evaluateReady(
      { ...evidence, manifest: pendingManifest },
      { nativeRunner: nativeRunnerFor(evidence) },
    );
    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'manifest.codesign-evidence-missing',
        'manifest.notarization-evidence-missing',
        'manifest.stapler-evidence-missing',
        'manifest.gatekeeper-evidence-missing',
      ]),
    );
  });

  it('rejects manifest tampering and mismatched source/version during verification', () => {
    const evidence = createEvidence();
    const tamperedArtifact = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      retainedArtifactPath: evidence.retainedArtifactPath,
      backupArtifactPath: evidence.backupArtifactPath,
      manifest: {
        ...evidence.manifest,
        artifact: { ...evidence.manifest.artifact, sha256: 'f'.repeat(64) },
        verification: {
          ...evidence.manifest.verification,
          checksum: { algorithm: 'sha256', value: 'f'.repeat(64) },
        },
      },
      environment: { TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ' },
      expectedSourceCommit: 'a'.repeat(40),
    });
    expect(tamperedArtifact.blockers.map(({ code }) => code)).toContain('artifact.sha256-mismatch');

    const wrongSource = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      retainedArtifactPath: evidence.retainedArtifactPath,
      backupArtifactPath: evidence.backupArtifactPath,
      manifest: {
        ...evidence.manifest,
        provenance: { ...evidence.manifest.provenance, sourceCommit: 'b'.repeat(40) },
      },
      environment: { TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ' },
      expectedSourceCommit: 'a'.repeat(40),
    });
    expect(wrongSource.blockers.map(({ code }) => code)).toContain(
      'provenance.source-commit-mismatch',
    );

    const manifestVersionMismatch = evaluateReady(
      {
        ...evidence,
        manifest: {
          ...evidence.manifest,
          artifact: { ...evidence.manifest.artifact, version: '1.0.1' },
        },
      },
      { nativeRunner: nativeRunnerFor(evidence) },
    );
    expect(manifestVersionMismatch.blockers.map(({ code }) => code)).toContain(
      'contract.invalid-literal',
    );
  });

  it.each([
    {
      label: 'signing authority',
      code: 'manifest.signing-authority-mismatch',
      mutate: (manifest: ReturnType<typeof createEvidence>['manifest']) => ({
        ...manifest,
        signing: {
          ...manifest.signing,
          authority: 'Developer ID Application: Other Publisher (ABCDEFGHIJ)',
        },
      }),
    },
    {
      label: 'signing team',
      code: 'manifest.signing-team-mismatch',
      mutate: (manifest: ReturnType<typeof createEvidence>['manifest']) => ({
        ...manifest,
        signing: { ...manifest.signing, teamIdentifier: 'ZZZZZZZZZZ' },
      }),
    },
    {
      label: 'hardened runtime',
      code: 'manifest.hardened-runtime-mismatch',
      mutate: (manifest: ReturnType<typeof createEvidence>['manifest']) => ({
        ...manifest,
        signing: { ...manifest.signing, hardenedRuntime: 'disabled' },
      }),
    },
    {
      label: 'notarization staple',
      code: 'manifest.notarization-staple-mismatch',
      mutate: (manifest: ReturnType<typeof createEvidence>['manifest']) => ({
        ...manifest,
        notarization: { ...manifest.notarization, staple: 'missing' },
      }),
    },
  ])(
    'rejects manifest $label when it disagrees with verified native evidence',
    ({ code, mutate }) => {
      const evidence = createEvidence();
      const status = evaluateReady(
        { ...evidence, manifest: mutate(evidence.manifest) },
        { nativeRunner: nativeRunnerFor(evidence) },
      );
      expect(status.decision).toBe('no-go');
      expect(status.blockers.map(({ code: blockerCode }) => blockerCode)).toContain(code);
    },
  );

  it('reports the evidence-free checkout truthfully as NO-GO', () => {
    const status = evaluateDesktopRelease();
    expect(status).toMatchObject({
      decision: 'no-go',
      artifactDecision: 'blocked',
      publicationDecision: 'operator-blocked',
    });
    expect(status.blockers.map(({ code }) => code)).toEqual([
      'artifact.manifest-missing',
      'artifact.file-missing',
      'rollback.retained-artifact-missing',
      'rollback.backup-output-missing',
      'signing.approved-team-missing',
      'publish.approval-missing',
      'publish.credential-missing',
    ]);
  });

  it('only returns GO after the fixed native and operator command boundaries verify', () => {
    const evidence = createEvidence();
    const nativeRunner = nativeRunnerFor(evidence);
    const status = evaluateReady(evidence, { nativeRunner });
    expect(status).toMatchObject({
      decision: 'go',
      artifactDecision: 'ready',
      publicationDecision: 'approved',
      blockers: [],
      nativeEvidence: {
        candidateTeamIdentifier: 'ABCDEFGHIJ',
        projectId: 'project:native-oracle',
      },
    });
    expect(nativeRunner).toHaveBeenCalledOnce();
    expect(publicationRunner).toHaveBeenCalledOnce();
    expect(JSON.stringify(status)).not.toContain('external-token-never-recorded');
  });

  it('rejects arbitrary text even when forged true receipts are supplied', () => {
    const evidence = createEvidence();
    writeFileSync(evidence.artifactPath, 'not a dmg');
    writeFileSync(evidence.retainedArtifactPath, 'also not a dmg');
    const manifest = {
      ...evidence.manifest,
      artifact: {
        ...evidence.manifest.artifact,
        sizeBytes: statSize(evidence.artifactPath),
        sha256: sha256File(evidence.artifactPath),
      },
      verification: {
        ...evidence.manifest.verification,
        checksum: { algorithm: 'sha256', value: sha256File(evidence.artifactPath) },
      },
    };
    const nativeRunner = nativeRunnerFor(evidence);
    const status = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      retainedArtifactPath: evidence.retainedArtifactPath,
      backupArtifactPath: evidence.backupArtifactPath,
      manifest,
      installReceipt: { verified: true, mountedDmg: true, firstLaunch: true },
      rollbackReceipt: { verified: true, backup: true, projectReopen: true },
      environment: {
        TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1',
        GH_TOKEN: 'placeholder',
        TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
      },
      expectedSourceCommit: 'a'.repeat(40),
      nativeCommandRunner: nativeRunner,
      publicationCommandRunner: publicationRunner,
      hostPlatform: 'darwin',
      hostArchitecture: 'arm64',
    });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['artifact.format-invalid', 'rollback.retained-format-invalid']),
    );
    expect(nativeRunner).not.toHaveBeenCalled();
  });

  it('does not let a trailer-only fake pass the real native verifier boundary', () => {
    const evidence = createEvidence();
    const status = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      retainedArtifactPath: evidence.retainedArtifactPath,
      backupArtifactPath: evidence.backupArtifactPath,
      manifest: evidence.manifest,
      environment: { TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ' },
      expectedSourceCommit: 'a'.repeat(40),
      requirePublication: false,
    });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.some(({ code }) => code.startsWith('native.'))).toBe(true);
  });

  it('rejects forged verifier stdout and tampered backup provenance', () => {
    const evidence = createEvidence();
    const forgedRunner = vi.fn((input: CommandInput): CommandResult => {
      const nonce = input.args[input.args.indexOf('--nonce') + 1];
      writeFileSync(evidence.backupArtifactPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          nonce,
          verified: true,
          signed: true,
          notarized: true,
          launched: true,
          rollback: true,
        }),
      };
    });
    const forged = evaluateReady(evidence, { nativeRunner: forgedRunner });
    expect(forged.decision).toBe('no-go');
    expect(forged.blockers.map(({ code }) => code)).toContain('contract.missing-field');

    const validRunner = nativeRunnerFor(evidence);
    const wrongProvenanceRunner = vi.fn((input: CommandInput): CommandResult => {
      const result = validRunner(input);
      const output = JSON.parse(result.stdout ?? '{}') as {
        candidate: { embeddedSourceCommit: string };
      };
      output.candidate.embeddedSourceCommit = 'c'.repeat(40);
      return { ...result, stdout: JSON.stringify(output) };
    });
    const wrongProvenance = evaluateReady(evidence, { nativeRunner: wrongProvenanceRunner });
    expect(wrongProvenance.decision).toBe('no-go');
    expect(wrongProvenance.blockers.map(({ code }) => code)).toContain('contract.invalid-literal');

    const realRunner = nativeRunnerFor(evidence);
    const tamperingRunner = vi.fn((input: CommandInput): CommandResult => {
      const result = realRunner(input);
      writeFileSync(
        evidence.backupArtifactPath,
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('tampered')]),
      );
      return result;
    });
    const tampered = evaluateReady(evidence, { nativeRunner: tamperingRunner });
    expect(tampered.decision).toBe('no-go');
    expect(tampered.blockers.map(({ code }) => code)).toContain(
      'rollback.backup-provenance-mismatch',
    );
  });

  it('rejects a validly structured native result from the wrong Apple team', () => {
    const evidence = createEvidence();
    const wrongTeamRunner = nativeRunnerWithMutation(evidence, (output) => {
      output.candidate.candidateEmbeddedTeamIdentifier = 'ZZZZZZZZZZ';
      output.candidate.retainedEmbeddedTeamIdentifier = 'ZZZZZZZZZZ';
      output.candidate.candidateTeamIdentifier = 'ZZZZZZZZZZ';
      output.candidate.retainedTeamIdentifier = 'ZZZZZZZZZZ';
    });
    const status = evaluateReady(evidence, { nativeRunner: wrongTeamRunner });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toContain('contract.invalid-literal');
  });

  it.each(['1.0.0', '1.1.0'])(
    'rejects retained release version %s because it is not strictly earlier',
    (retainedVersion) => {
      const evidence = createEvidence();
      const policy = {
        ...policyWithApprovedLkg(evidence),
        lastKnownGoodReleases: [
          {
            version: retainedVersion,
            sourceCommit: 'b'.repeat(40),
            sha256: evidence.retainedSha256,
            teamIdentifier: 'ABCDEFGHIJ',
          },
        ],
      };
      const status = evaluateReady(evidence, {
        policy,
        nativeRunner: nativeRunnerWithMutation(evidence, (output) => {
          output.candidate.retainedEmbeddedVersion = retainedVersion;
        }),
      });
      expect(status.decision).toBe('no-go');
      expect(status.blockers.map(({ code }) => code)).toContain('rollback.lkg-version-not-earlier');
    },
  );

  it('rejects an unapproved retained digest or forked source identity', () => {
    const unapprovedDigestEvidence = createEvidence();
    const unapprovedDigest = evaluateReady(unapprovedDigestEvidence, {
      policy: {
        ...policyWithApprovedLkg(unapprovedDigestEvidence),
        lastKnownGoodReleases: [
          {
            version: '0.9.0',
            sourceCommit: 'b'.repeat(40),
            sha256: 'f'.repeat(64),
            teamIdentifier: 'ABCDEFGHIJ',
          },
        ],
      },
    });
    expect(unapprovedDigest.decision).toBe('no-go');
    expect(unapprovedDigest.blockers.map(({ code }) => code)).toContain(
      'rollback.lkg-not-approved',
    );

    const forkedSourceEvidence = createEvidence();
    const forkedSource = evaluateReady(forkedSourceEvidence, {
      nativeRunner: nativeRunnerWithMutation(forkedSourceEvidence, (output) => {
        output.candidate.retainedEmbeddedSourceCommit = 'c'.repeat(40);
      }),
    });
    expect(forkedSource.decision).toBe('no-go');
    expect(forkedSource.blockers.map(({ code }) => code)).toContain('rollback.lkg-not-approved');
  });

  it('makes skip-publication artifact-ready but never overall GO', () => {
    const evidence = createEvidence();
    const status = evaluateReady(evidence, { requirePublication: false });
    expect(status).toMatchObject({
      decision: 'no-go',
      artifactDecision: 'ready',
      publicationDecision: 'not-requested',
      blockers: [
        {
          code: 'publish.not-requested',
          message: 'Artifact verification does not authorize publication.',
        },
      ],
    });
  });

  it('does not accept a placeholder token when the operator boundary rejects it', () => {
    const evidence = createEvidence();
    const status = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      retainedArtifactPath: evidence.retainedArtifactPath,
      backupArtifactPath: evidence.backupArtifactPath,
      manifest: evidence.manifest,
      environment: {
        TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1',
        GH_TOKEN: 'placeholder',
        TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
      },
      expectedSourceCommit: 'a'.repeat(40),
      nativeCommandRunner: nativeRunnerFor(evidence),
      publicationCommandRunner: () => ({ status: 1, stderr: 'unauthorized' }),
      hostPlatform: 'darwin',
      hostArchitecture: 'arm64',
    });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toContain('publish.credential-unverified');
  });

  it('keeps release signing disabled by default and Apple credentials external', () => {
    expect(createDesktopReleaseForgeSettings({ env: {} })).toEqual({ enabled: false });
    expect(() =>
      createDesktopReleaseForgeSettings({
        env: { TILEBORNE_DESKTOP_RELEASE: '1' },
        platform: 'darwin',
        architecture: 'arm64',
      }),
    ).toThrow(/TILEBORNE_APPLE_SIGNING_IDENTITY/);
    const settings = createDesktopReleaseForgeSettings({
      env: {
        TILEBORNE_DESKTOP_RELEASE: '1',
        TILEBORNE_APPLE_SIGNING_IDENTITY:
          'Developer ID Application: Tileborne Release (ABCDEFGHIJ)',
        TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
        TILEBORNE_APPLE_API_KEY_PATH: '/external/AuthKey.p8',
        TILEBORNE_APPLE_API_KEY_ID: 'KLMNOPQRST',
        TILEBORNE_APPLE_API_ISSUER: '12345678-1234-1234-1234-123456789abc',
      },
      platform: 'darwin',
      architecture: 'arm64',
      existsSync: (candidate) =>
        candidate === '/external/AuthKey.p8' || candidate.endsWith('assets/entitlements.mac.plist'),
    });
    expect(settings.packagerConfig?.osxSign).toMatchObject({
      entitlements: settings.entitlementsPath,
      entitlementsInherit: settings.entitlementsPath,
      hardenedRuntime: true,
      strictVerify: true,
      continueOnError: false,
    });
    expect(settings.entitlementsPath).toMatch(/apps\/desktop\/assets\/entitlements\.mac\.plist$/);
    expect(settings.teamIdentifier).toBe('ABCDEFGHIJ');
    expect(settings.packagerConfig?.osxNotarize).toEqual({
      appleApiKey: '/external/AuthKey.p8',
      appleApiKeyId: 'KLMNOPQRST',
      appleApiIssuer: '12345678-1234-1234-1234-123456789abc',
    });
    expect(Object.isFrozen(settings.packagerConfig)).toBe(false);
    expect(Object.isFrozen(settings.packagerConfig?.osxSign)).toBe(false);
    expect(Object.isFrozen(settings.packagerConfig?.osxNotarize)).toBe(false);
    expect(Object.isFrozen(settings.dmgConfig)).toBe(false);
    expect(() =>
      createDesktopReleaseForgeSettings({
        env: {
          TILEBORNE_DESKTOP_RELEASE: '1',
          TILEBORNE_APPLE_SIGNING_IDENTITY:
            'Developer ID Application: Tileborne Release (ABCDEFGHIJ)',
          TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
          TILEBORNE_APPLE_API_KEY_PATH: '/external/AuthKey.p8',
          TILEBORNE_APPLE_API_KEY_ID: 'KLMNOPQRST',
          TILEBORNE_APPLE_API_ISSUER: '12345678-1234-1234-1234-123456789abc',
        },
        platform: 'darwin',
        architecture: 'arm64',
        existsSync: (candidate) => candidate === '/external/AuthKey.p8',
      }),
    ).toThrow(/desktop-release\.entitlements-missing/);
    expect(
      createDesktopBuildProvenance({
        sourceCommit: 'a'.repeat(40),
        version: '1.0.0',
      }),
    ).toEqual({
      schemaVersion: 1,
      policyId: 'tileborne-desktop-1.0',
      sourceCommit: 'a'.repeat(40),
      version: '1.0.0',
      teamIdentifier: null,
      buildCommand: 'pnpm --filter @tileborne/desktop package',
    });
    expect(
      createDesktopReleaseProvenance({
        sourceCommit: 'a'.repeat(40),
        version: '1.0.0',
        teamIdentifier: 'ABCDEFGHIJ',
      }),
    ).toEqual({
      schemaVersion: 1,
      policyId: 'tileborne-desktop-1.0',
      sourceCommit: 'a'.repeat(40),
      version: '1.0.0',
      teamIdentifier: 'ABCDEFGHIJ',
      buildCommand: 'pnpm --filter @tileborne/desktop package',
    });
  });

  it('binds Forge release mode to exactly one existing macOS-arm64 DMG', () => {
    const valid = [{ platform: 'darwin', arch: 'arm64', artifacts: ['/release/Tileborne.dmg'] }];
    expect(
      validateDesktopReleaseMakeResults({
        makeResults: valid,
        provenanceInjected: true,
        existsSync: (candidate) => candidate === '/release/Tileborne.dmg',
      }),
    ).toBe('/release/Tileborne.dmg');

    const invalidInputs = [
      { makeResults: undefined, provenanceInjected: true },
      { makeResults: [], provenanceInjected: true },
      { makeResults: [...valid, ...valid], provenanceInjected: true },
      {
        makeResults: [{ platform: 'win32', arch: 'arm64', artifacts: ['/release/Tileborne.dmg'] }],
        provenanceInjected: true,
      },
      {
        makeResults: [{ platform: 'darwin', arch: 'x64', artifacts: ['/release/Tileborne.dmg'] }],
        provenanceInjected: true,
      },
      {
        makeResults: [{ platform: 'darwin', arch: 'arm64', artifacts: [] }],
        provenanceInjected: true,
      },
      {
        makeResults: [{ platform: 'darwin', arch: 'arm64' }],
        provenanceInjected: true,
      },
      {
        makeResults: [
          { platform: 'darwin', arch: 'arm64', artifacts: ['/release/a.dmg', '/release/b.dmg'] },
        ],
        provenanceInjected: true,
      },
      {
        makeResults: [{ platform: 'darwin', arch: 'arm64', artifacts: ['/release/Tileborne.zip'] }],
        provenanceInjected: true,
      },
      { makeResults: valid, provenanceInjected: false },
    ];
    for (const input of invalidInputs) {
      expect(() => validateDesktopReleaseMakeResults({ ...input, existsSync: () => true })).toThrow(
        /desktop-release\./,
      );
    }
    expect(() =>
      validateDesktopReleaseMakeResults({
        makeResults: valid,
        provenanceInjected: true,
        existsSync: () => false,
      }),
    ).toThrow(/desktop-release\.dmg-missing/);
  });

  it('exposes a passing policy gate and rejects legacy editable receipt flags', () => {
    const policy = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/desktop-release-contract.mjs'), 'policy'],
      { encoding: 'utf8' },
    );
    expect(policy.status, policy.stderr).toBe(0);
    const verify = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/desktop-release-contract.mjs'), 'verify'],
      { encoding: 'utf8' },
    );
    expect(verify.status).toBe(1);
    expect(JSON.parse(verify.stdout).decision).toBe('no-go');
    const legacy = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts/desktop-release-contract.mjs'),
        'status',
        '--install-receipt',
        'forged.json',
      ],
      { encoding: 'utf8' },
    );
    expect(legacy.status).toBe(1);
    expect(legacy.stderr).toContain('cli.invalid-argument');
  });

  it('exposes a deterministic manifest CLI', () => {
    const evidence = createEvidence();
    const args = [
      path.join(repoRoot, 'scripts/desktop-release-contract.mjs'),
      'manifest',
      '--artifact',
      evidence.artifactPath,
      '--version',
      '1.0.0',
      '--source-commit',
      'a'.repeat(40),
      '--built-at',
      '2026-07-16T09:00:00.000Z',
      '--runner-id',
      'github-actions:run-123',
      '--signing-authority',
      'Developer ID Application: Tileborne (ABCDEFGHIJ)',
      '--team-id',
      'ABCDEFGHIJ',
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(JSON.parse(first.stdout)).toEqual(
      generateDesktopReleaseManifest({
        artifactPath: evidence.artifactPath,
        version: '1.0.0',
        sourceCommit: 'a'.repeat(40),
        builtAt: '2026-07-16T09:00:00.000Z',
        runnerId: 'github-actions:run-123',
        signingAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
        teamIdentifier: 'ABCDEFGHIJ',
      }),
    );
  });

  it('recognizes only a UDIF trailer, not a DMG extension or arbitrary prefix', () => {
    const evidence = createEvidence();
    expect(hasUdifTrailer(evidence.artifactPath)).toBe(true);
    writeFileSync(evidence.artifactPath, Buffer.from('koly arbitrary bytes'));
    expect(hasUdifTrailer(evidence.artifactPath)).toBe(false);
  });

  it('contains no credential values in the versioned policy or native verifier', () => {
    const sources = [
      'scripts/desktop-release-policy.json',
      'scripts/macos-desktop-release-verifier.mjs',
    ].map((relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8'));
    expect(sources.join('\n')).not.toMatch(/BEGIN (?:RSA |EC )?PRIVATE KEY/);
  });
});

function statSize(filePath: string): number {
  return readFileSync(filePath).byteLength;
}

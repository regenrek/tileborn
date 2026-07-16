import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DesktopReleaseContractError,
  evaluateDesktopRelease,
  loadDesktopReleasePolicy,
  validateDesktopReleaseManifest,
  validateDesktopReleasePolicy,
} from './desktop-release-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createDesktopReleaseForgeSettings } =
  require('../apps/desktop/scripts/desktop-release-forge.cjs') as {
    readonly createDesktopReleaseForgeSettings: (input?: {
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly platform?: string;
      readonly architecture?: string;
      readonly existsSync?: (candidate: string) => boolean;
    }) => {
      readonly enabled: boolean;
      readonly packagerConfig?: {
        readonly osxSign: Readonly<Record<string, unknown>>;
        readonly osxNotarize: Readonly<Record<string, unknown>>;
      };
      readonly dmgConfig?: Readonly<Record<string, unknown>>;
    };
  };

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createEvidence = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-desktop-release-'));
  temporaryDirectories.push(directory);
  const artifactPath = path.join(directory, 'Tileborne-1.0.0-arm64.dmg');
  const bytes = Buffer.from('real candidate bytes used by the contract test');
  writeFileSync(artifactPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const retainedArtifactPath = path.join(directory, 'Tileborne-0.9.0-arm64.dmg');
  const retainedBytes = Buffer.from('retained last-known-good installer');
  writeFileSync(retainedArtifactPath, retainedBytes);
  const retainedSha256 = createHash('sha256').update(retainedBytes).digest('hex');
  const header = { schemaVersion: 1, policyId: 'tileborne-desktop-1.0' } as const;
  const manifest = {
    ...header,
    artifact: {
      fileName: path.basename(artifactPath),
      kind: 'dmg',
      platform: 'darwin',
      architecture: 'arm64',
      version: '1.0.0',
      sizeBytes: bytes.length,
      sha256,
    },
    provenance: {
      sourceCommit: 'a'.repeat(40),
      buildCommand: 'pnpm --filter @tileborne/desktop package',
      builderOs: 'darwin',
      builderArchitecture: 'arm64',
      builtAt: '2026-07-16T09:00:00.000Z',
    },
    signing: {
      verified: true,
      identity: 'Developer ID Application: Tileborne Test (ABCDEFGHIJ)',
      teamIdentifier: 'ABCDEFGHIJ',
      hardenedRuntime: true,
      verifiedTargets: ['application', 'installer'],
    },
    notarization: {
      verified: true,
      status: 'accepted',
      requestId: 'notary-request-id',
      stapledTargets: ['application', 'installer'],
    },
  };
  const installReceipt = {
    ...header,
    artifactSha256: sha256,
    platform: 'darwin',
    architecture: 'arm64',
    gatekeeperAssessment: 'accepted',
    mountedDmg: true,
    copiedToApplications: true,
    firstLaunch: true,
    relaunch: true,
    testedAt: '2026-07-16T09:15:00.000Z',
  };
  const rollbackReceipt = {
    ...header,
    candidateArtifactSha256: sha256,
    retainedInstaller: {
      version: '0.9.0',
      sha256: retainedSha256,
      checksumVerified: true,
      developerIdVerified: true,
      notarizationVerified: true,
    },
    projectBackup: {
      createdBeforeDowngrade: true,
      verified: true,
      projectCount: 2,
    },
    reinstallSucceeded: true,
    projectReopenSucceeded: true,
    testedAt: '2026-07-16T09:30:00.000Z',
  };
  return { artifactPath, retainedArtifactPath, manifest, installReceipt, rollbackReceipt };
};

describe('desktop 1.0 release contract', () => {
  it('owns an exact support/limitation and rollback policy', () => {
    const policy = loadDesktopReleasePolicy();
    expect(policy.candidate).toEqual({
      platform: 'darwin',
      architecture: 'arm64',
      artifactKind: 'dmg',
      channel: 'github-release',
    });
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
    ]);
    expect(policy.rollback).toMatchObject({
      mode: 'manual-retained-installer',
      requireArtifactDigest: true,
      requireProjectBackupBeforeDowngrade: true,
      requireBackupVerification: true,
      automaticRollback: 'unsupported',
    });
  });

  it('rejects schema drift instead of accepting extra or missing fields', () => {
    const policy = loadDesktopReleasePolicy();
    expect(() => validateDesktopReleasePolicy({ ...policy, inferredMakerSupport: true })).toThrow(
      DesktopReleaseContractError,
    );
    const { manifest } = createEvidence();
    expect(() =>
      validateDesktopReleaseManifest({
        ...manifest,
        artifact: { ...manifest.artifact, sha256: undefined },
      }),
    ).toThrow(/manifest\.artifact\.sha256/);
  });

  it('reports the evidence-free tree truthfully as NO-GO with stable limitations', () => {
    const status = evaluateDesktopRelease();
    expect(status).toMatchObject({
      decision: 'no-go',
      artifactDecision: 'blocked',
      publicationDecision: 'operator-blocked',
    });
    expect(status.blockers.map(({ code }) => code)).toEqual([
      'artifact.manifest-missing',
      'artifact.file-missing',
      'install.receipt-missing',
      'rollback.receipt-missing',
      'publish.approval-missing',
      'publish.credential-missing',
    ]);
    expect(status.knownLimitations.map(({ id }) => id)).toContain('platform.windows');
    expect(status.knownLimitations.map(({ id }) => id)).toContain('capability.auto-update');
  });

  it('only returns GO for a digest-bound signed/notarized native receipt set and approval boundary', () => {
    const evidence = createEvidence();
    const status = evaluateDesktopRelease({
      ...evidence,
      expectedSourceCommit: 'a'.repeat(40),
      environment: {
        TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1',
        GH_TOKEN: 'present-but-never-recorded',
      },
    });
    expect(status).toMatchObject({
      decision: 'go',
      artifactDecision: 'ready',
      publicationDecision: 'approved',
      blockers: [],
    });
    expect(JSON.stringify(status)).not.toContain('present-but-never-recorded');
  });

  it('fails closed for artifact tampering and an unverified pre-downgrade backup', () => {
    const evidence = createEvidence();
    writeFileSync(evidence.artifactPath, 'tampered');
    const rollbackReceipt = {
      ...evidence.rollbackReceipt,
      projectBackup: { ...evidence.rollbackReceipt.projectBackup, verified: false },
    };
    const status = evaluateDesktopRelease({
      ...evidence,
      rollbackReceipt,
      requirePublication: false,
      expectedSourceCommit: 'a'.repeat(40),
    });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'artifact.sha256-mismatch',
        'artifact.size-mismatch',
        'rollback.backup-unverified',
      ]),
    );

    const wrongCheckout = evaluateDesktopRelease({
      ...evidence,
      requirePublication: false,
      expectedSourceCommit: 'c'.repeat(40),
    });
    expect(wrongCheckout.blockers.map(({ code }) => code)).toContain(
      'provenance.source-commit-mismatch',
    );

    const missingRetained = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      manifest: evidence.manifest,
      installReceipt: evidence.installReceipt,
      rollbackReceipt: evidence.rollbackReceipt,
      requirePublication: false,
      expectedSourceCommit: 'a'.repeat(40),
    });
    expect(missingRetained.blockers.map(({ code }) => code)).toContain(
      'rollback.retained-artifact-missing',
    );
  });

  it('keeps release signing disabled by default and validates the Apple secret boundary eagerly', () => {
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
      existsSync: (candidate) => candidate === '/external/AuthKey.p8',
    });
    expect(settings.packagerConfig?.osxSign).toMatchObject({
      hardenedRuntime: true,
      strictVerify: true,
      continueOnError: false,
    });
    expect(settings.packagerConfig?.osxNotarize).toEqual({
      appleApiKey: '/external/AuthKey.p8',
      appleApiKeyId: 'KLMNOPQRST',
      appleApiIssuer: '12345678-1234-1234-1234-123456789abc',
    });
    expect(settings.dmgConfig).toMatchObject({
      additionalDMGOptions: {
        'code-sign': { 'signing-identity': expect.stringContaining('Developer ID Application:') },
      },
    });
  });

  it('exposes a passing policy gate and a non-zero verifier for the current NO-GO state', () => {
    const policy = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/desktop-release-contract.mjs'), 'policy'],
      { encoding: 'utf8' },
    );
    expect(policy.status, policy.stderr).toBe(0);
    expect(JSON.parse(policy.stdout)).toEqual({
      policyId: 'tileborne-desktop-1.0',
      status: 'valid',
    });

    const verify = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/desktop-release-contract.mjs'), 'verify'],
      { encoding: 'utf8' },
    );
    expect(verify.status).toBe(1);
    expect(JSON.parse(verify.stdout).decision).toBe('no-go');
  });

  it('contains no credential values in the versioned policy', () => {
    const rawPolicy = readFileSync(
      path.join(repoRoot, 'scripts/desktop-release-policy.json'),
      'utf8',
    );
    expect(rawPolicy).toContain('GH_TOKEN');
    expect(rawPolicy).not.toMatch(/BEGIN (?:RSA |EC )?PRIVATE KEY/);
  });
});

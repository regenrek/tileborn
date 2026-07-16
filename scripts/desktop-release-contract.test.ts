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
  hasUdifTrailer,
  loadDesktopReleasePolicy,
  sha256File,
  validateDesktopReleaseManifest,
  validateDesktopReleasePolicy,
} from './desktop-release-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeVerifierPath = path.join(repoRoot, 'scripts/macos-desktop-release-verifier.mjs');
const require = createRequire(import.meta.url);
const { createDesktopReleaseForgeSettings, createDesktopReleaseProvenance } =
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
    readonly createDesktopReleaseProvenance: (input: {
      readonly sourceCommit: string;
      readonly version: string;
    }) => Readonly<Record<string, unknown>>;
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
  const manifest = {
    schemaVersion: 1,
    policyId: 'tileborne-desktop-1.0',
    artifact: {
      fileName: path.basename(artifactPath),
      kind: 'dmg',
      platform: 'darwin',
      architecture: 'arm64',
      version: '1.0.0',
      sizeBytes: 1024,
      sha256: candidateSha256,
    },
    provenance: {
      sourceCommit: 'a'.repeat(40),
      buildCommand: 'pnpm --filter @tileborne/desktop package',
      builderOs: 'darwin',
      builderArchitecture: 'arm64',
      builtAt: '2026-07-16T09:00:00.000Z',
    },
  };
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

const publicationRunner = vi.fn((input: CommandInput): CommandResult => {
  expect(input.file).toBe('gh');
  expect(input.args).toEqual(['auth', 'status', '--hostname', 'github.com', '--active']);
  return { status: 0, stdout: 'active account' };
});

const evaluateReady = (
  evidence: ReturnType<typeof createEvidence>,
  options: {
    readonly requirePublication?: boolean;
    readonly nativeRunner?: ReturnType<typeof vi.fn>;
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
    },
    expectedSourceCommit: 'a'.repeat(40),
    requirePublication: options.requirePublication ?? true,
    nativeCommandRunner: options.nativeRunner ?? nativeRunnerFor(evidence),
    publicationCommandRunner: publicationRunner,
    hostPlatform: 'darwin',
    hostArchitecture: 'arm64',
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

  it('keeps the manifest closed and rejects self-asserted security evidence', () => {
    const policy = loadDesktopReleasePolicy();
    expect(() => validateDesktopReleasePolicy({ ...policy, inferredMakerSupport: true })).toThrow(
      DesktopReleaseContractError,
    );
    const { manifest } = createEvidence();
    expect(() =>
      validateDesktopReleaseManifest({
        ...manifest,
        signing: { verified: true, hardenedRuntime: true },
        notarization: { verified: true, stapled: true },
      }),
    ).toThrow(/contract\.unknown-field/);
  });

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
    };
    const nativeRunner = nativeRunnerFor(evidence);
    const status = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      retainedArtifactPath: evidence.retainedArtifactPath,
      backupArtifactPath: evidence.backupArtifactPath,
      manifest,
      installReceipt: { verified: true, mountedDmg: true, firstLaunch: true },
      rollbackReceipt: { verified: true, backup: true, projectReopen: true },
      environment: { TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1', GH_TOKEN: 'placeholder' },
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
      environment: { TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1', GH_TOKEN: 'placeholder' },
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
    expect(
      createDesktopReleaseProvenance({ sourceCommit: 'a'.repeat(40), version: '1.0.0' }),
    ).toEqual({
      schemaVersion: 1,
      policyId: 'tileborne-desktop-1.0',
      sourceCommit: 'a'.repeat(40),
      version: '1.0.0',
      buildCommand: 'pnpm --filter @tileborne/desktop package',
    });
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

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    readonly version?: string;
    readonly existsSync?: (candidate: string) => boolean;
  }) => { readonly dmg: string; readonly zip: string };
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
    candidateTeamIdentifier: string;
    embeddedSourceCommit: string;
    embeddedVersion: string;
  };
  install: {
    failureMatrix: NativeFailureFixture[];
  };
};

type NativeProjectEvidence = {
  readonly found: true;
  readonly id: string;
  readonly name: string;
  readonly engineVersion: string;
  readonly plugins: readonly { readonly id: string; readonly version: string }[];
  readonly assetPacks: readonly { readonly id: string; readonly version: string }[];
  readonly maps: readonly { readonly id: string; readonly path: string }[];
  readonly starterMap: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly layers: readonly unknown[];
    readonly objects: readonly unknown[];
    readonly properties: Readonly<Record<string, unknown>>;
  };
};

type NativeFailureFixture = {
  readonly mode: string;
  readonly rejectionState: 'error' | 'up-to-date';
  readonly diagnosticCode: string;
  readonly fixtureIdentity: {
    readonly expectedArchitecture: string;
    readonly observedArchitecture: string;
    readonly expectedBundleId: string;
    readonly observedBundleId: string;
    readonly expectedTeamIdentifier: string;
    readonly observedTeamIdentifier: string;
  };
  readonly feedMetadataRequests: number;
  readonly feedArtifactRequests: number;
  readonly projectAfterRejection: NativeProjectEvidence;
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

const createUpdateZipFixture = ({
  directory,
  updateArtifactPath,
  sourceCommit = 'a'.repeat(40),
  version = '1.0.1',
  teamIdentifier = 'ABCDEFGHIJ',
  bundleId = 'dev.tileborne.app',
}: {
  readonly directory: string;
  readonly updateArtifactPath: string;
  readonly sourceCommit?: string;
  readonly version?: string;
  readonly teamIdentifier?: string;
  readonly bundleId?: string;
}): void => {
  const stagingRoot = path.join(directory, `zip-staging-${sourceCommit.slice(0, 8)}-${version}`);
  const appPath = path.join(stagingRoot, 'Tileborne.app');
  mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(
    path.join(appPath, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Tileborne</string>
</dict></plist>
`,
  );
  writeFileSync(path.join(appPath, 'Contents', 'MacOS', 'Tileborne'), 'arm64 fixture');
  writeFileSync(
    path.join(appPath, 'Contents', 'Resources', 'tileborne-desktop-provenance.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      policyId: 'tileborne-desktop-1.0',
      sourceCommit,
      version,
      teamIdentifier,
      buildCommand: 'pnpm --filter @tileborne/desktop package',
    })}\n`,
  );
  const zip = spawnSync('/usr/bin/zip', ['-q', '-r', updateArtifactPath, path.basename(appPath)], {
    cwd: stagingRoot,
    encoding: 'utf8',
  });
  if (zip.status !== 0) {
    throw new Error(
      `failed to create ZIP fixture: ${zip.error?.message ?? zip.stderr ?? 'unknown error'}`,
    );
  }
};

const createEvidence = (
  updateFixture:
    | 'valid'
    | 'malformed'
    | 'wrong-source'
    | 'same-version'
    | 'wrong-bundle'
    | 'wrong-team' = 'valid',
) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tileborne-desktop-release-'));
  temporaryDirectories.push(directory);
  const artifactPath = path.join(directory, 'Tileborne-1.0.0-arm64.dmg');
  const updateVersion = updateFixture === 'same-version' ? '1.0.0' : '1.0.1';
  const updateArtifactPath = path.join(directory, `Tileborne-darwin-arm64-${updateVersion}.zip`);
  writeUdifFixture(artifactPath, 'A');
  if (updateFixture === 'malformed') {
    writeFileSync(updateArtifactPath, Buffer.from('signed update zip fixture'));
  } else {
    createUpdateZipFixture({
      directory,
      updateArtifactPath,
      sourceCommit: updateFixture === 'wrong-source' ? 'b'.repeat(40) : 'a'.repeat(40),
      version: updateVersion,
      teamIdentifier: updateFixture === 'wrong-team' ? 'ZZZZZZZZZZ' : 'ABCDEFGHIJ',
      bundleId: updateFixture === 'wrong-bundle' ? 'dev.tileborne.other' : 'dev.tileborne.app',
    });
  }
  const candidateSha256 = sha256File(artifactPath);
  const updateCandidateSha256 = sha256File(updateArtifactPath);
  const manifest = generateDesktopReleaseManifest({
    artifactPath,
    updateArtifactPath,
    version: '1.0.0',
    updateVersion,
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
    updateArtifactPath,
    candidateSha256,
    updateCandidateSha256,
    updateVersion,
    manifest,
  };
};

const nativeRunnerFor = (evidence: ReturnType<typeof createEvidence>) =>
  vi.fn((input: CommandInput): CommandResult => {
    if (input.file === '/usr/bin/ditto') {
      if (process.platform !== 'darwin') {
        const archivePath = input.args.at(-2);
        const extractionRoot = input.args.at(-1);
        if (archivePath === undefined || extractionRoot === undefined) {
          return { status: 1, stderr: 'invalid ditto extraction arguments' };
        }
        return spawnSync('/usr/bin/unzip', ['-q', archivePath, '-d', extractionRoot], {
          encoding: 'utf8',
        });
      }
      return spawnSync(input.file, input.args, { encoding: 'utf8' });
    }
    if (input.file === '/usr/bin/plutil') {
      const key = input.args[input.args.indexOf('-extract') + 1];
      const infoPlist = input.args[input.args.length - 1];
      const source = readFileSync(infoPlist, 'utf8');
      const value = new RegExp(`<key>${key}</key><string>([^<]+)</string>`).exec(source)?.[1];
      return value === undefined
        ? { status: 1, stderr: 'missing key' }
        : { status: 0, stdout: value };
    }
    if (input.file === '/usr/bin/lipo') {
      return { status: 0, stdout: 'arm64\n' };
    }
    if (input.file === '/usr/bin/codesign' && input.args[0] === '-dv') {
      return {
        status: 0,
        stdout:
          'Authority=Developer ID Application: Tileborne (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory v=20500 flags=0x10000(runtime)\n',
      };
    }
    if (input.file === '/usr/bin/codesign' && input.args[0] === '--verify') {
      return { status: 0, stdout: 'valid\n' };
    }
    if (input.file === '/usr/bin/xcrun' && input.args[0] === 'stapler') {
      return { status: 0, stdout: 'validated\n' };
    }
    if (input.file === '/usr/sbin/spctl') {
      return { status: 0, stdout: 'accepted\n' };
    }
    expect(input.file).toBe(process.execPath);
    expect(input.args[0]).toBe(nativeVerifierPath);
    const argument = (name: string): string => {
      const index = input.args.indexOf(name);
      if (index < 0 || input.args[index + 1] === undefined) throw new Error(`missing ${name}`);
      return input.args[index + 1]!;
    };
    expect(argument('--candidate')).toBe(evidence.artifactPath);
    expect(argument('--update-artifact')).toBe(evidence.updateArtifactPath);
    expect(argument('--failure-matrix')).toBe('1');
    const nonce = argument('--nonce');
    const projectEvidence: NativeProjectEvidence = {
      found: true,
      id: 'project:native-oracle',
      name: 'Desktop Release Oracle Persistence Payload',
      engineVersion: '1.0.0',
      plugins: [{ id: '@tileborne-plugins/battle-royale', version: '0.1.0' }],
      assetPacks: [{ id: '@tileborne/battle-royale-core', version: '0.1.0' }],
      maps: [{ id: 'map:starter', path: 'maps/map-starter.json' }],
      starterMap: {
        id: 'map:starter',
        width: 24,
        height: 24,
        tileWidth: 16,
        tileHeight: 16,
        layers: [
          {
            kind: 'tile',
            id: 'layer:11111111-1111-4111-8111-111111111111',
            name: 'oracle-authored-tiles',
            visible: true,
            opacity: 1,
            chunks: [
              {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
                tiles: [1, 2, 3, 4],
              },
            ],
          },
          {
            kind: 'object',
            id: 'layer:22222222-2222-4222-8222-222222222222',
            name: 'oracle-authored-objects',
            visible: true,
            opacity: 1,
            objectIds: ['object:33333333-3333-4333-8333-333333333333'],
          },
        ],
        objects: [
          {
            id: 'object:33333333-3333-4333-8333-333333333333',
            kind: 'gobj:44444444-4444-4444-8444-444444444444',
            x: 96,
            y: 128,
            width: 32,
            height: 48,
            layerId: 'layer:22222222-2222-4222-8222-222222222222',
            properties: {
              oraclePayload: 'desktop-release-object-v1',
              lootTier: 3,
              spawn: { team: 'blue', slot: 7 },
            },
          },
        ],
        properties: {
          starterTemplateId: 'desktop-release-oracle',
          starterSeed: 'desktop-release-oracle-persistence-payload',
          oraclePayload: 'desktop-release-persistence-v1',
        },
      },
    };
    const failureMatrix: NativeFailureFixture[] = [
      'stale-version',
      'same-version',
      'wrong-architecture',
      'wrong-bundle',
      'wrong-team',
      'malformed-metadata',
      'unavailable-feed',
      'interrupted-download',
    ].map((mode) => ({
      mode,
      rejectionState: 'error',
      diagnosticCode:
        mode === 'same-version' || mode === 'stale-version'
          ? 'non-newer-version'
          : mode === 'malformed-metadata'
            ? 'updater-error'
            : mode === 'unavailable-feed'
              ? 'feed-unavailable'
              : mode === 'wrong-architecture'
                ? 'policy-mismatch'
                : mode === 'wrong-bundle'
                  ? 'updater-error'
                  : mode === 'wrong-team'
                    ? 'signature-failed'
                    : mode === 'interrupted-download'
                      ? 'feed-unavailable'
                      : 'download-failed',
      fixtureIdentity: {
        expectedArchitecture: 'arm64',
        observedArchitecture: mode === 'wrong-architecture' ? 'x86_64' : 'arm64',
        expectedBundleId: 'dev.tileborne.app',
        observedBundleId: mode === 'wrong-bundle' ? 'dev.tileborne.other' : 'dev.tileborne.app',
        expectedTeamIdentifier: 'ABCDEFGHIJ',
        observedTeamIdentifier:
          mode === 'wrong-team' || mode === 'wrong-bundle' ? 'ad-hoc' : 'ABCDEFGHIJ',
      },
      feedMetadataRequests: mode === 'unavailable-feed' ? 0 : 1,
      feedArtifactRequests: mode === 'malformed-metadata' || mode === 'unavailable-feed' ? 0 : 1,
      projectAfterRejection: projectEvidence,
    }));
    return {
      status: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        nonce,
        candidate: {
          candidateArtifactSha256: evidence.candidateSha256,
          format: 'udif',
          candidateArchitecture: 'arm64',
          bundleId: 'dev.tileborne.app',
          embeddedSourceCommit: 'a'.repeat(40),
          embeddedVersion: '1.0.0',
          candidateEmbeddedTeamIdentifier: 'ABCDEFGHIJ',
          candidateAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
          candidateTeamIdentifier: 'ABCDEFGHIJ',
          candidateHardenedRuntime: 'runtime',
          candidateStaple: 'validated',
          candidateGatekeeper: 'accepted',
        },
        install: {
          location: 'temporary-applications',
          firstLaunchProject: projectEvidence,
          sourceVersion: '1.0.0',
          targetVersion: evidence.updateVersion,
          loopbackFeedUrl: 'http://127.0.0.1:41000/feed',
          feedMetadataRequests: 1,
          feedArtifactRequests: 1,
          relaunchProject: projectEvidence,
          failureMatrix,
        },
        update: {
          updateArtifactSha256: evidence.updateCandidateSha256,
          format: 'zip',
          updateArchitecture: 'arm64',
          bundleId: 'dev.tileborne.app',
          embeddedSourceCommit: 'a'.repeat(40),
          embeddedVersion: evidence.updateVersion,
          updateEmbeddedTeamIdentifier: 'ABCDEFGHIJ',
          updateAuthority: 'Developer ID Application: Tileborne (ABCDEFGHIJ)',
          updateTeamIdentifier: 'ABCDEFGHIJ',
          updateHardenedRuntime: 'runtime',
          updateStaple: 'validated',
          updateGatekeeper: 'accepted',
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
    if (input.file !== process.execPath) return result;
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
    updateArtifactPath: evidence.updateArtifactPath,
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
    policy: options.policy ?? loadDesktopReleasePolicy(),
  });

describe('desktop 1.0 release contract', () => {
  it('owns the exact support limitations and recovery policy', () => {
    const policy = loadDesktopReleasePolicy();
    expect(policy.candidate).toEqual({
      platform: 'darwin',
      architecture: 'arm64',
      artifactKind: 'dmg',
      updateArtifactKind: 'zip',
      updateArtifactNamePattern: 'Tileborne-darwin-arm64-${version}.zip',
      channel: 'github-release',
    });
    expect(
      policy.owners.map(({ id, owner }: { id: string; owner: string }) => [id, owner]),
    ).toEqual([
      ['updater.runtime-state-machine', 'apps/desktop/src/main/updater.ts'],
      ['updater.ipc-contract', 'packages/ipc-contracts/src/contracts/desktop-updates.ts'],
      ['updater.renderer-presentation', 'apps/desktop/src/renderer'],
      ['updater.preload-bridge', 'apps/desktop/src/preload/preload.ts'],
      ['release.packaging-provenance', 'apps/desktop/scripts/desktop-release-forge.cjs'],
      ['electron.metadata-entitlements', 'apps/desktop/electron-forge.config.cjs'],
      ['project.relaunch-persistence-semantics', 'packages/services-app/src/project'],
    ]);
    expect(
      policy.support.map(({ id, status }: { id: string; status: string }) => [id, status]),
    ).toEqual([
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
    expect(policy).not.toHaveProperty('lastKnownGoodReleases');
    expect(policy).not.toHaveProperty('rollback');
    expect(policy.requiredEvidence).toEqual(
      expect.arrayContaining([
        'verified-project-relaunch-persistence',
        'verified-signed-a-to-b-update',
      ]),
    );
    expect(policy.requiredEvidence).not.toContain('verified-project-backup');
  });

  it('rejects automatic update support demotion or promotion outside the signed oracle contract', () => {
    const policy = loadDesktopReleasePolicy();
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        support: policy.support.map((entry: { id: string; status: string }) =>
          entry.id === 'capability.auto-update' ? { ...entry, status: 'unsupported' } : entry,
        ),
      }),
    ).toThrow(/policy\.support-drift/);
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        support: policy.support.map((entry: { id: string; status: string }) =>
          entry.id === 'capability.auto-update' ? { ...entry, status: 'supported' } : entry,
        ),
      }),
    ).toThrow(/contract\.invalid-enum/);
  });

  it('rejects backup-required policy drift that the native receipt cannot prove', () => {
    const policy = loadDesktopReleasePolicy();
    expect(() =>
      validateDesktopReleasePolicy({
        ...policy,
        requiredEvidence: policy.requiredEvidence.map((evidence: string) =>
          evidence === 'verified-project-relaunch-persistence'
            ? 'verified-project-backup'
            : evidence,
        ),
      }),
    ).toThrow(/policy\.required-evidence-drift/);
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
    expect(() => validateDesktopReleasePolicy({ ...policy, rollback: {} })).toThrow(
      /contract\.unknown-field/,
    );
  });

  it('generates a deterministic closed desktop candidate manifest', () => {
    const evidence = createEvidence();
    const input = {
      artifactPath: evidence.artifactPath,
      updateArtifactPath: evidence.updateArtifactPath,
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
      updateArtifact: {
        bundleId: 'dev.tileborne.app',
        fileName: path.basename(evidence.updateArtifactPath),
        kind: 'zip',
        platform: 'darwin',
        architecture: 'arm64',
        version: '1.0.1',
        sizeBytes: statSize(evidence.updateArtifactPath),
        sha256: evidence.updateCandidateSha256,
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
      updateArtifactPath: evidence.updateArtifactPath,
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
      updateArtifactPath: evidence.updateArtifactPath,
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

    const tamperedUpdateArtifact = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      updateArtifactPath: evidence.updateArtifactPath,
      manifest: {
        ...evidence.manifest,
        updateArtifact: { ...evidence.manifest.updateArtifact, sha256: 'e'.repeat(64) },
      },
      environment: { TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ' },
      expectedSourceCommit: 'a'.repeat(40),
    });
    expect(tamperedUpdateArtifact.blockers.map(({ code }) => code)).toContain(
      'artifact.update-sha256-mismatch',
    );

    const contentTamperedUpdateArtifact = createEvidence();
    appendFileSync(contentTamperedUpdateArtifact.updateArtifactPath, Buffer.from('tampered'));
    const nativeRunner = nativeRunnerFor(contentTamperedUpdateArtifact);
    const contentTamperedUpdateStatus = evaluateReady(contentTamperedUpdateArtifact, {
      nativeRunner,
    });
    expect(contentTamperedUpdateStatus.decision).toBe('no-go');
    expect(contentTamperedUpdateStatus.blockers.map(({ code }) => code)).toContain(
      'artifact.update-sha256-mismatch',
    );
    expect(nativeRunner).not.toHaveBeenCalled();

    const wrongSource = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      updateArtifactPath: evidence.updateArtifactPath,
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
      'artifact.update-file-missing',
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
    expect(
      nativeRunner.mock.calls.filter(([input]) => input.file === process.execPath),
    ).toHaveLength(1);
    expect(publicationRunner).toHaveBeenCalledOnce();
    expect(JSON.stringify(status)).not.toContain('external-token-never-recorded');
  });

  it('rejects timeout or shallow project persistence in native failure matrix evidence', () => {
    const timeoutEvidence = createEvidence();
    const timeoutRunner = nativeRunnerWithMutation(timeoutEvidence, (output) => {
      output.install.failureMatrix[0] = {
        ...output.install.failureMatrix[0]!,
        rejectionState: 'timeout' as never,
      };
    });
    const timeoutStatus = evaluateReady(timeoutEvidence, { nativeRunner: timeoutRunner });
    expect(timeoutStatus.decision).toBe('no-go');
    expect(timeoutStatus.blockers.map(({ code }) => code)).toContain('contract.invalid-literal');

    const shallowPersistenceEvidence = createEvidence();
    const shallowPersistenceRunner = nativeRunnerWithMutation(
      shallowPersistenceEvidence,
      (output) => {
        output.install.failureMatrix[1] = {
          ...output.install.failureMatrix[1]!,
          projectAfterRejection: {
            ...output.install.failureMatrix[1]!.projectAfterRejection,
            name: 'Wrong project payload',
          },
        };
      },
    );
    const shallowPersistenceStatus = evaluateReady(shallowPersistenceEvidence, {
      nativeRunner: shallowPersistenceRunner,
    });
    expect(shallowPersistenceStatus.decision).toBe('no-go');
    expect(shallowPersistenceStatus.blockers.map(({ code }) => code)).toContain(
      'contract.invalid-literal',
    );
  });

  it('rejects wrong-architecture fixtures that lose the approved signing team', () => {
    const evidence = createEvidence();
    const runner = nativeRunnerWithMutation(evidence, (output) => {
      const wrongArchitecture = output.install.failureMatrix.find(
        ({ mode }) => mode === 'wrong-architecture',
      );
      if (wrongArchitecture === undefined) {
        throw new Error('missing wrong-architecture fixture');
      }
      (
        wrongArchitecture.fixtureIdentity as { observedTeamIdentifier: string }
      ).observedTeamIdentifier = 'ad-hoc';
    });

    const status = evaluateReady(evidence, { nativeRunner: runner });

    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toContain('contract.invalid-literal');
  });

  it('generates strictly lower stale fixture versions across patch-zero boundaries', async () => {
    const { decrementPatchVersion } = (await import('./macos-desktop-release-verifier.mjs')) as {
      readonly decrementPatchVersion: (version: string) => string;
    };

    expect(decrementPatchVersion('1.2.3')).toBe('1.2.2');
    expect(decrementPatchVersion('1.2.0')).toBe('1.1.999');
    expect(decrementPatchVersion('1.0.0')).toBe('0.999.999');
    expect(() => decrementPatchVersion('0.0.0')).toThrow(/native\.stale-version-unavailable/);
  });

  it('rejects arbitrary text even when forged true receipts are supplied', () => {
    const evidence = createEvidence();
    writeFileSync(evidence.artifactPath, 'not a dmg');
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
      updateArtifactPath: evidence.updateArtifactPath,
      manifest,
      installReceipt: { verified: true, mountedDmg: true, firstLaunch: true },
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
    expect(status.blockers.map(({ code }) => code)).toContain('artifact.format-invalid');
    expect(nativeRunner).not.toHaveBeenCalled();
  });

  it('does not let a trailer-only fake pass the real native verifier boundary', () => {
    const evidence = createEvidence();
    const status = evaluateDesktopRelease({
      artifactPath: evidence.artifactPath,
      updateArtifactPath: evidence.updateArtifactPath,
      manifest: evidence.manifest,
      environment: { TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ' },
      expectedSourceCommit: 'a'.repeat(40),
      requirePublication: false,
    });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.some(({ code }) => code.startsWith('native.'))).toBe(true);
  });

  it('rejects forged verifier stdout and mismatched native provenance', () => {
    const evidence = createEvidence();
    const forgedRunner = vi.fn((input: CommandInput): CommandResult => {
      const nonce = input.args[input.args.indexOf('--nonce') + 1];
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          nonce,
          verified: true,
          signed: true,
          notarized: true,
          launched: true,
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
  });

  it('rejects malformed and cross-build update ZIP artifacts while allowing same-release bundles', () => {
    const malformed = createEvidence('malformed');
    const malformedStatus = evaluateReady(malformed, { nativeRunner: nativeRunnerFor(malformed) });
    expect(malformedStatus.decision).toBe('no-go');
    expect(malformedStatus.blockers.map(({ code }) => code)).toContain(
      'artifact.update-format-invalid',
    );

    const wrongSource = createEvidence('wrong-source');
    const wrongSourceStatus = evaluateReady(wrongSource, {
      nativeRunner: nativeRunnerFor(wrongSource),
    });
    expect(wrongSourceStatus.decision).toBe('no-go');
    expect(wrongSourceStatus.blockers.map(({ code }) => code)).toContain(
      'contract.invalid-literal',
    );

    const sameVersion = createEvidence('same-version');
    const sameVersionStatus = evaluateReady(sameVersion, {
      nativeRunner: nativeRunnerFor(sameVersion),
    });
    expect(sameVersionStatus.decision).toBe('go');

    const wrongBundle = createEvidence('wrong-bundle');
    const wrongBundleStatus = evaluateReady(wrongBundle, {
      nativeRunner: nativeRunnerFor(wrongBundle),
    });
    expect(wrongBundleStatus.decision).toBe('no-go');
    expect(wrongBundleStatus.blockers.map(({ code }) => code)).toContain(
      'contract.invalid-literal',
    );

    const wrongTeam = createEvidence('wrong-team');
    const wrongTeamStatus = evaluateReady(wrongTeam, {
      nativeRunner: nativeRunnerFor(wrongTeam),
    });
    expect(wrongTeamStatus.decision).toBe('no-go');
    expect(wrongTeamStatus.blockers.map(({ code }) => code)).toContain('contract.invalid-literal');
  });

  it('rejects a validly structured native result from the wrong Apple team', () => {
    const evidence = createEvidence();
    const wrongTeamRunner = nativeRunnerWithMutation(evidence, (output) => {
      output.candidate.candidateEmbeddedTeamIdentifier = 'ZZZZZZZZZZ';
      output.candidate.candidateTeamIdentifier = 'ZZZZZZZZZZ';
    });
    const status = evaluateReady(evidence, { nativeRunner: wrongTeamRunner });
    expect(status.decision).toBe('no-go');
    expect(status.blockers.map(({ code }) => code)).toContain('contract.invalid-literal');
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
      updateArtifactPath: evidence.updateArtifactPath,
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

  it('binds Forge release mode to one existing macOS-arm64 DMG plus deterministic update ZIP', () => {
    const valid = [
      {
        platform: 'darwin',
        arch: 'arm64',
        artifacts: ['/release/Tileborne.dmg'],
      },
      {
        platform: 'darwin',
        arch: 'arm64',
        artifacts: ['/release/Tileborne-darwin-arm64-1.0.0.zip'],
      },
    ];
    expect(
      validateDesktopReleaseMakeResults({
        makeResults: valid,
        provenanceInjected: true,
        version: '1.0.0',
        existsSync: (candidate) =>
          candidate === '/release/Tileborne.dmg' ||
          candidate === '/release/Tileborne-darwin-arm64-1.0.0.zip',
      }),
    ).toEqual({
      dmg: '/release/Tileborne.dmg',
      zip: '/release/Tileborne-darwin-arm64-1.0.0.zip',
    });

    const invalidInputs = [
      { makeResults: undefined, provenanceInjected: true, version: '1.0.0' },
      { makeResults: [], provenanceInjected: true, version: '1.0.0' },
      { makeResults: [valid[0]], provenanceInjected: true, version: '1.0.0' },
      { makeResults: [...valid, ...valid], provenanceInjected: true, version: '1.0.0' },
      {
        makeResults: [
          { platform: 'win32', arch: 'arm64', artifacts: ['/release/Tileborne.dmg'] },
          valid[1],
        ],
        provenanceInjected: true,
        version: '1.0.0',
      },
      {
        makeResults: [
          { platform: 'darwin', arch: 'x64', artifacts: ['/release/Tileborne.dmg'] },
          valid[1],
        ],
        provenanceInjected: true,
        version: '1.0.0',
      },
      {
        makeResults: [{ platform: 'darwin', arch: 'arm64', artifacts: [] }, valid[1]],
        provenanceInjected: true,
        version: '1.0.0',
      },
      {
        makeResults: [{ platform: 'darwin', arch: 'arm64' }, valid[1]],
        provenanceInjected: true,
        version: '1.0.0',
      },
      {
        makeResults: [
          { platform: 'darwin', arch: 'arm64', artifacts: ['/release/a.dmg', '/release/b.dmg'] },
          valid[1],
        ],
        provenanceInjected: true,
        version: '1.0.0',
      },
      {
        makeResults: [
          { platform: 'darwin', arch: 'arm64', artifacts: ['/release/Tileborne.zip'] },
          valid[0],
        ],
        provenanceInjected: true,
        version: '1.0.0',
      },
      {
        makeResults: [
          {
            platform: 'darwin',
            arch: 'arm64',
            artifacts: ['/release/Tileborne.dmg'],
          },
          { platform: 'darwin', arch: 'arm64', artifacts: ['/release/Tileborne-1.0.0.zip'] },
        ],
        provenanceInjected: true,
        version: '1.0.0',
      },
      { makeResults: valid, provenanceInjected: false, version: '1.0.0' },
      { makeResults: valid, provenanceInjected: true },
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
        version: '1.0.0',
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
      '--update-artifact',
      evidence.updateArtifactPath,
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
        updateArtifactPath: evidence.updateArtifactPath,
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

  it('contains no credential values or rollback-only verifier paths', () => {
    const policySource = readFileSync(
      path.join(repoRoot, 'scripts/desktop-release-policy.json'),
      'utf8',
    );
    const nativeVerifierSource = readFileSync(
      path.join(repoRoot, 'scripts/macos-desktop-release-verifier.mjs'),
      'utf8',
    );
    expect(`${policySource}\n${nativeVerifierSource}`).not.toMatch(
      /BEGIN (?:RSA |EC )?PRIVATE KEY/,
    );
    expect(nativeVerifierSource).not.toMatch(
      /retained|rollback|backup-output|retainedArtifact|backupSha256|reopenedProjectId|verified-project-backup/,
    );
  });
});

function statSize(filePath: string): number {
  return readFileSync(filePath).byteLength;
}

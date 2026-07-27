import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RELEASE_SUBPROCESS_ENVIRONMENT,
  createNotaryHistoryInvocation,
  createReleaseSubprocessEnvironment,
  deriveBinaryDecision,
  deriveCloseoutBlockerCodes,
  deriveCloseoutExternalOwners,
  outputDirectories,
  validateStableGateReceiptForCloseout,
} from './native-desktop-release-closeout.mjs';
import { createReleaseGateReceipt, selectReleaseGates } from './release-gates.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

const ready = {
  canonicalDecision: 'go',
  developerIdSignature: 'valid',
  hardenedRuntime: 'enabled',
  notarizationStaple: 'valid',
  gatekeeper: 'accepted',
  creatorSmoke: 'passed',
  artifactDigest: 'a'.repeat(64),
  updateArtifactDigest: 'b'.repeat(64),
  embeddedProvenance: 'valid',
} as const;

describe('native desktop binary closeout decision', () => {
  it('allows GO only when every required contract is genuinely satisfied', () => {
    expect(deriveBinaryDecision(ready)).toEqual({ decision: 'go', blockers: [] });
  });

  it.each([
    ['canonicalDecision', 'no-go', 'contract.not-go'],
    ['developerIdSignature', 'invalid', 'signing.developer-id-invalid'],
    ['hardenedRuntime', 'missing', 'signing.hardened-runtime-missing'],
    ['notarizationStaple', 'invalid', 'notarization.staple-invalid'],
    ['gatekeeper', 'rejected', 'gatekeeper.assessment-rejected'],
    ['creatorSmoke', 'failed', 'native.creator-smoke-failed'],
    ['artifactDigest', 'not-a-digest', 'artifact.sha256-invalid'],
    ['updateArtifactDigest', 'not-a-digest', 'artifact.update-sha256-invalid'],
    ['embeddedProvenance', 'missing', 'native.embedded-provenance-missing'],
    ['embeddedProvenance', 'invalid', 'native.embedded-provenance-invalid'],
  ] as const)('fails closed when %s is not ready', (field, value, blocker) => {
    const result = deriveBinaryDecision({ ...ready, [field]: value });
    expect(result.decision).toBe('no-go');
    expect(result.blockers).toContain(blocker);
  });
});

describe('native desktop closeout preflight', () => {
  const releaseEnvironment = {
    TILEBORNE_DESKTOP_RELEASE: '1',
    TILEBORNE_APPLE_SIGNING_IDENTITY: 'Developer ID Application: Tileborne Release (ABCDEFGHIJ)',
    TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
    TILEBORNE_APPLE_API_KEY_PATH: '/external/AuthKey_ABC1234567.p8',
    TILEBORNE_APPLE_API_KEY_ID: 'KLMNOPQRST',
    TILEBORNE_APPLE_API_ISSUER: '12345678-1234-1234-1234-123456789abc',
    TILEBORNE_DESKTOP_PUBLISH_APPROVED: '1',
    GH_TOKEN: 'must-not-propagate',
    NODE_OPTIONS: '--require secret-hook',
  } as const;

  it('passes only release credential references to Forge and notary subprocesses', () => {
    const env = createReleaseSubprocessEnvironment(releaseEnvironment);
    expect(Object.keys(env).sort()).toEqual([...RELEASE_SUBPROCESS_ENVIRONMENT].sort());
    expect(env).toEqual({
      TILEBORNE_DESKTOP_RELEASE: '1',
      TILEBORNE_APPLE_SIGNING_IDENTITY: 'Developer ID Application: Tileborne Release (ABCDEFGHIJ)',
      TILEBORNE_APPLE_TEAM_ID: 'ABCDEFGHIJ',
      TILEBORNE_APPLE_API_KEY_PATH: '/external/AuthKey_ABC1234567.p8',
      TILEBORNE_APPLE_API_KEY_ID: 'KLMNOPQRST',
      TILEBORNE_APPLE_API_ISSUER: '12345678-1234-1234-1234-123456789abc',
    });
    expect(JSON.stringify(env)).not.toContain('must-not-propagate');
    expect(JSON.stringify(env)).not.toContain('secret-hook');

    const notary = createNotaryHistoryInvocation(env);
    expect(notary.args).toEqual([
      'notarytool',
      'history',
      '--key',
      '/external/AuthKey_ABC1234567.p8',
      '--key-id',
      'KLMNOPQRST',
      '--issuer',
      '12345678-1234-1234-1234-123456789abc',
    ]);
    expect(notary.receiptCommand).toEqual([
      '/usr/bin/xcrun',
      'notarytool',
      'history',
      '--key',
      '$TILEBORNE_APPLE_API_KEY_PATH',
      '--key-id',
      '$TILEBORNE_APPLE_API_KEY_ID',
      '--issuer',
      '$TILEBORNE_APPLE_API_ISSUER',
    ]);
    expect(JSON.stringify(notary.receiptCommand)).not.toContain('/external/AuthKey');
    expect(JSON.stringify(notary.receiptCommand)).not.toContain('KLMNOPQRST');
    expect(JSON.stringify(notary.receiptCommand)).not.toContain('12345678-1234');
  });

  it.each([
    ['TILEBORNE_DESKTOP_RELEASE', '0', /release\.flag-invalid/],
    [
      'TILEBORNE_APPLE_SIGNING_IDENTITY',
      'Apple Development: Tileborne',
      /release\.identity-invalid/,
    ],
    ['TILEBORNE_APPLE_TEAM_ID', 'bad-team', /release\.team-id-invalid/],
    ['TILEBORNE_APPLE_API_KEY_PATH', '', /release\.credentials-missing/],
    ['TILEBORNE_APPLE_API_KEY_ID', 'bad-key', /release\.api-key-id-invalid/],
    ['TILEBORNE_APPLE_API_ISSUER', 'not-a-uuid', /release\.api-issuer-invalid/],
  ] as const)('fails closed when %s is invalid', (name, value, message) => {
    expect(() =>
      createReleaseSubprocessEnvironment({ ...releaseEnvironment, [name]: value }),
    ).toThrow(message);
  });

  it('permits only the tracked fixture dist input and rejects real build outputs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tileborne-closeout-preflight-'));
    temporaryRoots.push(root);
    await Promise.all([
      mkdir(path.join(root, 'packages/test-fixtures/fixtures/plugins/smoke-fixture/dist'), {
        recursive: true,
      }),
      mkdir(path.join(root, 'packages/core/dist'), { recursive: true }),
      mkdir(path.join(root, 'apps/desktop/out'), { recursive: true }),
    ]);

    expect(outputDirectories(root)).toEqual(['apps/desktop/out', 'packages/core/dist']);
  });

  it('passes clean-checkout source provenance through Turbo builds', async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '..');
    const cleanCheckoutScript = await readFile(
      path.join(repositoryRoot, 'scripts/clean-checkout-smoke.sh'),
      'utf8',
    );
    const turboConfig = JSON.parse(
      await readFile(path.join(repositoryRoot, 'turbo.json'), 'utf8'),
    ) as { globalEnv?: unknown };

    expect(cleanCheckoutScript).toContain('export TILEBORNE_SOURCE_COMMIT');
    expect(cleanCheckoutScript).toContain('launch_cmd+=(-- --no-sandbox)');
    expect(turboConfig.globalEnv).toContain('TILEBORNE_SOURCE_COMMIT');
  });
});

describe('native desktop closeout receipt evidence', () => {
  it('keeps a verified candidate blocked only by publication when notary credentials verify', () => {
    const blockerCodes = deriveCloseoutBlockerCodes({
      binaryBlockers: ['contract.not-go'],
      canonicalBlockers: ['publish.approval-missing', 'publish.credential-missing'],
      notaryCredentials: 'available',
    });

    expect(blockerCodes).toEqual(['publish.approval-missing', 'publish.credential-missing']);
    expect(blockerCodes).not.toContain('notarization.credentials-missing');
    expect(blockerCodes).not.toContain('signing.approved-team-missing');
    expect(blockerCodes).not.toContain('rollback.retained-artifact-missing');
    expect(deriveCloseoutExternalOwners(blockerCodes).map(({ blocker }) => blocker)).toEqual([
      'publish.approval-missing',
      'publish.credential-missing',
    ]);
  });

  it('keeps the notary owner only when credential evidence is missing', () => {
    const blockerCodes = deriveCloseoutBlockerCodes({
      binaryBlockers: [],
      canonicalBlockers: [],
      notaryCredentials: 'missing',
    });

    expect(blockerCodes).toEqual(['notarization.credentials-missing']);
    expect(deriveCloseoutExternalOwners(blockerCodes).map(({ blocker }) => blocker)).toEqual([
      'notarization.credentials-missing',
    ]);
  });

  it('reuses a SHA- and lockfile-bound stable gate receipt for closeout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tileborne-stable-receipt-'));
    temporaryRoots.push(root);
    await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfile\n');
    const receiptPath = path.join(root, 'stable-gate-receipt.json');
    const receipt = createReleaseGateReceipt({
      profile: 'stable',
      sourceSha: 'a'.repeat(40),
      lockfileHash: 'sha256:3d0abe3e8f9631c12a42e96531a6a0727a4752fb15508ebf30dca059607f498d',
      nodeVersion: 'v22.0.0',
      packageManagerVersion: '11.8.0',
      startedAt: '2026-07-27T10:00:00.000Z',
      finishedAt: '2026-07-27T10:01:00.000Z',
      gateResults: selectReleaseGates('stable').map(({ id }) => ({
        id,
        status: 'passed',
        startedAt: '2026-07-27T10:00:00.000Z',
        finishedAt: '2026-07-27T10:00:01.000Z',
      })),
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const commandReceipt = validateStableGateReceiptForCloseout({
      receiptPath,
      checkoutRoot: root,
      sourceSha: 'a'.repeat(40),
    });

    expect(commandReceipt.reusedReceipt).toMatchObject({
      path: receiptPath,
      profile: 'stable',
      sourceSha: 'a'.repeat(40),
      gateCount: selectReleaseGates('stable').length,
    });
    expect(commandReceipt.command).toEqual([
      'node',
      'scripts/release-gates.mjs',
      'run-profile',
      'stable',
      '--receipt',
      receiptPath,
    ]);
  });
});

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveBinaryDecision, outputDirectories } from './native-desktop-release-closeout.mjs';

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
    ['embeddedProvenance', 'missing', 'native.embedded-provenance-missing'],
    ['embeddedProvenance', 'invalid', 'native.embedded-provenance-invalid'],
  ] as const)('fails closed when %s is not ready', (field, value, blocker) => {
    const result = deriveBinaryDecision({ ...ready, [field]: value });
    expect(result.decision).toBe('no-go');
    expect(result.blockers).toContain(blocker);
  });
});

describe('native desktop closeout preflight', () => {
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

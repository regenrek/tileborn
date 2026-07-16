import { describe, expect, it } from 'vitest';

import { deriveBinaryDecision } from './native-desktop-release-closeout.mjs';

const ready = {
  canonicalDecision: 'go',
  developerIdSignature: 'valid',
  hardenedRuntime: 'enabled',
  notarizationStaple: 'valid',
  gatekeeper: 'accepted',
  creatorSmoke: 'passed',
  artifactDigest: 'a'.repeat(64),
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
  ] as const)('fails closed when %s is not ready', (field, value, blocker) => {
    const result = deriveBinaryDecision({ ...ready, [field]: value });
    expect(result.decision).toBe('no-go');
    expect(result.blockers).toContain(blocker);
  });
});

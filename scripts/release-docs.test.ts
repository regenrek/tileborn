import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const documentation = {
  runbook: read('docs/desktop-release-runbook.md'),
  audit: read('docs/desktop-release-capability-audit.md'),
  release: read('RELEASE.md'),
  changelog: read('CHANGELOG.md'),
  security: read('SECURITY.md'),
  desktop: read('apps/desktop/README.md'),
  sdk: read('packages/game-sdk/README.md'),
  creator: read('docs/battle-royale-creator-guide.md'),
  creatorEvidence: read('docs/battle-royale-release-evidence.md'),
  site: read('apps/docs/src/content/docs/desktop-release/index.md'),
  siteSecurity: read('apps/docs/src/content/docs/security/index.md'),
};

const policy = JSON.parse(read('scripts/desktop-release-policy.json')) as {
  support: Array<{ id: string; status: string }>;
};

describe('desktop release documentation contract', () => {
  it('renders every machine-owned support decision in the canonical runbook', () => {
    expect(documentation.runbook).toContain('desktop distribution is **NO-GO**');
    expect(documentation.runbook).toContain('Forge configuration as evidence');
    for (const entry of policy.support) {
      const vocabulary =
        entry.status === 'candidate'
          ? ['macOS arm64', 'Candidate']
          : entry.id === 'platform.macos-x64'
            ? ['macOS x64', 'Unsupported']
            : entry.id === 'platform.windows'
              ? ['Windows x64/arm64', 'Unsupported']
              : entry.id === 'platform.linux'
                ? ['Linux x64/arm64', 'Unsupported']
                : entry.id === 'capability.auto-update'
                  ? ['Automatic or in-app desktop update', 'Unsupported']
                  : entry.id === 'capability.remote-crash-reporting'
                    ? ['Remote crash reporting', 'Unsupported']
                    : ['GitHub Release publication', 'Operator-blocked'];
      for (const token of vocabulary) expect(documentation.runbook).toContain(token);
    }
  });

  it('documents stable evidence-free blockers and independent native verification', () => {
    for (const blocker of [
      'artifact.manifest-missing',
      'artifact.file-missing',
      'rollback.retained-artifact-missing',
      'rollback.backup-output-missing',
      'signing.approved-team-missing',
      'publish.approval-missing',
      'publish.credential-missing',
    ]) {
      expect(documentation.runbook).toContain(blocker);
    }
    expect(documentation.runbook).toContain('no caller-provided native receipt is accepted');
    expect(documentation.runbook).toContain('lastKnownGoodReleases');
    expect(documentation.runbook).toContain('TILEBORNE_DESKTOP_PUBLISH_APPROVED=1');
    expect(documentation.runbook).toContain('gh auth status --hostname github.com --active');
  });

  it('keeps creator, SDK, security, handoff, and site prose honest', () => {
    for (const text of [
      documentation.audit,
      documentation.release,
      documentation.desktop,
      documentation.creator,
      documentation.creatorEvidence,
      documentation.site,
    ]) {
      expect(text).toContain('NO-GO');
    }
    expect(documentation.sdk).toContain('does not imply desktop platform support');
    expect(documentation.security).toContain('Desktop release credentials and private evidence');
    expect(documentation.siteSecurity).toContain('Desktop release secrets and private evidence');
    expect(documentation.changelog).toContain('Forge maker');
    expect(documentation.changelog).toContain('entries no longer imply Windows');
    expect(documentation.release).toContain('automatic desktop update/rollback');
  });

  it('keeps all newly introduced local documentation targets tracked and resolvable', () => {
    for (const relativePath of [
      'docs/desktop-release-runbook.md',
      'docs/desktop-release-capability-audit.md',
      'apps/docs/src/content/docs/desktop-release/index.md',
      'apps/docs/src/content/docs/release-readiness/index.md',
      'apps/docs/src/content/docs/gameplay-behaviors/index.md',
    ]) {
      expect(existsSync(path.join(repoRoot, relativePath)), relativePath).toBe(true);
    }
    expect(read('.gitignore')).toContain('!/docs/desktop-release-runbook.md');
  });

  it('publishes replayable policy, artifact, performance, and handoff commands', () => {
    for (const command of [
      'pnpm release:desktop:policy',
      'pnpm release:desktop:status',
      'pnpm --filter @tileborne/desktop package',
      'node scripts/desktop-release-contract.mjs status',
      'node scripts/desktop-release-contract.mjs verify',
      'pnpm release:gate -- creator-performance',
      'pnpm --filter @tileborne/desktop test:creator-performance-native',
      'pnpm release:gates',
      'pnpm docs:build',
    ]) {
      expect(documentation.runbook).toContain(command);
    }
  });
});

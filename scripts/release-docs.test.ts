import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateDesktopRelease, loadDesktopReleasePolicy } from './desktop-release-contract.mjs';
import {
  assertCanonicalReleaseDocumentation,
  assertReleaseDocumentation,
  loadReleaseDocumentationSurfaces,
} from './release-docs-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const policy = loadDesktopReleasePolicy();
const baselineStatus = evaluateDesktopRelease({ policy, environment: {} });
const canonicalSurfaces = loadReleaseDocumentationSurfaces();

const mutated = (relativePath: string, transform: (source: string) => string) => ({
  ...canonicalSurfaces,
  [relativePath]: transform(canonicalSurfaces[relativePath]!),
});

const assertMutatedContractFails = (surfaces: Record<string, string>, code: string) => {
  expect(() => assertReleaseDocumentation({ surfaces, policy, baselineStatus })).toThrow(code);
};

describe('desktop release documentation contract', () => {
  it('derives the full support and exact evidence-free blocker projections from canonical data', () => {
    expect(assertCanonicalReleaseDocumentation()).toEqual({
      stateSurfaces: 11,
      auditedSurfaces: 14,
      supportDecisions: policy.support.length,
      baselineBlockers: baselineStatus.blockers.length,
    });
    expect(baselineStatus.decision).toBe('no-go');
    expect(baselineStatus.blockers).toHaveLength(7);
  });

  it('keeps the unreleased RC state and all newly introduced local targets resolvable', () => {
    expect(canonicalSurfaces['CHANGELOG.md']).toMatch(/^## \[1\.0\.0-rc\.0\] - Unreleased$/m);
    expect(canonicalSurfaces['CHANGELOG.md']).not.toMatch(
      /^## \[1\.0\.0-rc\.0\] - \d{4}-\d{2}-\d{2}$/m,
    );
    for (const relativePath of [
      'docs/desktop-release-runbook.md',
      'docs/desktop-release-capability-audit.md',
      'apps/docs/src/content/docs/desktop-release/index.md',
      'apps/docs/src/content/docs/release-readiness/index.md',
      'apps/docs/src/content/docs/gameplay-behaviors/index.md',
    ]) {
      expect(existsSync(path.join(repoRoot, relativePath)), relativePath).toBe(true);
    }
    expect(readFileSync(path.join(repoRoot, '.gitignore'), 'utf8')).toContain(
      '!/docs/desktop-release-runbook.md',
    );
  });

  it('retains the replayable commands, privacy boundary, and independent evidence vocabulary', () => {
    const runbook = canonicalSurfaces['docs/desktop-release-runbook.md']!;
    for (const command of [
      'pnpm release:desktop:policy',
      'pnpm release:desktop:status',
      'pnpm release:desktop:docs',
      'pnpm --filter @tileborne/desktop package',
      'node scripts/desktop-release-contract.mjs status',
      'node scripts/desktop-release-contract.mjs verify',
      'pnpm release:gate -- creator-performance',
      'pnpm --filter @tileborne/desktop test:creator-performance-native',
      'pnpm release:gates',
      'pnpm docs:build',
    ]) {
      expect(runbook).toContain(command);
    }
    expect(runbook).toContain('no caller-provided native receipt is accepted');
    expect(runbook).toContain('lastKnownGoodReleases');
    expect(runbook).toContain('TILEBORNE_DESKTOP_PUBLISH_APPROVED=1');
    expect(runbook).toContain('gh auth status --hostname github.com --active');
  });

  it.each([
    ['Windows support', 'Windows is supported.'],
    ['Linux support', 'Linux is supported.'],
    ['automatic update support', 'Automatic updates are supported.'],
    ['remote crash support', 'Remote crash reporting is supported.'],
    ['desktop GO', 'Desktop release is GO.'],
    ['completed publication', 'Publication is complete.'],
    ['self-asserted evidence', 'Caller-provided native receipt is accepted.'],
  ])('rejects a contradictory %s claim on any audited surface', (_label, claim) => {
    assertMutatedContractFails(
      mutated('README.md', (source) => `${source}\n${claim}\n`),
      'release-docs.contradictory-claim',
    );
  });

  it('rejects support marker drift instead of maintaining a second test-side matrix', () => {
    assertMutatedContractFails(
      mutated('docs/desktop-release-runbook.md', (source) =>
        source.replace(
          '- `platform.windows` (`Windows`): `unsupported`',
          '- `platform.windows` (`Windows`): `supported`',
        ),
      ),
      'release-docs.canonical-list-drift',
    );
  });

  it('rejects a missing, extra, reordered, or renamed evidence-free blocker', () => {
    for (const transform of [
      (source: string) => source.replace('- `artifact.file-missing`\n', ''),
      (source: string) =>
        source.replace(
          '- `artifact.file-missing`',
          '- `artifact.file-missing`\n- `artifact.self-asserted-receipt`',
        ),
      (source: string) =>
        source.replace(
          '- `artifact.manifest-missing`\n- `artifact.file-missing`',
          '- `artifact.file-missing`\n- `artifact.manifest-missing`',
        ),
      (source: string) =>
        source.replace('- `artifact.file-missing`', '- `artifact.candidate-missing`'),
    ]) {
      assertMutatedContractFails(
        mutated('docs/desktop-release-runbook.md', transform),
        'release-docs.canonical-list-drift',
      );
    }
  });

  it('rejects a dated or weakened release-candidate state', () => {
    assertMutatedContractFails(
      mutated('CHANGELOG.md', (source) =>
        source.replace('## [1.0.0-rc.0] - Unreleased', '## [1.0.0-rc.0] - 2026-06-15'),
      ),
      'release-docs.changelog-state-drift',
    );
    assertMutatedContractFails(
      mutated('README.md', (source) => source.replace('unreleased', 'available')),
      'release-docs.release-state-drift',
    );
  });
});

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateDesktopRelease, loadDesktopReleasePolicy } from './desktop-release-contract.mjs';
import {
  assertCanonicalReleaseDocumentation,
  assertReleaseDocumentation,
  loadReleaseDocumentationSurfaces,
  releaseStateSentence,
  releaseStateSurfacePaths,
} from './release-docs-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const policy = loadDesktopReleasePolicy();
const baselineStatus = evaluateDesktopRelease({ policy, environment: {} });
const releaseVersion = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
).version as string;
const canonicalSurfaces = loadReleaseDocumentationSurfaces();

const contradictionForStatus = (status: string) =>
  status === 'candidate' ? 'go' : status === 'unsupported' ? 'supported' : 'complete';

const supportContradictionCases = policy.support.flatMap((support) => {
  const decision = contradictionForStatus(support.status);
  return [
    { name: `${support.id} policy id`, identity: support.id, decision },
    {
      name: `${support.id} documentation label`,
      identity: support.documentationLabel,
      decision,
    },
  ];
});

const supportListCases = policy.support.flatMap((support) => [
  { name: `${support.id} policy id`, identity: support.id, decision: support.status },
  {
    name: `${support.id} documentation label`,
    identity: support.documentationLabel,
    decision: support.status,
  },
]);

const qualifiedDecisionCases = supportContradictionCases.flatMap((supportCase) =>
  [
    `${supportCase.decision}.`,
    `${supportCase.decision}: approved`,
    `${supportCase.decision} — approved`,
    `${supportCase.decision} (approved)`,
    `  ${supportCase.decision.toLocaleUpperCase()}   :   approved  `,
  ].map((decision) => ({ ...supportCase, decision })),
);

const mutated = (relativePath: string, transform: (source: string) => string) => {
  const original = canonicalSurfaces[relativePath]!;
  const changed = transform(original);
  expect(changed, `mutation must change ${relativePath}`).not.toBe(original);
  return { ...canonicalSurfaces, [relativePath]: changed };
};

const assertMutatedContractFails = (surfaces: Record<string, string>, code: string) => {
  expect(() =>
    assertReleaseDocumentation({ surfaces, policy, baselineStatus, releaseVersion }),
  ).toThrow(code);
};

describe('desktop release documentation contract', () => {
  it('derives the full support and exact evidence-free blocker projections from canonical data', () => {
    expect(assertCanonicalReleaseDocumentation()).toEqual({
      stateSurfaces: 11,
      auditedSurfaces: 31,
      supportDecisions: policy.support.length,
      baselineBlockers: baselineStatus.blockers.length,
    });
    expect(baselineStatus.decision).toBe('no-go');
    expect(baselineStatus.blockers).toHaveLength(6);
  });

  it('keeps the dated source-preview state and all newly introduced local targets resolvable', () => {
    expect(canonicalSurfaces['CHANGELOG.md']).toMatch(/^## \[0\.0\.1\] - 2026-07-16$/m);
    expect(canonicalSurfaces['CHANGELOG.md']).not.toMatch(/^## \[0\.0\.1\] - Unreleased$/m);
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
    expect(runbook).toContain('TILEBORNE_DESKTOP_PUBLISH_APPROVED=1');
    expect(runbook).toContain('gh auth status --hostname github.com --active');
    expect(runbook).toContain('This is recovery, not a verified desktop rollback guarantee.');
    expect(runbook).not.toContain('--retained-artifact');
    expect(runbook).not.toContain('--backup-output');
  });

  it.each([
    ['Windows support', 'Windows is supported.'],
    ['Linux support', 'Linux is supported.'],
    ['automatic update support', 'Automatic updates are supported.'],
    ['automatic update unsupported', 'Automatic desktop updates are unsupported.'],
    [
      'grouped automatic update unsupported',
      'Windows, Linux, automatic desktop updates, and remote crash reporting are unsupported.',
    ],
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

  it('rejects the reviewer-provided visible support-table contradiction', () => {
    assertMutatedContractFails(
      mutated('docs/desktop-release-runbook.md', (source) =>
        source.replace(
          /(\|\s*`platform\.windows`\s*\|\s*Windows\s*\|\s*)`unsupported`/,
          '$1Supported',
        ),
      ),
      'release-docs.canonical-list-drift',
    );
  });

  it('rejects the reviewer-provided renamed visible blocker row', () => {
    assertMutatedContractFails(
      mutated('docs/desktop-release-runbook.md', (source) =>
        source.replace('`artifact.file-missing`', '`artifact.candidate-missing`'),
      ),
      'release-docs.canonical-list-drift',
    );
  });

  it('rejects source-plan drift back to release-owned project backup evidence', () => {
    assertMutatedContractFails(
      mutated(
        '.planr/plans/product/macos-arm64-desktop-release-candidate-for-github-distribution/PRODUCT_SPEC.md',
        (source) => `${source}\n- Open a verified project backup after install.\n`,
      ),
      'release-docs.project-recovery-evidence-drift',
    );
  });

  it('rejects source-plan drift claiming a signed automatic-update channel is supported', () => {
    assertMutatedContractFails(
      mutated(
        '.planr/plans/product/macos-arm64-desktop-release-candidate-for-github-distribution/ADRS.md',
        (source) =>
          `${source}\nThe first direct-download release supports a signed automatic-update channel.\n`,
      ),
      'release-docs.contradictory-claim',
    );
  });

  it('rejects the reviewer-provided duplicate contradictory support marker block', () => {
    assertMutatedContractFails(
      mutated(
        'docs/desktop-release-runbook.md',
        (source) => `${source}
<!-- desktop-release-support:start -->
| Policy id | Surface | Status | Reason |
| --- | --- | --- | --- |
| \`platform.windows\` | Windows | \`supported\` | contradictory duplicate |
<!-- desktop-release-support:end -->
`,
      ),
      'release-docs.marker-cardinality',
    );
  });

  it('rejects duplicate, nested, malformed, and extra marker tokens', () => {
    for (const transform of [
      (source: string) =>
        source.replace(
          '<!-- desktop-release-support:start -->',
          '<!-- desktop-release-support:start -->\n<!-- desktop-release-support:start -->',
        ),
      (source: string) =>
        source.replace(
          '<!-- desktop-release-support:end -->',
          '<!-- desktop-release-support:end -->\n<!-- desktop-release-support:end -->',
        ),
      (source: string) =>
        source.replace(
          '<!-- desktop-release-support:end -->',
          '<!-- desktop-release-support:unexpected -->\n<!-- desktop-release-support:end -->',
        ),
      (source: string) =>
        `${source}\n<!-- desktop-release-baseline-blockers:start --><!-- desktop-release-baseline-blockers:end -->\n`,
    ]) {
      assertMutatedContractFails(
        mutated('docs/desktop-release-runbook.md', transform),
        'release-docs.marker-cardinality',
      );
    }
  });

  it('rejects contradictory or renamed fact tables outside canonical markers', () => {
    assertMutatedContractFails(
      mutated(
        'docs/desktop-release-runbook.md',
        (source) => `${source}\n| Surface | Status |\n| --- | --- |\n| Windows | Supported |\n`,
      ),
      'release-docs.unbound-support-table',
    );
    assertMutatedContractFails(
      mutated(
        'docs/desktop-release-runbook.md',
        (source) =>
          `${source}\n| Blocker | Meaning |\n| --- | --- |\n| \`artifact.candidate-missing\` | renamed |\n`,
      ),
      'release-docs.unbound-blocker-table',
    );
  });

  it.each(supportContradictionCases)(
    'rejects an unbound contradictory table row for $name',
    ({ identity, decision }) => {
      assertMutatedContractFails(
        mutated(
          'docs/desktop-release-runbook.md',
          (source) =>
            `${source}\nPolicy identity | Decision\n--- | ---\n\`${identity}\` | \`${decision}\`\n`,
        ),
        'release-docs.unbound-support-table',
      );
    },
  );

  it.each(supportListCases)(
    'rejects an unbound decision list row for $name',
    ({ identity, decision }) => {
      assertMutatedContractFails(
        mutated(
          'docs/desktop-release-runbook.md',
          (source) => `${source}\n- \`${identity}\`: \`${decision}\`\n`,
        ),
        'release-docs.unbound-support-table',
      );
    },
  );

  it.each(qualifiedDecisionCases)(
    'rejects a punctuated or qualified table decision for $name: $decision',
    ({ identity, decision }) => {
      assertMutatedContractFails(
        mutated(
          'docs/desktop-release-runbook.md',
          (source) =>
            `${source}\nPolicy identity | Decision\n--- | ---\n\`${identity}\` | \`${decision}\`\n`,
        ),
        'release-docs.unbound-support-table',
      );
    },
  );

  it('does not interpret ordinary prose or fenced examples as decision rows', () => {
    const surfaces = mutated(
      'docs/desktop-release-runbook.md',
      (source) => `${source}
The identifier \`platform.macos-arm64\` is discussed here; the word GO alone is not a decision row.

\`\`\`text
| platform.macos-arm64 | go |
- capability.auto-update: supported
\`\`\`

Policy identity | Unrelated word
--- | ---
\`platform.macos-arm64\` | gopher
\`capability.auto-update\` | unsupportedness
\`capability.remote-crash-reporting\` | supportability
\`capability.publish\` | completeness
`,
    );
    expect(() =>
      assertReleaseDocumentation({ surfaces, policy, baselineStatus, releaseVersion }),
    ).not.toThrow();
  });

  it('rejects a missing, extra, reordered, or renamed canonical blocker row', () => {
    for (const transform of [
      (source: string) => source.replace(/^\|\s*`artifact\.file-missing`.*\n/m, ''),
      (source: string) =>
        source.replace(
          /(^\|\s*`artifact\.file-missing`.*$)/m,
          '$1\n| `artifact.self-asserted-receipt` | forged |',
        ),
      (source: string) =>
        source.replace(
          /(^\|\s*`artifact\.manifest-missing`.*\n)(^\|\s*`artifact\.file-missing`.*\n)/m,
          '$2$1',
        ),
      (source: string) => source.replace('`artifact.file-missing`', '`artifact.candidate-missing`'),
    ]) {
      assertMutatedContractFails(
        mutated('docs/desktop-release-runbook.md', transform),
        'release-docs.canonical-list-drift',
      );
    }
  });

  it('rejects an unreleased changelog heading', () => {
    assertMutatedContractFails(
      mutated('CHANGELOG.md', (source) =>
        source.replace('## [0.0.1] - 2026-07-16', '## [0.0.1] - Unreleased'),
      ),
      'release-docs.changelog-state-drift',
    );
  });

  it('rejects state weakening and positive tag/date/publication/completion claims on every state surface', () => {
    const state = releaseStateSentence(releaseVersion);
    for (const relativePath of releaseStateSurfacePaths) {
      assertMutatedContractFails(
        mutated(relativePath, (source) =>
          source.replace(state, state.replace('source-only', 'binary-ready')),
        ),
        'release-docs.release-state-drift',
      );
      for (const claim of [
        'Release tag exists.',
        'Release date: 2026-07-16.',
        'Desktop publication is published.',
        'Release is complete.',
      ]) {
        assertMutatedContractFails(
          mutated(relativePath, (source) => `${source}\n${claim}\n`),
          'release-docs.contradictory-claim',
        );
      }
    }
  });
});

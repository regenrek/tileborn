/* global console, process */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateDesktopRelease, loadDesktopReleasePolicy } from './desktop-release-contract.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

const stateSurfacePaths = Object.freeze([
  'README.md',
  'RELEASE.md',
  'CHANGELOG.md',
  'apps/desktop/README.md',
  'docs/battle-royale-creator-guide.md',
  'apps/docs/src/content/docs/battle-royale/creator-guide/index.md',
  'docs/battle-royale-release-evidence.md',
  'docs/desktop-release-capability-audit.md',
  'docs/desktop-release-runbook.md',
  'apps/docs/src/content/docs/desktop-release/index.md',
  'apps/docs/src/content/docs/release-readiness/index.md',
]);

const additionalAuditSurfacePaths = Object.freeze([
  'SECURITY.md',
  'packages/game-sdk/README.md',
  'apps/docs/src/content/docs/security/index.md',
]);

export class ReleaseDocsContractError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'ReleaseDocsContractError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ReleaseDocsContractError(code, message);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractMarkerLines = (text, marker) => {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    fail('release-docs.marker-missing', marker);
  }
  return text
    .slice(startIndex + start.length, endIndex)
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const expectedSupportLines = (policy) =>
  policy.support.map(
    ({ id, documentationLabel, status }) =>
      `- \`${id}\` (\`${documentationLabel}\`): \`${status}\``,
  );

const expectedBlockerLines = (status) => status.blockers.map(({ code }) => `- \`${code}\``);

const assertExactLines = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      'release-docs.canonical-list-drift',
      `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
    );
  }
};

const assertNoContradictions = (surfaces, policy) => {
  for (const [surface, text] of Object.entries(surfaces)) {
    const contradictions = [
      /desktop(?: release| distribution)?\s+(?:is|:)\s*(?:complete|published|released|go)\b/i,
      /publication\s+(?:is\s+)?complete\b/i,
      /(?<!no )(?<!not )(?:self-asserted|caller-(?:provided|supplied|authored))\s+(?:native\s+)?receipts?\s+(?:are|is)\s+(?:accepted|valid)\b/i,
    ];
    for (const { documentationLabel, status } of policy.support) {
      const label = escapeRegExp(documentationLabel);
      if (status === 'unsupported') {
        contradictions.push(
          new RegExp(`${label}\\s+(?:is|are)\\s+supported\\b`, 'i'),
          new RegExp(`\\bsupports?\\s+${label}\\b`, 'i'),
        );
      } else if (status === 'candidate') {
        contradictions.push(
          new RegExp(`${label}\\s+(?:is|are)\\s+(?:supported|released|go)\\b`, 'i'),
        );
      } else if (status === 'operator-blocked') {
        contradictions.push(
          new RegExp(`${label}\\s+(?:is|are)\\s+(?:complete|published|approved)\\b`, 'i'),
        );
      }
    }
    const contradiction = contradictions.find((pattern) => pattern.test(text));
    if (contradiction) {
      fail('release-docs.contradictory-claim', `${surface}: ${String(contradiction)}`);
    }
  }
};

export const loadReleaseDocumentationSurfaces = () =>
  Object.fromEntries(
    [...stateSurfacePaths, ...additionalAuditSurfacePaths].map((relativePath) => [
      relativePath,
      readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    ]),
  );

export function assertReleaseDocumentation({ surfaces, policy, baselineStatus }) {
  const runbook = surfaces['docs/desktop-release-runbook.md'];
  if (typeof runbook !== 'string') fail('release-docs.surface-missing', 'canonical runbook');

  for (const relativePath of stateSurfacePaths) {
    const text = surfaces[relativePath];
    if (typeof text !== 'string') fail('release-docs.surface-missing', relativePath);
    if (!text.includes('1.0.0-rc.0') || !/\bunreleased\b/i.test(text) || !text.includes('NO-GO')) {
      fail(
        'release-docs.release-state-drift',
        `${relativePath} must state 1.0.0-rc.0, unreleased, and NO-GO`,
      );
    }
  }

  const changelog = surfaces['CHANGELOG.md'];
  if (!/^## \[1\.0\.0-rc\.0\] - Unreleased$/m.test(changelog)) {
    fail('release-docs.changelog-state-drift', '1.0.0-rc.0 heading must be Unreleased');
  }
  if (/^## \[1\.0\.0-rc\.0\] - \d{4}-\d{2}-\d{2}$/m.test(changelog)) {
    fail('release-docs.changelog-state-drift', '1.0.0-rc.0 must not have a release date');
  }

  assertExactLines(
    extractMarkerLines(runbook, 'desktop-release-support'),
    expectedSupportLines(policy),
    'support decisions',
  );
  assertExactLines(
    extractMarkerLines(runbook, 'desktop-release-baseline-blockers'),
    expectedBlockerLines(baselineStatus),
    'evidence-free blockers',
  );
  if (baselineStatus.decision !== 'no-go') {
    fail('release-docs.baseline-decision-drift', baselineStatus.decision);
  }
  assertNoContradictions(surfaces, policy);
  return {
    stateSurfaces: stateSurfacePaths.length,
    auditedSurfaces: Object.keys(surfaces).length,
    supportDecisions: policy.support.length,
    baselineBlockers: baselineStatus.blockers.length,
  };
}

export function assertCanonicalReleaseDocumentation() {
  const policy = loadDesktopReleasePolicy();
  const baselineStatus = evaluateDesktopRelease({ policy, environment: {} });
  return assertReleaseDocumentation({
    surfaces: loadReleaseDocumentationSurfaces(),
    policy,
    baselineStatus,
  });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    console.log(JSON.stringify({ status: 'valid', ...assertCanonicalReleaseDocumentation() }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

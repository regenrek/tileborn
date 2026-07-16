/* global console, process */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateDesktopRelease, loadDesktopReleasePolicy } from './desktop-release-contract.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export const releaseStateSurfacePaths = Object.freeze([
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

const extractSingleMarkerLines = (text, marker) => {
  const start = `<!-- ${marker}:start -->`;
  const markers = [...text.matchAll(new RegExp(`<!--\\s*${escapeRegExp(marker)}:([^>]+)-->`, 'g'))];
  if (
    markers.length !== 2 ||
    markers[0]?.[1]?.trim() !== 'start' ||
    markers[1]?.[1]?.trim() !== 'end'
  ) {
    fail('release-docs.marker-cardinality', `${marker}: expected exactly one ordered pair`);
  }
  const startIndex = markers[0].index;
  const endIndex = markers[1].index;
  if (startIndex === undefined || endIndex === undefined || endIndex <= startIndex) {
    fail('release-docs.marker-order', marker);
  }
  return text
    .slice(startIndex + start.length, endIndex)
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const expectedSupportRows = (policy) => [
  ['Policy id', 'Surface', 'Status', 'Reason'],
  ...policy.support.map(({ id, documentationLabel, status, reason }) => [
    id,
    documentationLabel,
    status,
    reason,
  ]),
];

const expectedBlockerRows = (status) => [
  ['Blocker', 'Contract meaning'],
  ...status.blockers.map(({ code, message }) => [code, message]),
];

export const releaseStateSentence = (version) =>
  `Desktop release state: \`${version}\` is prepared, unreleased, and **NO-GO**; no tag, release date, publication, or completed release exists.`;

const assertExactLines = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      'release-docs.canonical-list-drift',
      `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
    );
  }
};

const parseCanonicalTable = (lines, label) => {
  if (lines.some((line) => !/^\|.+\|$/.test(line))) {
    fail('release-docs.canonical-table-invalid', `${label}: non-table content inside marker`);
  }
  return lines
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.replace(/[`*_]/g, '').trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
};

const withoutMarkerBlock = (text, marker) =>
  text.replace(
    new RegExp(
      `<!--\\s*${escapeRegExp(marker)}:start\\s*-->[\\s\\S]*?<!--\\s*${escapeRegExp(marker)}:end\\s*-->`,
    ),
    '',
  );

const assertNoUnboundFactTables = (runbook, policy, baselineStatus) => {
  const outsideCanonicalTables = withoutMarkerBlock(
    withoutMarkerBlock(runbook, 'desktop-release-support'),
    'desktop-release-baseline-blockers',
  );
  const tableRows = outsideCanonicalTables
    .split('\n')
    .filter((line) => /^\s*\|.+\|\s*$/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.replace(/[`*_]/g, '').trim()),
    );
  const blockerNamespaces = new Set(
    baselineStatus.blockers.map(({ code }) => code.split('.')[0]).filter(Boolean),
  );
  for (const cells of tableRows) {
    if (
      cells.some((cell) => {
        const [namespace, detail] = cell.split('.');
        return blockerNamespaces.has(namespace) && typeof detail === 'string' && detail.length > 0;
      })
    ) {
      fail('release-docs.unbound-blocker-table', cells.join(' | '));
    }
    if (
      policy.support.some(({ documentationLabel }) =>
        cells.some((cell) =>
          cell.toLocaleLowerCase().includes(documentationLabel.toLocaleLowerCase()),
        ),
      ) &&
      cells.some((cell) =>
        /^(?:candidate|unsupported|operator-blocked|supported|go|complete)$/i.test(cell),
      )
    ) {
      fail('release-docs.unbound-support-table', cells.join(' | '));
    }
  }
};

const assertNoContradictions = (surfaces, policy) => {
  for (const [surface, text] of Object.entries(surfaces)) {
    const contradictions = [
      /desktop(?: release| distribution)?\s+(?:is|:)\s*(?:complete|published|released|go)\b/i,
      /publication\s+(?:is\s+)?complete\b/i,
      /(?:release\s+)?tag\s+(?:exists|was created|has been created|is available)\b/i,
      /\btagged\s+as\s+v?\d/i,
      /release\s+date\s*(?:is|:)\s*\d{4}-\d{2}-\d{2}\b/i,
      /(?:release|publication)\s+(?:is\s+)?(?:published|complete)\b/i,
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
    const tableRows = text
      .split('\n')
      .filter((line) => /^\s*\|.+\|\s*$/.test(line))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.replace(/[`*_]/g, '').trim()),
      );
    for (const { documentationLabel, status } of policy.support) {
      const decision =
        status === 'unsupported' ? 'supported' : status === 'candidate' ? 'go' : 'complete';
      const contradiction = tableRows.some(
        (cells) =>
          cells.some((cell) =>
            cell.toLocaleLowerCase().includes(documentationLabel.toLocaleLowerCase()),
          ) && cells.some((cell) => cell.toLocaleLowerCase() === decision),
      );
      if (contradiction) {
        fail(
          'release-docs.contradictory-table-claim',
          `${surface}: ${documentationLabel} cannot be ${decision}`,
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
    [...releaseStateSurfacePaths, ...additionalAuditSurfacePaths].map((relativePath) => [
      relativePath,
      readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    ]),
  );

export function assertReleaseDocumentation({ surfaces, policy, baselineStatus, releaseVersion }) {
  const runbook = surfaces['docs/desktop-release-runbook.md'];
  if (typeof runbook !== 'string') fail('release-docs.surface-missing', 'canonical runbook');

  const requiredState = releaseStateSentence(releaseVersion);
  for (const relativePath of releaseStateSurfacePaths) {
    const text = surfaces[relativePath];
    if (typeof text !== 'string') fail('release-docs.surface-missing', relativePath);
    if (!text.includes(requiredState)) {
      fail(
        'release-docs.release-state-drift',
        `${relativePath} must contain the exact canonical release state`,
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
    parseCanonicalTable(
      extractSingleMarkerLines(runbook, 'desktop-release-support'),
      'support decisions',
    ),
    expectedSupportRows(policy),
    'support decisions',
  );
  assertExactLines(
    parseCanonicalTable(
      extractSingleMarkerLines(runbook, 'desktop-release-baseline-blockers'),
      'evidence-free blockers',
    ),
    expectedBlockerRows(baselineStatus),
    'evidence-free blockers',
  );
  if (baselineStatus.decision !== 'no-go') {
    fail('release-docs.baseline-decision-drift', baselineStatus.decision);
  }
  assertNoUnboundFactTables(runbook, policy, baselineStatus);
  assertNoContradictions(surfaces, policy);
  return {
    stateSurfaces: releaseStateSurfacePaths.length,
    auditedSurfaces: Object.keys(surfaces).length,
    supportDecisions: policy.support.length,
    baselineBlockers: baselineStatus.blockers.length,
  };
}

export function assertCanonicalReleaseDocumentation() {
  const policy = loadDesktopReleasePolicy();
  const baselineStatus = evaluateDesktopRelease({ policy, environment: {} });
  const releaseVersion = JSON.parse(
    readFileSync(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
  ).version;
  return assertReleaseDocumentation({
    surfaces: loadReleaseDocumentationSurfaces(),
    policy,
    baselineStatus,
    releaseVersion,
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

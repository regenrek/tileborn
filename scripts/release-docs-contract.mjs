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
  `Release \`${version}\` is source-only; desktop binary distribution remains **NO-GO** and no desktop artifact is published.`;

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

const normalizeFactValue = (value) =>
  value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/[–—]/g, '-')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ');

const structuredFactRows = (text) => {
  const rows = [];
  let fence = null;
  const visibleLines = [];
  for (const line of text.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const delimiter = fenceMatch[1][0];
      fence = fence === null ? delimiter : fence === delimiter ? null : fence;
      continue;
    }
    if (fence === null) visibleLines.push(line);
  }

  const tableCells = (line) => {
    if (!line.includes('|')) return null;
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = trimmed.split('|').map(normalizeFactValue);
    return cells.length >= 2 ? cells : null;
  };
  const isSeparator = (cells) => cells !== null && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

  let tableActive = false;
  for (const [index, line] of visibleLines.entries()) {
    const cells = tableCells(line);
    if (cells !== null) {
      if (isSeparator(cells)) {
        tableActive = true;
        continue;
      }
      const nextCells = tableCells(visibleLines[index + 1] ?? '');
      const hasOuterPipes = /^\s*\|.+\|\s*$/.test(line);
      if (hasOuterPipes || tableActive || isSeparator(nextCells)) {
        rows.push({ kind: 'table', cells });
        continue;
      }
    }
    tableActive = false;

    const listMatch = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/);
    if (listMatch) rows.push({ kind: 'list', cells: [normalizeFactValue(listMatch[1])] });
  }
  return rows;
};

const supportDecisionAliases = Object.freeze([
  'candidate',
  'unsupported',
  'operator-blocked',
  'operator blocked',
  'supported',
  'go',
  'no-go',
  'no go',
  'blocked',
  'complete',
  'completed',
  'published',
  'approved',
  'released',
]);

const rowContainsValue = (row, value) => {
  const normalized = normalizeFactValue(value);
  if (row.kind === 'table') return row.cells.some((cell) => cell === normalized);
  const boundary = new RegExp(`(^|[^a-z0-9-])${escapeRegExp(normalized)}(?=$|[^a-z0-9-])`, 'i');
  return row.cells.some((cell) => boundary.test(cell));
};

const rowIdentifiesSupport = (row, support) =>
  rowContainsValue(row, support.id) || rowContainsValue(row, support.documentationLabel);

const cellStartsWithValue = (cell, value) => {
  const normalized = normalizeFactValue(value);
  return new RegExp(`^${escapeRegExp(normalized)}(?=$|[^a-z0-9-])`, 'i').test(cell);
};

const rowContainsDecision = (row, decisions = supportDecisionAliases) => {
  if (row.kind === 'table') {
    return decisions.some((decision) =>
      row.cells.some((cell) => cellStartsWithValue(cell, decision)),
    );
  }
  return decisions.some((decision) => rowContainsValue(row, decision));
};

const contradictoryDecisions = (status) => {
  if (status === 'unsupported') return ['supported', 'go', 'released'];
  if (status === 'candidate') return ['supported', 'go', 'released'];
  return ['complete', 'completed', 'published', 'approved', 'go'];
};

const withoutMarkerBlock = (text, marker) =>
  text.replace(
    new RegExp(
      `<!--\\s*${escapeRegExp(marker)}:start\\s*-->[\\s\\S]*?<!--\\s*${escapeRegExp(marker)}:end\\s*-->`,
    ),
    '',
  );

const assertNoUnboundFactRows = (runbook, policy, baselineStatus) => {
  const outsideCanonicalRows = withoutMarkerBlock(
    withoutMarkerBlock(runbook, 'desktop-release-support'),
    'desktop-release-baseline-blockers',
  );
  const factRows = structuredFactRows(outsideCanonicalRows);
  const blockerNamespaces = new Set(
    baselineStatus.blockers.map(({ code }) => code.split('.')[0]).filter(Boolean),
  );
  for (const row of factRows) {
    if (
      row.cells.some((cell) => {
        const [namespace, detail] = cell.split('.');
        return blockerNamespaces.has(namespace) && typeof detail === 'string' && detail.length > 0;
      })
    ) {
      fail('release-docs.unbound-blocker-table', row.cells.join(' | '));
    }
    if (
      policy.support.some((support) => rowIdentifiesSupport(row, support)) &&
      rowContainsDecision(row)
    ) {
      fail('release-docs.unbound-support-table', row.cells.join(' | '));
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
    const factRows = structuredFactRows(text);
    for (const support of policy.support) {
      const decisions = contradictoryDecisions(support.status);
      const contradiction = factRows.some(
        (row) => rowIdentifiesSupport(row, support) && rowContainsDecision(row, decisions),
      );
      if (contradiction) {
        fail(
          'release-docs.contradictory-table-claim',
          `${surface}: ${support.id} cannot claim ${decisions.join('/')}`,
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
  if (!/^## \[0\.0\.1\] - 2026-07-16$/m.test(changelog)) {
    fail('release-docs.changelog-state-drift', '0.0.1 heading must use its release date');
  }
  if (/^## \[0\.0\.1\] - Unreleased$/m.test(changelog)) {
    fail('release-docs.changelog-state-drift', '0.0.1 must not remain Unreleased');
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
  assertNoUnboundFactRows(runbook, policy, baselineStatus);
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

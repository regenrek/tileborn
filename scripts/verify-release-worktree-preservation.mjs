import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(scriptDirectory, 'release-worktree-baseline.json');

const git = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', options.stderr ?? 'pipe'],
  });

const gitStatus = (args) =>
  spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileSha256 = (filePath) => sha256(readFileSync(filePath));

const fail = (message) => {
  process.stderr.write(`release-worktree-preservation: ${message}\n`);
  process.exitCode = 1;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
  throw new TypeError('release worktree baseline must use schemaVersion 1 and an entries array');
}

const argumentsSet = new Set(process.argv.slice(2));
const supportedArguments = new Set([
  '--self-test-detect-content-change',
  '--self-test-detect-missing-path',
]);
for (const argument of argumentsSet) {
  if (!supportedArguments.has(argument)) {
    throw new TypeError(`unknown argument ${argument}`);
  }
}
if (argumentsSet.has('--self-test-detect-content-change')) {
  const protectedEntry = manifest.entries.find(
    (entry) => entry.classification === 'intentional-source-test-docs',
  );
  if (protectedEntry === undefined) {
    throw new TypeError('self-test requires a protected source entry');
  }
  protectedEntry.sha256 = '0'.repeat(64);
}
if (argumentsSet.has('--self-test-detect-missing-path')) {
  const protectedEntry = manifest.entries.find(
    (entry) => entry.classification === 'intentional-source-test-docs',
  );
  if (protectedEntry === undefined) {
    throw new TypeError('self-test requires a protected source entry');
  }
  protectedEntry.path = '.release-preservation-self-test-missing';
}

const currentHead = git(['rev-parse', 'HEAD']).trim();
const ancestor = gitStatus(['merge-base', '--is-ancestor', manifest.anchorHead, currentHead]);
if (ancestor.status !== 0) {
  fail(`HEAD ${currentHead} is not a descendant of anchor ${manifest.anchorHead}`);
}

const staged = gitStatus(['diff', '--cached', '--quiet']);
if (staged.status !== 0) {
  fail('the index is not empty; preservation verification requires an unstaged boundary');
}

const seen = new Set();
const counts = new Map();
const results = {
  retainedExact: 0,
  integratedCommitted: 0,
  planrPathsRetained: 0,
  disposablePresent: 0,
  disposableMissing: 0,
  failures: 0,
};

for (const entry of manifest.entries) {
  if (
    typeof entry.path !== 'string' ||
    entry.path.length === 0 ||
    entry.path.startsWith('/') ||
    entry.path.includes('..') ||
    entry.path.includes('\0') ||
    entry.path.includes('\n') ||
    entry.path.includes(':')
  ) {
    fail(`invalid manifest path ${JSON.stringify(entry.path)}`);
    results.failures += 1;
    continue;
  }
  if (seen.has(entry.path)) {
    fail(`duplicate manifest path ${entry.path}`);
    results.failures += 1;
    continue;
  }
  seen.add(entry.path);
  counts.set(entry.classification, (counts.get(entry.classification) ?? 0) + 1);

  const absolutePath = path.resolve(repositoryRoot, entry.path);
  if (!absolutePath.startsWith(`${repositoryRoot}${path.sep}`)) {
    fail(`manifest path escapes repository: ${entry.path}`);
    results.failures += 1;
    continue;
  }

  if (!existsSync(absolutePath)) {
    if (entry.classification === 'reproducible-disposable-output') {
      results.disposableMissing += 1;
      continue;
    }
    fail(`protected path is missing: ${entry.path}`);
    results.failures += 1;
    continue;
  }

  if (lstatSync(absolutePath).isSymbolicLink()) {
    fail(`protected path became a symbolic link: ${entry.path}`);
    results.failures += 1;
    continue;
  }
  const resolvedPath = realpathSync(absolutePath);
  if (!resolvedPath.startsWith(`${repositoryRoot}${path.sep}`)) {
    fail(`protected path resolves outside repository: ${entry.path}`);
    results.failures += 1;
    continue;
  }

  if (entry.classification === 'planr-evidence') {
    results.planrPathsRetained += 1;
    continue;
  }
  if (entry.classification === 'reproducible-disposable-output') {
    results.disposablePresent += 1;
    continue;
  }

  const currentHash = fileSha256(absolutePath);
  if (currentHash === entry.sha256) {
    results.retainedExact += 1;
    continue;
  }

  const committedPath = gitStatus(['cat-file', '-e', `HEAD:${entry.path}`]);
  const changedSinceAnchor = gitStatus([
    'diff',
    '--quiet',
    manifest.anchorHead,
    currentHead,
    '--',
    entry.path,
  ]);
  const cleanWorktreePath = gitStatus(['diff', '--quiet', '--', entry.path]);
  if (
    currentHead !== manifest.anchorHead &&
    committedPath.status === 0 &&
    changedSinceAnchor.status === 1 &&
    cleanWorktreePath.status === 0
  ) {
    const committedContent = git(['show', `HEAD:${entry.path}`], { encoding: null });
    if (sha256(committedContent) === currentHash) {
      results.integratedCommitted += 1;
      continue;
    }
  }

  fail(
    `protected content changed without a clean committed integration after the anchor: ${entry.path}`,
  );
  results.failures += 1;
}

for (const [classification, expected] of Object.entries(manifest.expectedCounts)) {
  const observed = counts.get(classification) ?? 0;
  if (observed !== expected) {
    fail(`classification ${classification} expected ${expected} entries, observed ${observed}`);
    results.failures += 1;
  }
}
if (seen.size !== manifest.expectedTotal) {
  fail(`expected ${manifest.expectedTotal} unique paths, observed ${seen.size}`);
  results.failures += 1;
}

const summary = {
  anchorHead: manifest.anchorHead,
  currentHead,
  manifestSha256: sha256(readFileSync(manifestPath)),
  expectedTotal: manifest.expectedTotal,
  ...results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (results.failures > 0) {
  process.exitCode = 1;
}

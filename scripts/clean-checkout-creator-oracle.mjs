#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const within = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

export const assertClean = (status, phase) => {
  if (status.length !== 0) throw new Error(`${phase}: checkout is dirty:\n${status}`);
};

export const assertLocalLinks = (root, links) => {
  const escaped = links.filter(({ target }) => !within(root, target));
  if (escaped.length !== 0) {
    throw new Error(`workspace dependency links escape checkout: ${JSON.stringify(escaped)}`);
  }
};

const git = (root, args, allowFailure = false) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
};

const outputDirectories = async (root) => {
  const found = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === 'dist' || entry.name === '.vite' || entry.name === 'out') {
        found.push(path.relative(root, child));
      } else {
        await visit(child);
      }
    }
  };
  await visit(root);
  return found.sort();
};

const workspaceLinks = async (root) => {
  const links = [];
  const inspectScope = async (nodeModules) => {
    const scope = path.join(nodeModules, '@tileborne');
    try {
      for (const entry of await readdir(scope, { withFileTypes: true })) {
        const child = path.join(scope, entry.name);
        if ((await lstat(child)).isSymbolicLink()) {
          links.push({ path: path.relative(root, child), target: await realpath(child) });
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory() || entry.name === '.git') continue;
      if (entry.name === 'node_modules') await inspectScope(child);
      else await visit(child);
    }
  };
  await visit(root);
  return links.sort((left, right) => left.path.localeCompare(right.path));
};

const run = async (root, evidenceRoot, id, command, args, env = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const stdoutFile = `${id}.stdout.log`;
  const stderrFile = `${id}.stderr.log`;
  await Promise.all([
    writeFile(path.join(evidenceRoot, stdoutFile), stdout),
    writeFile(path.join(evidenceRoot, stderrFile), stderr),
  ]);
  const receipt = {
    command: [command, ...args],
    exitCode: result.status,
    signal: result.signal,
    stdout: { file: stdoutFile, bytes: Buffer.byteLength(stdout), sha256: sha256(stdout) },
    stderr: { file: stderrFile, bytes: Buffer.byteLength(stderr), sha256: sha256(stderr) },
  };
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `${id} failed: ${JSON.stringify({ ...receipt, error: result.error?.message })}`,
    );
  }
  return receipt;
};

export const runCleanCheckoutCreatorOracle = async ({ root = process.cwd(), evidenceRoot }) => {
  if (typeof evidenceRoot !== 'string' || evidenceRoot.length === 0) {
    throw new Error('usage: node scripts/clean-checkout-creator-oracle.mjs <evidence-directory>');
  }
  const cwd = path.resolve(root);
  const checkoutRoot = await realpath(cwd);
  const repositoryRoot = await realpath(git(checkoutRoot, ['rev-parse', '--show-toplevel']));
  if (repositoryRoot !== checkoutRoot) throw new Error('runner must execute at the checkout root');
  const gitHead = git(checkoutRoot, ['rev-parse', 'HEAD']);
  const symbolicRef = git(checkoutRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  if (symbolicRef !== null) throw new Error(`runner requires detached HEAD, found ${symbolicRef}`);
  const initialStatus = git(checkoutRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertClean(initialStatus, 'initial');
  const preexistingOutputs = await outputDirectories(checkoutRoot);
  if (preexistingOutputs.length !== 0) {
    throw new Error(`build outputs exist before build: ${JSON.stringify(preexistingOutputs)}`);
  }
  await mkdir(evidenceRoot, { recursive: true });
  const resolvedEvidenceRoot = await realpath(evidenceRoot);
  if (within(checkoutRoot, resolvedEvidenceRoot)) {
    throw new Error('evidence directory must be outside the checkout');
  }

  const install = await run(checkoutRoot, resolvedEvidenceRoot, '01-frozen-install', 'pnpm', [
    'install',
    '--frozen-lockfile',
  ]);
  const dependencyLinks = await workspaceLinks(checkoutRoot);
  if (dependencyLinks.length === 0)
    throw new Error('no @tileborne workspace dependency links found');
  assertLocalLinks(checkoutRoot, dependencyLinks);
  const predev = await run(checkoutRoot, resolvedEvidenceRoot, '02-predev-cdp', 'pnpm', [
    '--filter',
    '@tileborne/desktop',
    'predev:cdp',
  ]);
  const postBuildStatus = git(checkoutRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertClean(postBuildStatus, 'post-build');

  const preflight = {
    schemaVersion: 1,
    checkout: {
      cwd,
      cwdRealpath: checkoutRoot,
      repositoryRoot,
      gitHead,
      state: 'detached',
      symbolicRef,
      initialStatus,
      preexistingOutputs,
      postBuildStatus,
    },
    dependencyLinks,
    commands: { install, predev },
  };
  const preflightBytes = `${JSON.stringify(preflight, null, 2)}\n`;
  const preflightFile = path.join(resolvedEvidenceRoot, 'runner-preflight.json');
  await writeFile(preflightFile, preflightBytes);
  const preflightSha256 = sha256(preflightBytes);
  const artifacts = path.join(resolvedEvidenceRoot, 'oracle-artifacts');
  await mkdir(artifacts);
  const oracle = await run(
    checkoutRoot,
    resolvedEvidenceRoot,
    '03-creator-oracle',
    'pnpm',
    [
      '--filter',
      '@tileborne/desktop',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.electron.config.ts',
      'src/smoke/behavior-goal-oracle.electron.test.ts',
    ],
    {
      TILEBORNE_CREATOR_ORACLE_RUN_ID: `clean-${gitHead.slice(0, 12)}`,
      TILEBORNE_CREATOR_ORACLE_ARTIFACTS: artifacts,
      TILEBORNE_CREATOR_ORACLE_PREFLIGHT: preflightFile,
    },
  );
  const postOracleStatus = git(checkoutRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertClean(postOracleStatus, 'post-oracle');
  const oracleReceiptFile = path.join(artifacts, 'receipt.json');
  const oracleReceiptBytes = await readFile(oracleReceiptFile);
  const oracleReceipt = JSON.parse(oracleReceiptBytes.toString('utf8'));
  if (oracleReceipt?.runnerPreflight?.sha256 !== preflightSha256) {
    throw new Error('Oracle receipt did not bind the exact runner preflight digest.');
  }
  const final = {
    schemaVersion: 1,
    checkoutRoot,
    gitHead,
    state: 'detached',
    preflight: { file: 'runner-preflight.json', sha256: preflightSha256 },
    oracle,
    oracleReceipt: {
      file: path.relative(resolvedEvidenceRoot, oracleReceiptFile),
      bytes: oracleReceiptBytes.byteLength,
      sha256: sha256(oracleReceiptBytes),
    },
    postOracleStatus,
  };
  const finalBytes = `${JSON.stringify(final, null, 2)}\n`;
  const finalFile = path.join(resolvedEvidenceRoot, 'runner-receipt.json');
  await writeFile(finalFile, finalBytes);
  return { finalFile, sha256: sha256(finalBytes), receipt: final };
};

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  runCleanCheckoutCreatorOracle({ evidenceRoot: process.argv[2] })
    .then(({ finalFile, sha256: digest }) =>
      console.log(JSON.stringify({ finalFile, sha256: digest })),
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

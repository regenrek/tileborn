#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, '..', '..');
const rulesPath = join(projectRoot, '.forbidden-paths.regex');
const allowPath = join(projectRoot, '.forbidden-paths.allow');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!existsSync(rulesPath)) fail('Missing .forbidden-paths.regex');

const rules = readFileSync(rulesPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((source) => ({ source, expression: new RegExp(source) }));
const allowRules = existsSync(allowPath)
  ? readFileSync(allowPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((source) => new RegExp(source))
  : [];

const mode = process.argv.includes('--tracked') ? 'tracked' : 'staged';
const args =
  mode === 'tracked'
    ? ['ls-files', '-z', '--cached', '--others', '--exclude-standard']
    : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'];
const result = spawnSync('git', args, {
  cwd: projectRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  fail(`Unable to inspect ${mode} files: ${result.stderr.trim()}`);
}

const files = result.stdout.split('\0').filter(Boolean);
const violations = files.flatMap((file) => {
  if (allowRules.some((expression) => expression.test(file))) return [];
  const rule = rules.find(({ expression }) => expression.test(file));
  return rule ? [{ file, rule: rule.source }] : [];
});

if (violations.length > 0) {
  console.error(`Forbidden ${mode} files detected:`);
  for (const { file, rule } of violations) {
    console.error(`- ${file}`);
    console.error(`  Rule: ${rule}`);
  }
  process.exit(1);
}

console.log(`Forbidden-path check passed for ${files.length} ${mode} files`);

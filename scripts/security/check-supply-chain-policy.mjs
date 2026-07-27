#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..', '..');
const errors = [];

const read = (path) => readFileSync(join(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));
const requireCondition = (condition, message) => {
  if (!condition) errors.push(message);
};

const rootManifest = readJson('package.json');
const packageManagerMatch = /^pnpm@(\d+)\.(\d+)\.(\d+)$/.exec(rootManifest.packageManager ?? '');
requireCondition(
  packageManagerMatch && Number(packageManagerMatch[1]) >= 11,
  'packageManager must pin an exact pnpm 11+ version',
);
requireCondition(
  rootManifest.devEngines?.packageManager?.name === 'pnpm' &&
    /^(\^|~|>=)?11(?:\.|$)/.test(rootManifest.devEngines.packageManager.version ?? ''),
  'devEngines.packageManager must require pnpm 11+',
);

const competingLockfiles = ['package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter(
  (path) => existsSync(join(root, path)),
);
requireCondition(existsSync(join(root, 'pnpm-lock.yaml')), 'pnpm-lock.yaml is required');
requireCondition(
  competingLockfiles.length === 0,
  `non-pnpm lockfiles are forbidden: ${competingLockfiles.join(', ')}`,
);

for (const npmrc of ['.npmrc', 'apps/desktop/.npmrc']) {
  const source = read(npmrc);
  requireCondition(
    !/(?:_authToken|auth|password|username)\s*=/i.test(source),
    `${npmrc} must not contain credential directives`,
  );
}

const workspace = read('pnpm-workspace.yaml');
const requiredWorkspaceRules = [
  [/minimumReleaseAge:\s*10080\b/, 'minimumReleaseAge must be seven days'],
  [/minimumReleaseAgeStrict:\s*true\b/, 'minimumReleaseAgeStrict must be true'],
  [
    /minimumReleaseAgeIgnoreMissingTime:\s*false\b/,
    'minimumReleaseAgeIgnoreMissingTime must be false',
  ],
  [/blockExoticSubdeps:\s*true\b/, 'blockExoticSubdeps must be true'],
  [/trustPolicy:\s*no-downgrade\b/, 'trustPolicy must be no-downgrade'],
  [/dangerouslyAllowAllBuilds:\s*false\b/, 'dangerouslyAllowAllBuilds must be false'],
  [/savePrefix:\s*['"]{2}/, 'savePrefix must be empty'],
  [/allowBuilds:\s*\n/, 'allowBuilds must be explicit'],
];
for (const [pattern, message] of requiredWorkspaceRules) {
  requireCondition(pattern.test(workspace), message);
}

const policy = readJson('scripts/security/security-policy-exceptions.json');
requireCondition(policy.schemaVersion === 1, 'security policy exception schema must be 1');
const yamlExclusions =
  workspace
    .match(/trustPolicyExclude:\s*\n((?:\s{2}-[^\n]+\n?)+)/)?.[1]
    ?.split('\n')
    .map((line) =>
      line
        .replace(/^\s*-\s*/, '')
        .replace(/^['"]|['"]$/g, '')
        .trim(),
    )
    .filter(Boolean) ?? [];
const documentedExclusions = policy.trustPolicyExclude.map(({ specifier }) => specifier);
requireCondition(
  JSON.stringify([...yamlExclusions].sort()) === JSON.stringify([...documentedExclusions].sort()),
  'trustPolicyExclude must exactly match the reviewed exception ledger',
);
for (const exception of policy.trustPolicyExclude) {
  requireCondition(
    exception.owner &&
      exception.reason?.length >= 24 &&
      /^\d{4}-\d{2}-\d{2}$/.test(exception.reviewAfter),
    `trust exception ${exception.specifier} needs owner, reason, and reviewAfter`,
  );
  requireCondition(
    new Date(`${exception.reviewAfter}T23:59:59Z`) >= new Date(),
    `trust exception ${exception.specifier} expired on ${exception.reviewAfter}`,
  );
}

const tracked = spawnSync('git', ['ls-files', '-z', '**/package.json', 'package.json'], {
  cwd: root,
  encoding: 'utf8',
});
requireCondition(tracked.status === 0, 'unable to enumerate tracked package manifests');
const lifecycleNames = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
]);
const observedLifecycle = [];
for (const file of tracked.stdout.split('\0').filter(Boolean)) {
  const manifest = readJson(file);
  for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
    if (lifecycleNames.has(script)) observedLifecycle.push({ file, script, command });
  }
}
const normalizeLifecycle = ({ file, script, command }) => `${file}\0${script}\0${command}`;
requireCondition(
  JSON.stringify(observedLifecycle.map(normalizeLifecycle).sort()) ===
    JSON.stringify(policy.lifecycleScripts.map(normalizeLifecycle).sort()),
  'lifecycle scripts must exactly match the reviewed exception ledger',
);

const workflowFiles = spawnSync('git', ['ls-files', '-z', '.github/workflows/*.yml'], {
  cwd: root,
  encoding: 'utf8',
})
  .stdout.split('\0')
  .filter(Boolean);
for (const file of workflowFiles) {
  const source = read(file);
  requireCondition(!/\bpull_request_target\s*:/.test(source), `${file} uses pull_request_target`);
  requireCondition(!/toJSON\(\s*secrets\s*\)/.test(source), `${file} serializes secrets`);
  for (const match of source.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
    requireCondition(
      /^[a-f0-9]{40}$/.test(match[2]),
      `${file} action ${match[1]} must use an exact commit SHA`,
    );
  }
  for (const line of source.match(/^[^\n]*pnpm install[^\n]*$/gm) ?? []) {
    requireCondition(
      line.includes('--frozen-lockfile'),
      `${file} contains an unfrozen pnpm install`,
    );
  }
}

for (const file of ['.github/workflows/release-fast.yml', '.github/workflows/release-stable.yml']) {
  const source = read(file);
  requireCondition(
    !/cache:\s*pnpm|actions\/cache@/.test(source),
    `${file} must not consume shared dependency caches`,
  );
}

const fastWorkflow = read('.github/workflows/release-fast.yml');
requireCondition(
  /candidate:[\s\S]*?environment:\s*fast-build-secrets/.test(fastWorkflow),
  'release-fast candidate must use fast-build-secrets',
);
requireCondition(
  /publish-prerelease:[\s\S]*?environment:\s*fast-prerelease/.test(fastWorkflow),
  'release-fast publication must use fast-prerelease',
);

const stableWorkflow = read('.github/workflows/release-stable.yml');
requireCondition(
  /stable-candidate:[\s\S]*?environment:\s*stable-build-secrets/.test(stableWorkflow),
  'release-stable candidate must use stable-build-secrets',
);
requireCondition(
  /stable-publication:[\s\S]*?environment:\s*stable-release/.test(stableWorkflow),
  'release-stable publication must use stable-release',
);

const ruleset = readJson('.github/rulesets/ci-fast-required-check.json');
const requiredChecks = ruleset.rules
  .filter(({ type }) => type === 'required_status_checks')
  .flatMap(({ parameters }) => parameters.required_status_checks ?? [])
  .map(({ context }) => context);
requireCondition(
  JSON.stringify(requiredChecks) === JSON.stringify(['ci-fast']),
  'ci-fast must remain the sole required status check',
);

requireCondition(existsSync(join(root, '.github/dependabot.yml')), 'Dependabot config is required');
const ci = read('.github/workflows/ci.yml');
for (const marker of ['Check forbidden tracked paths', 'Verify JavaScript supply-chain policy']) {
  requireCondition(ci.includes(marker), `ci-fast is missing security control: ${marker}`);
}

if (errors.length > 0) {
  console.error('Supply-chain policy failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Supply-chain policy passed (${workflowFiles.length} workflows, ${observedLifecycle.length} reviewed lifecycle script)`,
);

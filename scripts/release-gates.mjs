import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
export const releaseGateReceiptSchemaVersion = 1;
export const releaseGateProfileIds = Object.freeze(['fast', 'stable', 'advisory']);
const defaultCiFastReceiptPath = '.release/ci-fast-gate-receipt.json';

export const ciFastEscalationRules = Object.freeze([
  escalation(
    'root-config',
    ['package.json', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.base.json'],
    ['@tileborne/desktop...', '@tileborne/docs...', '@tileborne/game-host...'],
  ),
  escalation('lockfile', ['pnpm-lock.yaml'], ['@tileborne/desktop...', '@tileborne/game-host...']),
  escalation(
    'release-scripts',
    ['scripts/release-', 'scripts/desktop-release-', 'scripts/native-desktop-release-'],
    ['@tileborne/desktop...', '@tileborne/docs...'],
  ),
  escalation(
    'workflows',
    ['.github/workflows/', '.github/rulesets/'],
    ['@tileborne/desktop...', '@tileborne/docs...'],
  ),
  escalation('docs', ['docs/', 'apps/docs/'], ['@tileborne/docs...']),
  escalation('desktop', ['apps/desktop/'], ['@tileborne/desktop...']),
]);

const ciFastRootContractCommands = Object.freeze([
  ciFastStep(['format'], ['pnpm', 'format:check']),
  ciFastStep(['desktop-release-contract'], ['pnpm', 'release:desktop:policy']),
  ciFastStep(['desktop-release-contract'], ['pnpm', 'release:desktop:status']),
  ciFastStep(['desktop-release-contract'], ['pnpm', 'release:desktop:docs']),
  ciFastStep(['desktop-release-contract'], ['pnpm', 'test:desktop-release-contract']),
]);

const ciFastDesktopCandidateCommands = Object.freeze([
  ciFastStep(['build'], ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop^...']),
  ciFastStep(['desktop-smoke'], ['pnpm', 'test:desktop-smoke']),
  ciFastStep(
    ['packaged-runtime'],
    ['pnpm', '--filter', '@tileborne/desktop', 'test:packaged-smoke'],
  ),
]);

/**
 * @typedef {object} ReleaseGate
 * @property {string} id
 * @property {string} label
 * @property {readonly (readonly string[])[]} commands
 * @property {boolean} required
 * @property {boolean} xvfb
 * @property {readonly string[]} profiles
 * @property {Readonly<Record<string, readonly (readonly string[])[]>>} profileCommands
 */

/**
 * The single owner of release-gate membership, ordering, commands, and runner
 * requirements. Local `pnpm ci` and GitHub Actions both consume this manifest.
 *
 * @type {readonly ReleaseGate[]}
 */
export const releaseGates = Object.freeze([
  gate('install', 'Frozen install', [['pnpm', 'install', '--frozen-lockfile']], {
    profiles: ['fast', 'stable'],
  }),
  gate('format', 'Format', [['pnpm', 'format:check']], { profiles: ['fast', 'stable'] }),
  gate('typecheck', 'Typecheck', [['pnpm', 'typecheck']], {
    profiles: ['fast', 'stable'],
    profileCommands: {
      fast: [['pnpm', 'turbo', 'run', 'typecheck', '--affected']],
    },
  }),
  gate('lint', 'Lint', [['pnpm', 'lint']], {
    profiles: ['fast', 'stable'],
    profileCommands: {
      fast: [['pnpm', 'turbo', 'run', 'lint', '--affected']],
    },
  }),
  gate('test', 'Full tests', [['pnpm', 'test', '--', '--run']], {
    profiles: ['fast', 'stable'],
    profileCommands: {
      fast: [['pnpm', 'turbo', 'run', 'test', '--affected', '--', '--run']],
    },
  }),
  gate('build', 'Build', [['pnpm', 'build']], {
    profiles: ['fast', 'stable'],
    profileCommands: {
      fast: [['pnpm', 'turbo', 'run', 'build', '--affected', '--filter=@tileborne/desktop...']],
    },
  }),
  gate('boundaries', 'Boundary tests', [['pnpm', 'test:boundaries']], { profiles: ['stable'] }),
  gate(
    'cli-e2e',
    'CLI e2e',
    [
      ['pnpm', 'build'],
      ['pnpm', 'test:cli-e2e'],
    ],
    { profiles: ['stable'] },
  ),
  gate(
    'game-host',
    'Game host smoke',
    [
      ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/game-host...'],
      ['pnpm', 'test:game-host'],
    ],
    { profiles: ['stable'] },
  ),
  gate(
    'bundled-worker',
    'Bundled worker',
    [
      ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/game-host...'],
      ['pnpm', '--filter', '@tileborne/game-host', 'verify:bundled-worker'],
    ],
    { profiles: ['stable'] },
  ),
  gate(
    'services-build-hermetic',
    'Hermetic services build',
    [['pnpm', 'test:services-build-hermetic']],
    { profiles: ['stable'] },
  ),
  gate(
    'creator-performance',
    'Creator deterministic performance budgets',
    [
      ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop^...'],
      ['pnpm', 'test:creator-performance'],
    ],
    { profiles: ['stable'] },
  ),
  gate(
    'docs',
    'Docs build',
    [
      ['pnpm', 'build'],
      ['pnpm', 'docs:build'],
    ],
    { profiles: ['stable'] },
  ),
  gate(
    'desktop-smoke',
    'Desktop smoke',
    [
      ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop...'],
      ['pnpm', 'test:desktop-smoke'],
    ],
    {
      profiles: ['fast', 'stable'],
      xvfb: true,
    },
  ),
  gate(
    'packaged-runtime',
    'Packaged runtime closure',
    [
      ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop...'],
      ['pnpm', '--filter', '@tileborne/desktop', 'test:packaged-smoke'],
    ],
    { profiles: ['fast', 'stable'], xvfb: true },
  ),
  gate(
    'desktop-release-contract',
    'Desktop 1.0 release contract',
    [
      ['pnpm', 'release:desktop:policy'],
      ['pnpm', 'release:desktop:status'],
      ['pnpm', 'release:desktop:docs'],
      ['pnpm', 'test:desktop-release-contract'],
    ],
    { profiles: ['fast', 'stable'] },
  ),
  gate('clean-checkout', 'Clean checkout', [['pnpm', 'test:clean-checkout']], {
    profiles: ['stable'],
  }),
  gate(
    'creator-performance-native',
    'Creator native performance calibration',
    [
      ['pnpm', 'turbo', 'run', 'build', '--filter=@tileborne/desktop^...'],
      ['pnpm', '--filter', '@tileborne/desktop', 'test:creator-performance-native'],
    ],
    { profiles: ['advisory'], required: false, xvfb: true },
  ),
  gate(
    'clean-checkout-time',
    'Clean checkout timing',
    [
      ['pnpm', 'test:clean-checkout-time'],
      ['pnpm', 'test:clean-checkout-time:validate'],
    ],
    { profiles: ['advisory'], required: false, xvfb: true },
  ),
]);

/**
 * @param {string} id
 * @param {string} label
 * @param {readonly (readonly string[])[]} commands
 * @param {{ readonly profiles?: readonly string[]; readonly profileCommands?: Readonly<Record<string, readonly (readonly string[])[]>>; readonly required?: boolean; readonly xvfb?: boolean }} [options]
 * @returns {ReleaseGate}
 */
function gate(id, label, commands, options = {}) {
  const profiles = options.profiles ?? ['stable'];
  for (const profile of profiles) {
    if (!releaseGateProfileIds.includes(profile)) {
      throw new Error(`Unknown release gate profile: ${profile}`);
    }
  }
  return Object.freeze({
    id,
    label,
    commands: Object.freeze(commands.map((command) => Object.freeze(command))),
    required: options.required ?? true,
    xvfb: options.xvfb ?? false,
    profiles: Object.freeze([...profiles]),
    profileCommands: Object.freeze(options.profileCommands ?? {}),
  });
}

function escalation(id, pathPrefixes, filters) {
  return Object.freeze({
    id,
    pathPrefixes: Object.freeze([...pathPrefixes]),
    filters: Object.freeze([...filters]),
  });
}

function ciFastStep(gateIds, command) {
  return Object.freeze({
    gateIds: Object.freeze([...gateIds]),
    command: Object.freeze([...command]),
  });
}

export function selectReleaseGates(profile) {
  if (profile === undefined) return releaseGates;
  assertReleaseGateProfile(profile);
  return releaseGates
    .filter((releaseGate) => releaseGate.profiles.includes(profile))
    .map((releaseGate) =>
      Object.freeze({
        ...releaseGate,
        commands: Object.freeze(
          (releaseGate.profileCommands[profile] ?? releaseGate.commands).map((command) =>
            Object.freeze(command),
          ),
        ),
      }),
    );
}

export function createReleaseGateMatrix(profile) {
  return {
    include: selectReleaseGates(profile).map(({ id, label, required, xvfb }) => ({
      id,
      label,
      profile: profile ?? null,
      required,
      xvfb,
    })),
  };
}

export function resolveReleaseGate(profile, gateId) {
  if (profile !== undefined) {
    assertReleaseGateProfile(profile);
  }
  const releaseGate = selectReleaseGates(profile).find(({ id }) => id === gateId);
  if (releaseGate === undefined) {
    throw new Error(`Unknown release gate: ${gateId ?? '<missing>'}`);
  }
  return releaseGate;
}

export function createCiFastPlan({ base, head, changedPaths = [] } = {}) {
  const escalations = ciFastEscalationRules
    .map((rule) => ({
      id: rule.id,
      matchedPaths: changedPaths.filter((changedPath) =>
        rule.pathPrefixes.some((pathPrefix) => changedPath.startsWith(pathPrefix)),
      ),
      filters: rule.filters,
    }))
    .filter(({ matchedPaths }) => matchedPaths.length > 0);
  const filters = [...new Set(escalations.flatMap((match) => match.filters))];
  const turboCommand = [
    'pnpm',
    'turbo',
    'run',
    'build',
    'lint',
    'typecheck',
    'test',
    '--affected',
    ...filters.flatMap((filter) => ['--filter', filter]),
  ];
  const includesDesktopCandidateScope = filters.includes('@tileborne/desktop...');
  const steps = [
    ciFastStep(['install'], ['pnpm', 'install', '--frozen-lockfile']),
    ciFastStep(['build', 'lint', 'typecheck', 'test'], turboCommand),
    ...ciFastRootContractCommands,
    ...(includesDesktopCandidateScope ? ciFastDesktopCandidateCommands : []),
  ];

  return Object.freeze({
    profile: 'fast',
    base: base ?? null,
    head: head ?? null,
    changedPaths: Object.freeze([...changedPaths]),
    escalations: Object.freeze(
      escalations.map((match) =>
        Object.freeze({
          id: match.id,
          matchedPaths: Object.freeze([...match.matchedPaths]),
          filters: Object.freeze([...match.filters]),
        }),
      ),
    ),
    steps: Object.freeze(steps),
    commands: Object.freeze(steps.map((step) => step.command)),
  });
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function ciFastBase() {
  return (
    process.env.TURBO_SCM_BASE || process.env.GITHUB_BASE_SHA || gitOutput(['rev-parse', 'HEAD~1'])
  );
}

function ciFastHead() {
  return process.env.TURBO_SCM_HEAD || process.env.GITHUB_SHA || gitOutput(['rev-parse', 'HEAD']);
}

function changedPathsBetween(base, head) {
  const output = gitOutput(['diff', '--name-only', `${base}...${head}`]);
  return output === '' ? [] : output.split('\n');
}

function writeCiFastSummary(plan, receiptPath) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath === undefined) return;
  const escalationText =
    plan.escalations.length === 0
      ? 'none'
      : plan.escalations.map((match) => `${match.id}: ${match.filters.join(',')}`).join('; ');
  appendFileSync(
    summaryPath,
    [
      '## ci-fast',
      '',
      '| Field | Value |',
      '| --- | --- |',
      '| Profile | fast |',
      `| Base | ${plan.base ?? 'unknown'} |`,
      `| Head | ${plan.head ?? 'unknown'} |`,
      `| Changed paths | ${plan.changedPaths.length} |`,
      `| Escalations | ${escalationText} |`,
      `| Turbo command | ${plan.steps[1].command.join(' ')} |`,
      `| Receipt | ${receiptPath} |`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function ciFastReceiptPath() {
  return process.env.TILEBORNE_CI_FAST_RECEIPT ?? defaultCiFastReceiptPath;
}

function runCiFast({ planOnly = false, changedPaths } = {}) {
  const base = ciFastBase();
  const head = ciFastHead();
  const plan = createCiFastPlan({
    base,
    head,
    changedPaths: changedPaths ?? changedPathsBetween(base, head),
  });
  if (planOnly) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const startedAt = new Date().toISOString();
  const gateResultsById = new Map();
  let exitCode = 0;
  for (const step of plan.steps) {
    const gateStartedAt = new Date().toISOString();
    const statusCode = runCommand(step.command, { exitOnFailure: false });
    const gateStatus = statusCode === 0 ? 'passed' : 'failed';
    const finishedAt = new Date().toISOString();
    for (const gateId of step.gateIds) {
      const existing = gateResultsById.get(gateId);
      gateResultsById.set(gateId, {
        id: gateId,
        status: existing?.status === 'failed' ? 'failed' : gateStatus,
        startedAt: existing?.startedAt ?? gateStartedAt,
        finishedAt,
      });
    }
    if (statusCode !== 0) {
      exitCode = statusCode;
      break;
    }
  }

  const receipt = Object.freeze({
    schemaVersion: releaseGateReceiptSchemaVersion,
    profile: 'fast',
    sourceSha: head,
    lockfileHash: hashFile('pnpm-lock.yaml'),
    nodeVersion: process.version,
    packageManager: `pnpm@${pnpmVersion()}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseSha: base,
    changedPaths: plan.changedPaths,
    escalations: plan.escalations,
    commands: plan.commands,
    gates: Object.freeze([...gateResultsById.values()].map((result) => Object.freeze(result))),
    artifactHashes: Object.freeze([]),
  });
  const receiptPath = ciFastReceiptPath();
  const resolvedReceiptPath = path.resolve(repoRoot, receiptPath);
  mkdirSync(path.dirname(resolvedReceiptPath), { recursive: true });
  writeFileSync(resolvedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  writeCiFastSummary(plan, receiptPath);
  if (exitCode !== 0) process.exit(exitCode);
}

/** @param {readonly string[]} commandParts */
function runCommand(commandParts, { exitOnFailure = true } = {}) {
  const [command, ...args] = commandParts;
  if (command === undefined) {
    throw new Error('Release gate commands must not be empty');
  }
  console.log(`\n==> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    if (exitOnFailure) process.exit(result.status ?? 1);
    return result.status ?? 1;
  }
  return 0;
}

/** @param {ReleaseGate} gateDefinition */
function runGate(gateDefinition, { exitOnFailure = true } = {}) {
  console.log(`\n# Release gate: ${gateDefinition.label} (${gateDefinition.id})`);
  for (const command of gateDefinition.commands) {
    const status = runCommand(command, { exitOnFailure });
    if (status !== 0) return status;
  }
  return 0;
}

function assertReleaseGateProfile(profile) {
  if (!releaseGateProfileIds.includes(profile)) {
    throw new Error(`Unknown release gate profile: ${profile}`);
  }
}

function hashFile(relativePath) {
  return `sha256:${createHash('sha256')
    .update(readFileSync(path.join(repoRoot, relativePath)))
    .digest('hex')}`;
}

function hashArtifact(artifactPath) {
  return `sha256:${createHash('sha256').update(readFileSync(artifactPath)).digest('hex')}`;
}

function currentSourceSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Unable to determine source SHA: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function pnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Unable to determine pnpm version: ${result.stderr}`);
  }
  return result.stdout.trim();
}

export function createReleaseGateReceipt({
  profile,
  sourceSha = currentSourceSha(),
  lockfileHash = hashFile('pnpm-lock.yaml'),
  nodeVersion = process.version,
  packageManagerVersion = pnpmVersion(),
  startedAt,
  finishedAt,
  gateResults,
  artifactPaths = [],
}) {
  assertReleaseGateProfile(profile);
  const profileGateIds = new Set(selectReleaseGates(profile).map(({ id }) => id));
  const results = gateResults.map((result) => {
    if (!profileGateIds.has(result.id)) {
      throw new Error(`Receipt for ${profile} cannot include out-of-profile gate: ${result.id}`);
    }
    return Object.freeze({
      id: result.id,
      status: result.status,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    });
  });

  return Object.freeze({
    schemaVersion: releaseGateReceiptSchemaVersion,
    profile,
    sourceSha,
    lockfileHash,
    nodeVersion,
    packageManager: `pnpm@${packageManagerVersion}`,
    startedAt,
    finishedAt,
    gates: Object.freeze(results),
    artifactHashes: Object.freeze(
      artifactPaths.map((artifactPath) =>
        Object.freeze({
          path: artifactPath,
          hash: hashArtifact(path.resolve(repoRoot, artifactPath)),
        }),
      ),
    ),
  });
}

export function validateReleaseGateReceipt(receipt, expected) {
  const mismatches = [];
  assertReleaseGateProfile(expected.profile);
  if (receipt.schemaVersion !== releaseGateReceiptSchemaVersion) {
    mismatches.push('schemaVersion');
  }
  if (receipt.profile !== expected.profile) {
    mismatches.push('profile');
  }
  if (receipt.sourceSha !== expected.sourceSha) {
    mismatches.push('sourceSha');
  }
  if (receipt.lockfileHash !== expected.lockfileHash) {
    mismatches.push('lockfileHash');
  }

  const actualArtifacts = new Map(
    (receipt.artifactHashes ?? []).map(({ path: artifactPath, hash }) => [artifactPath, hash]),
  );
  for (const { path: artifactPath, hash } of expected.artifactHashes ?? []) {
    if (actualArtifacts.get(artifactPath) !== hash) {
      mismatches.push(`artifactHashes.${artifactPath}`);
    }
  }
  const actualGates = new Map();
  const profileGateIds = new Set(selectReleaseGates(expected.profile).map(({ id }) => id));
  for (const gateResult of receipt.gates ?? []) {
    if (!profileGateIds.has(gateResult.id)) {
      mismatches.push(`gates.${gateResult.id}.profile`);
    }
    if (actualGates.has(gateResult.id)) {
      mismatches.push(`gates.${gateResult.id}.duplicate`);
    }
    actualGates.set(gateResult.id, gateResult);
  }
  const expectedGateIds =
    expected.gateIds ?? selectReleaseGates(expected.profile).map((releaseGate) => releaseGate.id);
  const expectedGateIdSet = new Set(expectedGateIds);
  for (const gateId of actualGates.keys()) {
    if (!expectedGateIdSet.has(gateId)) {
      mismatches.push(`gates.${gateId}.unexpected`);
    }
  }
  for (const gateId of expectedGateIds) {
    if (actualGates.get(gateId)?.status !== 'passed') {
      mismatches.push(`gates.${gateId}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Release gate receipt mismatch: ${mismatches.join(', ')}`);
  }
  return true;
}

function runProfile(profile, { receiptPath }) {
  if (process.env.TILEBORNE_RELEASE_GATE_DRY_RUN === '1') {
    throw new Error('run-profile cannot run with TILEBORNE_RELEASE_GATE_DRY_RUN=1');
  }
  const startedAt = new Date().toISOString();
  const gateResults = [];
  let exitCode = 0;
  for (const releaseGate of selectReleaseGates(profile)) {
    const gateStartedAt = new Date().toISOString();
    const statusCode = runGate(releaseGate, { exitOnFailure: false });
    const gateStatus = statusCode === 0 ? 'passed' : 'failed';
    gateResults.push({
      id: releaseGate.id,
      status: gateStatus,
      startedAt: gateStartedAt,
      finishedAt: new Date().toISOString(),
    });
    if (statusCode !== 0) {
      exitCode = statusCode;
      break;
    }
  }
  const receipt = createReleaseGateReceipt({
    profile,
    startedAt,
    finishedAt: new Date().toISOString(),
    gateResults,
  });
  if (receiptPath !== undefined) {
    const resolvedReceiptPath = path.resolve(repoRoot, receiptPath);
    mkdirSync(path.dirname(resolvedReceiptPath), { recursive: true });
    writeFileSync(resolvedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    console.log(JSON.stringify(receipt, null, 2));
  }
  if (exitCode !== 0) process.exit(exitCode);
}

function usage() {
  console.error(
    'Usage: node scripts/release-gates.mjs <matrix [profile]|list [profile]|run <gate-id>|run-profile <profile> [--receipt path]|run-all [--include-advisory]>',
  );
}

/** @param {string[]} argv */
function main(argv) {
  const [mode, ...args] = argv;
  if (mode === 'matrix') {
    const profile = args.find((argument) => argument !== '--');
    const output = `matrix=${JSON.stringify(createReleaseGateMatrix(profile))}`;
    console.log(output);
    if (process.env.GITHUB_OUTPUT !== undefined) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8');
    }
    return;
  }

  if (mode === 'list') {
    const profile = args.find((argument) => argument !== '--');
    for (const releaseGate of selectReleaseGates(profile)) {
      console.log(
        `${releaseGate.id}\t${releaseGate.profiles.join(',')}\t${releaseGate.required ? 'required' : 'advisory'}\t${releaseGate.label}`,
      );
    }
    return;
  }

  if (mode === 'run') {
    // pnpm preserves the conventional `--` separator for script arguments.
    const runArgs = args.filter((argument) => argument !== '--');
    const [firstArg, secondArg] = runArgs;
    const profile = secondArg === undefined ? undefined : firstArg;
    const gateId = secondArg ?? firstArg;
    let releaseGate;
    try {
      releaseGate = resolveReleaseGate(profile, gateId);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      usage();
      process.exit(2);
    }
    runGate(releaseGate);
    return;
  }

  if (mode === 'run-profile') {
    const profile = args.find((argument) => argument !== '--' && argument !== '--receipt');
    if (profile === undefined) {
      console.error('Missing release gate profile');
      usage();
      process.exit(2);
    }
    const receiptFlagIndex = args.indexOf('--receipt');
    const receiptPath = receiptFlagIndex === -1 ? undefined : args[receiptFlagIndex + 1];
    if (receiptFlagIndex !== -1 && receiptPath === undefined) {
      console.error('Missing --receipt path');
      usage();
      process.exit(2);
    }
    try {
      runProfile(profile, { receiptPath });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }
    return;
  }

  if (mode === 'ci-fast') {
    const changedPaths = args
      .flatMap((argument, index) => (argument === '--changed-path' ? [args[index + 1]] : []))
      .filter((argument) => argument !== undefined);
    runCiFast({
      planOnly: args.includes('--plan'),
      changedPaths: changedPaths.length === 0 ? undefined : changedPaths,
    });
    return;
  }

  if (mode === 'run-all') {
    const includeAdvisory = args.includes('--include-advisory');
    for (const releaseGate of releaseGates) {
      if (releaseGate.required || includeAdvisory) {
        runGate(releaseGate);
      }
    }
    return;
  }

  usage();
  process.exit(2);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2));
}

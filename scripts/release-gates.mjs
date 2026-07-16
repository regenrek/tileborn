import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

/**
 * @typedef {object} ReleaseGate
 * @property {string} id
 * @property {string} label
 * @property {readonly (readonly string[])[]} commands
 * @property {boolean} required
 * @property {boolean} xvfb
 */

/**
 * The single owner of release-gate membership, ordering, commands, and runner
 * requirements. Local `pnpm ci` and GitHub Actions both consume this manifest.
 *
 * @type {readonly ReleaseGate[]}
 */
export const releaseGates = Object.freeze([
  gate('install', 'Frozen install', [['pnpm', 'install', '--frozen-lockfile']]),
  gate('format', 'Format', [['pnpm', 'format:check']]),
  gate('typecheck', 'Typecheck', [['pnpm', 'typecheck']]),
  gate('lint', 'Lint', [['pnpm', 'lint']]),
  gate('test', 'Full tests', [['pnpm', 'test', '--', '--run']]),
  gate('build', 'Build', [['pnpm', 'build']]),
  gate('boundaries', 'Boundary tests', [['pnpm', 'test:boundaries']]),
  gate('cli-e2e', 'CLI e2e', [
    ['pnpm', 'build'],
    ['pnpm', 'test:cli-e2e'],
  ]),
  gate('game-host', 'Game host smoke', [['pnpm', 'test:game-host']]),
  gate('bundled-worker', 'Bundled worker', [
    ['pnpm', '--filter', '@tileborne/game-host', 'build'],
    ['pnpm', '--filter', '@tileborne/game-host', 'verify:bundled-worker'],
  ]),
  gate('services-build-hermetic', 'Hermetic services build', [
    ['pnpm', 'test:services-build-hermetic'],
  ]),
  gate('creator-performance', 'Creator deterministic performance budgets', [
    ['pnpm', 'test:creator-performance'],
  ]),
  gate('docs', 'Docs build', [
    ['pnpm', 'build'],
    ['pnpm', 'docs:build'],
  ]),
  gate(
    'desktop-smoke',
    'Desktop smoke',
    [
      ['pnpm', 'build'],
      ['pnpm', 'test:desktop-smoke'],
    ],
    { xvfb: true },
  ),
  gate(
    'packaged-runtime',
    'Packaged runtime closure',
    [
      ['pnpm', 'build'],
      ['pnpm', '--filter', '@tileborne/desktop', 'test:packaged-smoke'],
    ],
    { xvfb: true },
  ),
  gate('desktop-release-contract', 'Desktop 1.0 release contract', [
    ['pnpm', 'release:desktop:policy'],
    ['pnpm', 'release:desktop:status'],
    ['pnpm', 'release:desktop:docs'],
    ['pnpm', 'test:desktop-release-contract'],
  ]),
  gate('clean-checkout', 'Clean checkout', [['pnpm', 'test:clean-checkout']]),
  gate(
    'creator-performance-native',
    'Creator native performance calibration',
    [['pnpm', '--filter', '@tileborne/desktop', 'test:creator-performance-native']],
    { required: false, xvfb: true },
  ),
  gate(
    'clean-checkout-time',
    'Clean checkout timing',
    [
      ['pnpm', 'test:clean-checkout-time'],
      ['pnpm', 'test:clean-checkout-time:validate'],
    ],
    { required: false, xvfb: true },
  ),
]);

/**
 * @param {string} id
 * @param {string} label
 * @param {readonly (readonly string[])[]} commands
 * @param {{ readonly required?: boolean; readonly xvfb?: boolean }} [options]
 * @returns {ReleaseGate}
 */
function gate(id, label, commands, options = {}) {
  return Object.freeze({
    id,
    label,
    commands: Object.freeze(commands.map((command) => Object.freeze(command))),
    required: options.required ?? true,
    xvfb: options.xvfb ?? false,
  });
}

export function createReleaseGateMatrix() {
  return {
    include: releaseGates.map(({ id, label, required, xvfb }) => ({
      id,
      label,
      required,
      xvfb,
    })),
  };
}

/** @param {readonly string[]} commandParts */
function runCommand(commandParts) {
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
    process.exit(result.status ?? 1);
  }
}

/** @param {ReleaseGate} gateDefinition */
function runGate(gateDefinition) {
  console.log(`\n# Release gate: ${gateDefinition.label} (${gateDefinition.id})`);
  for (const command of gateDefinition.commands) {
    runCommand(command);
  }
}

function usage() {
  console.error(
    'Usage: node scripts/release-gates.mjs <matrix|list|run <gate-id>|run-all [--include-advisory]>',
  );
}

/** @param {string[]} argv */
function main(argv) {
  const [mode, ...args] = argv;
  if (mode === 'matrix') {
    const output = `matrix=${JSON.stringify(createReleaseGateMatrix())}`;
    console.log(output);
    if (process.env.GITHUB_OUTPUT !== undefined) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8');
    }
    return;
  }

  if (mode === 'list') {
    for (const releaseGate of releaseGates) {
      console.log(
        `${releaseGate.id}\t${releaseGate.required ? 'required' : 'advisory'}\t${releaseGate.label}`,
      );
    }
    return;
  }

  if (mode === 'run') {
    // pnpm preserves the conventional `--` separator for script arguments.
    const gateId = args.find((argument) => argument !== '--');
    const releaseGate = releaseGates.find(({ id }) => id === gateId);
    if (releaseGate === undefined) {
      console.error(`Unknown release gate: ${gateId ?? '<missing>'}`);
      usage();
      process.exit(2);
    }
    runGate(releaseGate);
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

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(desktopRoot, '../..');

export function normalizePassthroughArgs(passthroughArgs) {
  return passthroughArgs[0] === '--' ? passthroughArgs.slice(1) : passthroughArgs;
}

export function buildVitestInvocation({
  workspaceRoot: root = workspaceRoot,
  execPath = process.execPath,
  pathModule = path,
  passthroughArgs = process.argv.slice(2),
} = {}) {
  return {
    command: execPath,
    args: [
      pathModule.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      'vitest.electron.config.ts',
      ...normalizePassthroughArgs(passthroughArgs),
    ],
  };
}

export function runElectronSmoke({
  desktopRoot: cwd = desktopRoot,
  env = process.env,
  execPath = process.execPath,
  pathModule = path,
  passthroughArgs = process.argv.slice(2),
  spawn = spawnSync,
  workspaceRoot: root = workspaceRoot,
} = {}) {
  const invocation = buildVitestInvocation({
    workspaceRoot: root,
    execPath,
    pathModule,
    passthroughArgs,
  });

  const result = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  return result.status ?? 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runElectronSmoke());
}

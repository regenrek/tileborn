import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { buildVitestInvocation, runElectronSmoke } from './run-electron-smoke.mjs';

test('invokes Vitest through the Node.js entry point and forwards the selector', () => {
  const invocation = buildVitestInvocation({
    workspaceRoot: '/repo',
    execPath: '/usr/local/bin/node',
    passthroughArgs: ['--', 'src/smoke/acceptance-playtest.electron.test.ts'],
  });

  assert.equal(invocation.command, '/usr/local/bin/node');
  assert.deepEqual(invocation.args, [
    path.join('/repo', 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--config',
    'vitest.electron.config.ts',
    'src/smoke/acceptance-playtest.electron.test.ts',
  ]);
});

test('uses the same JavaScript entry point for Windows-shaped paths', () => {
  let observed;

  const status = runElectronSmoke({
    workspaceRoot: 'C:\\repo',
    desktopRoot: 'C:\\repo\\apps\\desktop',
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    pathModule: path.win32,
    passthroughArgs: ['--', 'src/smoke/acceptance-playtest.electron.test.ts', '--reporter=dot'],
    env: { CI: '1' },
    spawn(command, args, options) {
      observed = { command, args, options };
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.equal(observed.command, 'C:\\Program Files\\nodejs\\node.exe');
  assert.deepEqual(observed.args, [
    'C:\\repo\\node_modules\\vitest\\vitest.mjs',
    'run',
    '--config',
    'vitest.electron.config.ts',
    'src/smoke/acceptance-playtest.electron.test.ts',
    '--reporter=dot',
  ]);
  assert.deepEqual(observed.options, {
    cwd: 'C:\\repo\\apps\\desktop',
    env: { CI: '1' },
    stdio: 'inherit',
  });
});

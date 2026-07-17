import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { buildSmokeWorkerBundle } from './build-worker.js';
import { smokePaths } from './setup.js';

const execFileAsync = promisify(execFile);

const ensureCliBuilt = async (): Promise<void> => {
  const cliMain = path.join(smokePaths.repoRoot, 'packages/cli/dist/main.js');
  try {
    await access(cliMain);
  } catch {
    await execFileAsync('pnpm', ['--filter', '@tileborne/cli', 'build'], {
      cwd: smokePaths.repoRoot,
    });
  }
};

export default async function globalSetup(): Promise<void> {
  await ensureCliBuilt();
  await buildSmokeWorkerBundle();
}

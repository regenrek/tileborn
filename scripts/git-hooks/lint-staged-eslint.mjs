/* global process */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const filesByConfigDirectory = new Map();

for (const file of process.argv.slice(2)) {
  const absoluteFile = path.resolve(file);
  const relativeToRepo = path.relative(repoRoot, absoluteFile);
  if (relativeToRepo.startsWith('..') || path.isAbsolute(relativeToRepo)) {
    process.stderr.write(`Refusing to lint a file outside the repository: ${file}\n`);
    process.exit(2);
  }

  let configDirectory = path.dirname(absoluteFile);
  while (
    configDirectory !== repoRoot &&
    !existsSync(path.join(configDirectory, 'eslint.config.js'))
  ) {
    configDirectory = path.dirname(configDirectory);
  }
  if (!existsSync(path.join(configDirectory, 'eslint.config.js'))) {
    configDirectory = repoRoot;
  }

  const group = filesByConfigDirectory.get(configDirectory) ?? [];
  group.push(path.relative(configDirectory, absoluteFile));
  filesByConfigDirectory.set(configDirectory, group);
}

for (const [configDirectory, files] of filesByConfigDirectory) {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'eslint',
      '--cache',
      '--cache-strategy',
      'content',
      '--no-warn-ignored',
      '--',
      ...files,
    ],
    { cwd: configDirectory, stdio: 'inherit' },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/* global process */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const zeroSha = /^0+$/;
const remoteName = process.argv[2] || 'origin';

const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
};

const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8').trim();
const updates = input
  ? input.split('\n').map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    })
  : [
      {
        localRef: git('symbolic-ref', '--quiet', 'HEAD') ?? 'HEAD',
        localSha: git('rev-parse', 'HEAD'),
        remoteRef: undefined,
        remoteSha: undefined,
      },
    ];

const ranges = new Map();
for (const update of updates) {
  if (!update.localSha || zeroSha.test(update.localSha)) continue;

  const isMainPush = update.localRef === 'refs/heads/main';
  const mainRef = `refs/remotes/${remoteName}/main`;
  const base =
    isMainPush && update.remoteSha && !zeroSha.test(update.remoteSha)
      ? update.remoteSha
      : (git('merge-base', update.localSha, mainRef) ??
        (update.remoteSha && !zeroSha.test(update.remoteSha) ? update.remoteSha : undefined) ??
        git('rev-parse', `${update.localSha}^`));

  if (base) ranges.set(`${base}...${update.localSha}`, { base, head: update.localSha });
}

if (ranges.size === 0) process.exit(0);

if (git('status', '--porcelain')) {
  process.stderr.write(
    'Warning: pre-push verification reads the current working tree, which has local changes.\n',
  );
}

for (const { base, head } of ranges.values()) {
  process.stdout.write(`Verifying affected lint and typecheck for ${base}...${head}\n`);
  const result = spawnSync(
    'pnpm',
    ['turbo', 'run', 'lint', 'typecheck', '--affected', '--output-logs=errors-only'],
    {
      stdio: 'inherit',
      env: { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head },
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

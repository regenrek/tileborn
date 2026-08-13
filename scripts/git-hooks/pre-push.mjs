import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const zeroSha = /^0+$/;
const remoteName = process.argv[2] || 'origin';
const repoRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).stdout.trim();

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

for (const { base, head } of ranges.values()) {
  process.stdout.write(`Verifying pushed formatting and affected lint for ${base}...${head}\n`);
  const changedFiles =
    git('diff', '--name-only', '--diff-filter=ACMR', `${base}...${head}`)
      ?.split('\n')
      .filter(Boolean) ?? [];
  const worktree = mkdtempSync(path.join(os.tmpdir(), 'tileborn-pre-push-'));
  let registeredWorktree = false;
  let status;
  try {
    const checkout = spawnSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, head], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (checkout.error !== undefined) throw checkout.error;
    status = checkout.status ?? 1;
    if (status === 0) {
      registeredWorktree = true;
      const install = spawnSync(
        'pnpm',
        [
          'install',
          '--prefer-offline',
          '--frozen-lockfile',
          '--ignore-scripts',
          '--reporter=append-only',
        ],
        { cwd: worktree, stdio: 'inherit' },
      );
      if (install.error !== undefined) throw install.error;
      status = install.status ?? 1;
    }

    if (status === 0 && changedFiles.length > 0) {
      const format = spawnSync(
        'pnpm',
        ['exec', 'prettier', '--check', '--ignore-unknown', '--', ...changedFiles],
        { cwd: worktree, stdio: 'inherit' },
      );
      if (format.error !== undefined) throw format.error;
      status = format.status ?? 1;
    }

    if (status === 0) {
      const verify = spawnSync(
        'pnpm',
        ['turbo', 'run', 'lint', '--affected', '--only', '--output-logs=errors-only'],
        {
          cwd: worktree,
          stdio: 'inherit',
          env: { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head },
        },
      );
      if (verify.error !== undefined) throw verify.error;
      status = verify.status ?? 1;
    }
  } finally {
    if (registeredWorktree) {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
    }
    rmSync(worktree, { recursive: true, force: true });
  }
  if (status !== 0) process.exit(status);
}

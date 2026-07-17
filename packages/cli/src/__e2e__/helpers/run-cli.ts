import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { cliEntrypoint } from './paths.js';
import { tileborneHome } from './temp-home.js';

const execFileAsync = promisify(execFile);

const STDERR_ERROR_PATTERN = /\b(ERROR|FATAL)\b/i;

let cliChain: Promise<void> = Promise.resolve();

export interface CliRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface RunCliOptions {
  readonly json?: boolean;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly allowStderr?: boolean;
  readonly home?: string;
}

const appendJsonFlag = (args: readonly string[], json: boolean): string[] =>
  json && !args.includes('--json') ? [...args, '--json'] : [...args];

const assertStderrClean = (stderr: string, allowStderr: boolean): void => {
  if (allowStderr || stderr.trim().length === 0) {
    return;
  }
  if (STDERR_ERROR_PATTERN.test(stderr)) {
    throw new Error(`unexpected CLI stderr:\n${stderr}`);
  }
};

export const runCli = async (
  args: readonly string[],
  opts: RunCliOptions = {},
): Promise<CliRunResult> => {
  const previous = cliChain;
  let release!: () => void;
  cliChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  const home = opts.home ?? tileborneHome();
  const argv = appendJsonFlag(args, opts.json ?? false);

  try {
    try {
      const result = await execFileAsync(process.execPath, [cliEntrypoint, ...argv], {
        env: { ...process.env, ...opts.env, TILEBORNE_HOME: home },
        cwd: opts.cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      const stdout = String(result.stdout);
      const stderr = String(result.stderr);
      assertStderrClean(stderr, opts.allowStderr ?? false);
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; code?: number };
      const stdout = String(failed.stdout ?? '');
      const stderr = String(failed.stderr ?? '');
      return {
        stdout,
        stderr,
        code: failed.code ?? 1,
      };
    }
  } finally {
    release();
  }
};

export const runCliJson = async <T>(
  args: readonly string[],
  opts: Omit<RunCliOptions, 'json'> = {},
): Promise<{ result: CliRunResult; payload: T }> => {
  const result = await runCli(args, { ...opts, json: true });
  const payload = JSON.parse(result.stdout) as T;
  return { result, payload };
};

export const expectCliJsonData = async <T>(
  args: readonly string[],
  opts: Omit<RunCliOptions, 'json'> = {},
): Promise<T> => {
  const { result, payload } = await runCliJson<{ readonly ok: boolean; readonly data: T }>(
    args,
    opts,
  );
  if (result.code !== 0) {
    throw new Error(`CLI failed (${result.code}): ${result.stderr}\n${result.stdout}`);
  }
  if (!payload.ok) {
    throw new Error(`CLI JSON not ok: ${result.stdout}`);
  }
  return payload.data;
};

export interface CliJsonErrorPayload {
  readonly error: {
    readonly code: string;
    readonly exitCode: number;
    readonly message: string;
  };
}

export const expectCliJsonError = async (
  args: readonly string[],
  expected: { readonly exitCode: number; readonly code: string },
  opts: Omit<RunCliOptions, 'json'> = {},
): Promise<CliJsonErrorPayload> => {
  const result = await runCli(args, { ...opts, json: true, allowStderr: true });
  if (result.code !== expected.exitCode) {
    throw new Error(
      `expected exit ${expected.exitCode}, got ${result.code}: ${result.stderr}\n${result.stdout}`,
    );
  }
  const payload = JSON.parse(result.stderr) as CliJsonErrorPayload;
  if (payload.error.code !== expected.code) {
    throw new Error(
      `expected error.code ${expected.code}, got ${payload.error.code}: ${result.stderr}`,
    );
  }
  if (payload.error.exitCode !== expected.exitCode) {
    throw new Error(`expected error.exitCode ${expected.exitCode}, got ${payload.error.exitCode}`);
  }
  return payload;
};

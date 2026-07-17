import { spawn } from 'node:child_process';

import { cliEntrypoint } from './paths.js';
import { tileborneHome } from './temp-home.js';

export interface SpawnCliHandle {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly stdout: string;
  readonly stderr: string;
  readonly waitForOutput: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpMatchArray>;
  readonly kill: (signal?: NodeJS.Signals) => void;
  readonly exited: Promise<number | null>;
}

export const spawnCli = (
  args: readonly string[],
  opts: { readonly env?: Record<string, string>; readonly home?: string } = {},
): SpawnCliHandle => {
  const home = opts.home ?? tileborneHome();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const proc = spawn(process.execPath, [cliEntrypoint, ...args], {
    env: { ...process.env, ...opts.env, TILEBORNE_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => stdoutChunks.push(chunk));
  proc.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));

  const exited = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
  });

  const waitForOutput = (pattern: RegExp, timeoutMs = 15_000): Promise<RegExpMatchArray> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const check = (): void => {
        const combined = `${stdoutChunks.join('')}\n${stderrChunks.join('')}`;
        const match = combined.match(pattern);
        if (match) {
          clearInterval(timer);
          resolve(match);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(
            new Error(
              `timed out waiting for ${pattern}\nstdout:\n${stdoutChunks.join('')}\nstderr:\n${stderrChunks.join('')}`,
            ),
          );
        }
      };
      const timer = setInterval(check, 100);
      check();
    });

  return {
    proc,
    get stdout() {
      return stdoutChunks.join('');
    },
    get stderr() {
      return stderrChunks.join('');
    },
    waitForOutput,
    kill: (signal = 'SIGINT') => proc.kill(signal),
    exited,
  };
};

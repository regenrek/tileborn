import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnHandle {
  readonly pid: number | undefined;
  readonly kill: (signal?: NodeJS.Signals) => void;
  readonly exited: Promise<number | null>;
}

export const spawnTracked = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): SpawnHandle => {
  const child: ChildProcess = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stderr.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  return {
    pid: child.pid,
    kill: (signal = 'SIGTERM') => child.kill(signal),
    exited,
  };
};

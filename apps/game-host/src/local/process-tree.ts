import { spawn } from 'node:child_process';

export interface ProcessTreeCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ProcessTreeCommandOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: 'ignore';
}

export interface ProcessTreePlatformAdapter {
  readonly platform: NodeJS.Platform;
  signal(processId: number, signal: NodeJS.Signals | 0): void;
  isTreeAlive(processId: number): boolean;
  runFile(
    executable: string,
    arguments_: readonly string[],
    options: ProcessTreeCommandOptions,
  ): Promise<ProcessTreeCommandResult>;
}

export class ProcessTreeTerminationError extends Error {
  readonly processId: number;

  constructor(processId: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProcessTreeTerminationError';
    this.processId = processId;
  }
}

const assertProcessId = (processId: number): void => {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new ProcessTreeTerminationError(processId, `invalid process-tree pid: ${processId}`);
  }
};

const signalTarget = (platform: NodeJS.Platform, processId: number): number =>
  platform === 'win32' ? processId : -processId;

const isAliveBySignal = (platform: NodeJS.Platform, processId: number): boolean => {
  try {
    process.kill(signalTarget(platform, processId), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const nodeProcessTreePlatform: ProcessTreePlatformAdapter = {
  platform: process.platform,
  signal: (processId, signal) => process.kill(processId, signal),
  isTreeAlive: (processId) => isAliveBySignal(process.platform, processId),
  runFile: (executable, arguments_, options) =>
    new Promise<ProcessTreeCommandResult>((resolve, reject) => {
      const command = spawn(executable, [...arguments_], options);
      command.once('error', reject);
      command.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    }),
};

export const isProcessTreeAlive = (
  processId: number,
  adapter: ProcessTreePlatformAdapter = nodeProcessTreePlatform,
): boolean => {
  assertProcessId(processId);
  return adapter.isTreeAlive(processId);
};

/**
 * Terminate the complete sidecar tree without a shell. POSIX sidecars are
 * session leaders, so a negative pid targets the process group. On Windows,
 * taskkill's `/T /F` contract terminates the pid and every descendant.
 */
export const terminateProcessTree = async (
  processId: number,
  adapter: ProcessTreePlatformAdapter = nodeProcessTreePlatform,
): Promise<void> => {
  assertProcessId(processId);
  if (adapter.platform !== 'win32') {
    try {
      adapter.signal(-processId, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw new ProcessTreeTerminationError(
          processId,
          `failed to terminate POSIX process group ${processId}`,
          { cause: error },
        );
      }
    }
    return;
  }

  let result: ProcessTreeCommandResult;
  try {
    result = await adapter.runFile(
      'taskkill.exe',
      ['/PID', String(processId), '/T', '/F'],
      { shell: false, windowsHide: true, stdio: 'ignore' },
    );
  } catch (error) {
    if (!adapter.isTreeAlive(processId)) return;
    throw new ProcessTreeTerminationError(
      processId,
      `failed to launch Windows process-tree termination for pid ${processId}`,
      { cause: error },
    );
  }
  if (result.exitCode !== 0 && adapter.isTreeAlive(processId)) {
    throw new ProcessTreeTerminationError(
      processId,
      `taskkill /T /F failed for pid ${processId} with exit code ${String(result.exitCode)}`,
    );
  }
};

export const waitForProcessTreeExit = async (
  processId: number,
  adapter: ProcessTreePlatformAdapter = nodeProcessTreePlatform,
): Promise<void> => {
  assertProcessId(processId);
  while (adapter.isTreeAlive(processId)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

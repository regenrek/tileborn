import { describe, expect, it, vi } from 'vitest';

import {
  ProcessTreeTerminationError,
  terminateProcessTree,
  type ProcessTreePlatformAdapter,
} from './process-tree.js';

const makeAdapter = (
  platform: NodeJS.Platform,
  overrides: Partial<ProcessTreePlatformAdapter> = {},
): ProcessTreePlatformAdapter => ({
  platform,
  signal: vi.fn(),
  isTreeAlive: vi.fn(() => false),
  runFile: vi.fn(async () => ({ exitCode: 0, signal: null })),
  ...overrides,
});

describe('process-tree termination', () => {
  it('uses taskkill /T /F without a shell and verifies simulated descendants exited', async () => {
    const alive = new Set([4312, 4313, 4314]);
    const runFile = vi.fn<ProcessTreePlatformAdapter['runFile']>(
      async (executable, arguments_, options) => {
        expect(executable).toBe('taskkill.exe');
        expect(arguments_).toEqual(['/PID', '4312', '/T', '/F']);
        expect(options).toEqual({ shell: false, windowsHide: true, stdio: 'ignore' });
        alive.clear();
        return { exitCode: 0, signal: null };
      },
    );
    const adapter = makeAdapter('win32', {
      runFile,
      isTreeAlive: (processId) => [...alive].some((pid) => pid >= processId),
    });

    await terminateProcessTree(4312, adapter);

    expect(runFile).toHaveBeenCalledOnce();
    expect(alive).toEqual(new Set());
  });

  it('surfaces a structured error when taskkill fails and the tree is still alive', async () => {
    const adapter = makeAdapter('win32', {
      isTreeAlive: () => true,
      runFile: async () => ({ exitCode: 5, signal: null }),
    });

    await expect(terminateProcessTree(7123, adapter)).rejects.toMatchObject({
      name: 'ProcessTreeTerminationError',
      processId: 7123,
      message: 'taskkill /T /F failed for pid 7123 with exit code 5',
    });
  });

  it('treats taskkill launch errors as success only when the tree is already gone', async () => {
    const adapter = makeAdapter('win32', {
      isTreeAlive: () => false,
      runFile: async () => {
        throw new Error('taskkill unavailable');
      },
    });

    await expect(terminateProcessTree(8123, adapter)).resolves.toBeUndefined();
  });

  it('keeps POSIX process-group SIGKILL and rejects non-numeric injection input', async () => {
    const signal = vi.fn<ProcessTreePlatformAdapter['signal']>();
    const runFile = vi.fn<ProcessTreePlatformAdapter['runFile']>();
    const adapter = makeAdapter('darwin', { signal, runFile });

    await terminateProcessTree(9912, adapter);
    expect(signal).toHaveBeenCalledWith(-9912, 'SIGKILL');
    expect(runFile).not.toHaveBeenCalled();

    await expect(terminateProcessTree(Number.NaN, adapter)).rejects.toBeInstanceOf(
      ProcessTreeTerminationError,
    );
    expect(runFile).not.toHaveBeenCalled();
  });
});

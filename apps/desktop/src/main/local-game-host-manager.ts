import path from 'node:path';

import type { LocalGameHost } from '@tileborne/services-build/local-game-host';

let activeHost: LocalGameHost | undefined;

const resolveGameHostWorkerPath = (): string =>
  path.resolve(process.cwd(), '../game-host/dist/worker.js');

export const startDesktopLocalGameHost = async (
  port?: number,
  artifactDirectory?: string,
): Promise<{ readonly baseUrl: string; readonly signingKey: string }> => {
  if (activeHost) {
    await activeHost.stop();
    activeHost = undefined;
  }
  const workerPath =
    artifactDirectory === undefined
      ? resolveGameHostWorkerPath()
      : path.resolve(artifactDirectory, 'worker.js');
  try {
    const { createLocalGameHost } = await import('@tileborne/services-build/local-game-host');
    activeHost = await createLocalGameHost({
      workerPath,
      ...(port === undefined ? {} : { port }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start local game host with worker ${workerPath}: ${message}`, {
      cause: error,
    });
  }
  return { baseUrl: activeHost.baseUrl, signingKey: activeHost.signingKey };
};

export const stopDesktopLocalGameHost = async (): Promise<void> => {
  if (!activeHost) {
    return;
  }
  await activeHost.stop();
  activeHost = undefined;
};

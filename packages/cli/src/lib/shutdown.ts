let signalExitCode: number | undefined;
const cleanups: Array<() => Promise<void>> = [];

export const requestSignalExitCode = (code: number): void => {
  signalExitCode = code;
};

export const signalExitCodeOr = (fallback: number): number => signalExitCode ?? fallback;

export const registerSignalCleanup = (cleanup: () => Promise<void>): void => {
  cleanups.push(cleanup);
};

export const runSignalCleanups = async (): Promise<void> => {
  for (const cleanup of cleanups.splice(0, cleanups.length)) {
    await cleanup();
  }
};

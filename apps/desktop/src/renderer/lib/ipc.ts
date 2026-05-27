import type { IpcError } from '@tileborne/ipc-contracts';

export class TileborneQueryError extends Error {
  readonly ipcError: IpcError | unknown;

  constructor(ipcError: unknown) {
    const message =
      ipcError instanceof Error
        ? ipcError.message
        : typeof ipcError === 'object' &&
            ipcError !== null &&
            'message' in ipcError &&
            typeof ipcError.message === 'string'
          ? ipcError.message
          : 'IPC request failed';
    super(message);
    this.name = 'TileborneQueryError';
    this.ipcError = ipcError;
  }
}

export async function invokeIpc<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new TileborneQueryError(error);
  }
}

export function getIpcError(error: unknown): IpcError | undefined {
  if (error instanceof TileborneQueryError) {
    const inner = error.ipcError;
    if (
      typeof inner === 'object' &&
      inner !== null &&
      '_tag' in inner &&
      typeof inner._tag === 'string'
    ) {
      return inner as IpcError;
    }
  }
  return undefined;
}

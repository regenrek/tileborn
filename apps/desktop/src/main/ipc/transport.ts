import { BrowserWindow, ipcMain } from 'electron';

import type { IpcServerTransport } from '@tileborne/ipc-contracts';

// One frame at 60fps. A synchronous IPC handler that exceeds this has blocked
// the main thread (and therefore every window) long enough to drop frames —
// the Electron anti-pattern that caused the thumbnail/manifest freezes. Warn in
// development so regressions surface immediately instead of as a user-visible
// hang.
const MAIN_THREAD_BLOCK_BUDGET_MS = 16;
const blockWatchdogEnabled = process.env.NODE_ENV !== 'production';

export const createElectronIpcServerTransport = (): IpcServerTransport => ({
  handle: (channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => {
      if (!blockWatchdogEnabled) {
        return handler(payload);
      }
      // Measure only the synchronous portion of the handler (up to when it
      // returns its promise). That is the part that actually blocks the main
      // thread; awaited async I/O afterwards does not and must not be flagged.
      const startedAt = performance.now();
      const result = handler(payload);
      const syncElapsedMs = performance.now() - startedAt;
      if (syncElapsedMs > MAIN_THREAD_BLOCK_BUDGET_MS) {
        console.warn(
          `[tileborne:ipc] handler "${channel}" blocked the main thread for ${syncElapsedMs.toFixed(1)}ms (> ${MAIN_THREAD_BLOCK_BUDGET_MS}ms).`,
        );
      }
      return result;
    });
    return () => {
      ipcMain.removeHandler(channel);
    };
  },
  emit: (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload);
      }
    }
  },
});

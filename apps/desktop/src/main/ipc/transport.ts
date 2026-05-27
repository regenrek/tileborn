import { BrowserWindow, ipcMain } from "electron";

import type { IpcServerTransport } from "@tileborne/ipc-contracts";

export const createElectronIpcServerTransport = (): IpcServerTransport => ({
  handle: (channel, handler) => {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload));
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

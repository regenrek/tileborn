import { contextBridge, ipcRenderer } from "electron";

import {
  buildTilebornePreloadBridge,
  type PreloadIpcTransport,
} from "./browser-bridge.js";

import {
  STARTUP_STATUS_CHANGED_CHANNEL,
  STARTUP_STATUS_GET_CHANNEL,
  type StartupStatusSnapshot,
  type TileborneStartupBridge,
} from "../shared/startup-status.js";

const electronPreloadTransport: PreloadIpcTransport = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload) as Promise<unknown>,
  subscribe: (channel, onPayload) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      onPayload(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

const tileborne = buildTilebornePreloadBridge(electronPreloadTransport);

const tileborneStartup: TileborneStartupBridge = {
  getStatus: () => ipcRenderer.invoke(STARTUP_STATUS_GET_CHANNEL) as Promise<StartupStatusSnapshot>,
  onStatusChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: StartupStatusSnapshot) => {
      handler(snapshot);
    };
    ipcRenderer.on(STARTUP_STATUS_CHANGED_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(STARTUP_STATUS_CHANGED_CHANNEL, listener);
    };
  },
};

contextBridge.exposeInMainWorld("tileborne", tileborne);
contextBridge.exposeInMainWorld("tileborneStartup", tileborneStartup);

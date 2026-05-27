import { contextBridge, ipcRenderer } from "electron";
import { Effect, Option } from "effect";

import {
  buildTileborneBridge,
  IpcTransportError,
  MainEventRegistry,
  MainIpcRegistry,
  type IpcClientTransport,
} from "@tileborne/ipc-contracts";

import {
  STARTUP_STATUS_CHANGED_CHANNEL,
  STARTUP_STATUS_GET_CHANNEL,
  type StartupStatusSnapshot,
  type TileborneStartupBridge,
} from "../shared/startup-status.js";

const electronClientTransport: IpcClientTransport = {
  invoke: (channel, payload) =>
    Effect.tryPromise({
      try: () => ipcRenderer.invoke(channel, payload),
      catch: (cause) =>
        new IpcTransportError({
          channel: Option.none(),
          message: `IPC transport invocation failed for ${channel}`,
          cause: Option.some(String(cause)),
        }),
    }),
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

const tileborne = buildTileborneBridge(
  MainIpcRegistry,
  MainEventRegistry,
  electronClientTransport,
  (effect) => Effect.runPromise(effect),
);

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

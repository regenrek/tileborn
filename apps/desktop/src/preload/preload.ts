import { contextBridge, ipcRenderer } from 'electron';

import { MainEventRegistry, MainIpcRegistry } from '@tileborne/ipc-contracts/bridge';

import type { TileborneIpcTransport } from '../shared/ipc-transport.js';
import {
  APP_CLOSE_REQUESTED_CHANNEL,
  APP_CLOSE_RESOLVED_CHANNEL,
  APP_RECOVERY_STORAGE_COMMIT_CHANNEL,
  APP_RECOVERY_STORAGE_LOAD_CHANNEL,
  type AppCloseRequest,
  type TileborneAppLifecycleBridge,
} from '../shared/app-lifecycle.js';
import {
  STARTUP_STATUS_CHANGED_CHANNEL,
  STARTUP_STATUS_GET_CHANNEL,
  type StartupStatusSnapshot,
  type TileborneStartupBridge,
} from '../shared/startup-status.js';
import type { TileborneDesktopUpdatesBridge } from '../shared/desktop-updates-bridge.js';

const INVOKE_CHANNELS = new Set<string>(
  MainIpcRegistry.contracts.map((contract) => contract.channel),
);
const EVENT_CHANNELS = new Set<string>(MainEventRegistry.events.map((event) => event.channel));

// The preload owns exactly one concern: a channel-allowlisted raw transport.
// Decode/encode lives in the renderer (see src/renderer/lib/tileborne-bridge.ts)
// because contextBridge structured-clones values and would strip schema class
// and Option identity from decoded payloads.
const tileborneIpc: TileborneIpcTransport = {
  invoke: (channel, payload) => {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Unknown Tileborne IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload) as Promise<unknown>;
  },
  subscribe: (channel, onPayload) => {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`Unknown Tileborne event channel: ${channel}`);
    }
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      onPayload(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

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

const tileborneAppLifecycle: TileborneAppLifecycleBridge = {
  onCloseRequested: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, request: AppCloseRequest) => {
      handler(request);
    };
    ipcRenderer.on(APP_CLOSE_REQUESTED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(APP_CLOSE_REQUESTED_CHANNEL, listener);
  },
  resolveClose: (resolution) => {
    ipcRenderer.send(APP_CLOSE_RESOLVED_CHANNEL, resolution);
  },
  loadRecoveryStorage: () =>
    ipcRenderer.invoke(APP_RECOVERY_STORAGE_LOAD_CHANNEL) as ReturnType<
      TileborneAppLifecycleBridge['loadRecoveryStorage']
    >,
  commitRecoveryStorage: (commit) =>
    ipcRenderer.invoke(APP_RECOVERY_STORAGE_COMMIT_CHANNEL, commit) as Promise<void>,
};

const tileborneDesktopUpdates: TileborneDesktopUpdatesBridge = {
  getState: () =>
    ipcRenderer.invoke('tileborne:desktop-updates:getState', {}) as ReturnType<
      TileborneDesktopUpdatesBridge['getState']
    >,
  check: () =>
    ipcRenderer.invoke('tileborne:desktop-updates:check', {}) as ReturnType<
      TileborneDesktopUpdatesBridge['check']
    >,
  restart: () =>
    ipcRenderer.invoke('tileborne:desktop-updates:restart', {}) as ReturnType<
      TileborneDesktopUpdatesBridge['restart']
    >,
  onStateChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      handler(state as Parameters<typeof handler>[0]);
    };
    ipcRenderer.on('tileborne:desktop-updates:stateChanged', listener);
    return () => ipcRenderer.removeListener('tileborne:desktop-updates:stateChanged', listener);
  },
};

contextBridge.exposeInMainWorld('tileborneIpc', tileborneIpc);
contextBridge.exposeInMainWorld('tileborneStartup', tileborneStartup);
contextBridge.exposeInMainWorld('tileborneAppLifecycle', tileborneAppLifecycle);
contextBridge.exposeInMainWorld('tileborneDesktopUpdates', tileborneDesktopUpdates);

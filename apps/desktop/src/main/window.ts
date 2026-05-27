import path from "node:path";
import process from "node:process";

import { app, BrowserWindow } from "electron";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;
const WINDOW_MIN_WIDTH = 1024;
const WINDOW_MIN_HEIGHT = 640;
const DEFAULT_RENDERER_WINDOW_NAME = "main_window";

const resolveRuntimeIconPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.resolve(__dirname, "../../assets/icon.png");

export interface MainWindowLifecycleHooks {
  readonly onRendererLoadStart?: () => void;
  readonly onRendererLoaded?: () => void;
  readonly onRendererLoadFailed?: (error: {
    readonly errorCode: number;
    readonly errorDescription: string;
    readonly validatedURL: string;
  }) => void;
}

export interface CreateMainWindowOptions extends MainWindowLifecycleHooks {
  readonly initialRoutePath?: string;
}

const loadRendererRoute = (window: BrowserWindow, routePath: string): void => {
  const devServerUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "undefined"
      ? undefined
      : MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const rendererName =
    typeof MAIN_WINDOW_VITE_NAME === "undefined"
      ? DEFAULT_RENDERER_WINDOW_NAME
      : MAIN_WINDOW_VITE_NAME;

  if (devServerUrl && process.env.TILEBORNE_SMOKE !== "true") {
    const url = new URL(routePath, devServerUrl);
    void window.loadURL(url.toString());
    return;
  }
  void window.loadFile(
    path.join(__dirname, `../renderer/${rendererName}/index.html`),
    { hash: routePath },
  );
};

export const createMainWindow = (options: CreateMainWindowOptions | string = {}): BrowserWindow => {
  const resolvedOptions =
    typeof options === "string" ? ({ initialRoutePath: options } satisfies CreateMainWindowOptions) : options;
  const initialRoutePath = resolvedOptions.initialRoutePath ?? "/";
  const iconPath = resolveRuntimeIconPath();
  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: true,
    icon: iconPath,
    backgroundColor: "#0f172a",
    // ADR-0012 option A: native OS frame for v1 (custom chrome deferred).
    frame: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Preload bundle transitively imports node:crypto (Effect / ipc-contracts).
      // Sandboxed preloads cannot load node:crypto, so preload fails and window.tileborne
      // is never exposed. contextIsolation + nodeIntegration:false remains secure.
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(iconPath);
  }

  mainWindow.webContents.once("did-start-loading", () => {
    resolvedOptions.onRendererLoadStart?.();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    resolvedOptions.onRendererLoaded?.();
  });
  mainWindow.webContents.once(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      resolvedOptions.onRendererLoadFailed?.({ errorCode, errorDescription, validatedURL });
    },
  );
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  loadRendererRoute(mainWindow, initialRoutePath);

  if (!app.isPackaged && process.env.TILEBORNE_DISABLE_DEVTOOLS !== "true") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  return mainWindow;
};

export const createPlaytestJoinWindow = (input: {
  readonly projectId: string;
  readonly mapId: string;
  readonly baseUrl: string;
  readonly roomId: string;
}): BrowserWindow => {
  const search = new URLSearchParams({
    joinBase: input.baseUrl,
    joinRoom: input.roomId,
  });
  const routePath = `/projects/${encodeURIComponent(input.projectId)}/maps/${encodeURIComponent(input.mapId)}?${search.toString()}`;
  return createMainWindow({ initialRoutePath: routePath });
};

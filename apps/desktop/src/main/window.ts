import path from "node:path";
import process from "node:process";

import { app, BrowserWindow, shell } from "electron";

import {
  installContentSecurityPolicy,
  installNavigationGuards,
  type SecurityContext,
} from "./security.js";

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

const resolveDevServerUrl = (): string | undefined => {
  const devServerUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "undefined"
      ? undefined
      : MAIN_WINDOW_VITE_DEV_SERVER_URL;
  // Smoke runs load the packaged-style bundle (loadFile) even though the dev
  // server constant may be defined, so it is not "dev" for security purposes.
  if (!devServerUrl || process.env.TILEBORNE_SMOKE === "true") {
    return undefined;
  }
  return devServerUrl;
};

/**
 * Resolve the renderer trust context: dev (Vite dev server origin, permissive
 * CSP + HMR) vs prod/smoke (packaged `file://` bundle, strict CSP). Mirrors the
 * dev-vs-packaged branch in {@link loadRendererRoute}.
 */
const resolveSecurityContext = (): SecurityContext => {
  const devServerUrl = resolveDevServerUrl();
  if (devServerUrl === undefined) {
    return { isDev: false, devServerOrigin: undefined };
  }
  try {
    return { isDev: true, devServerOrigin: new URL(devServerUrl).origin };
  } catch {
    return { isDev: false, devServerOrigin: undefined };
  }
};

const loadRendererRoute = (window: BrowserWindow, routePath: string): void => {
  const devServerUrl = resolveDevServerUrl();
  const rendererName =
    typeof MAIN_WINDOW_VITE_NAME === "undefined"
      ? DEFAULT_RENDERER_WINDOW_NAME
      : MAIN_WINDOW_VITE_NAME;

  if (devServerUrl) {
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
      // sandbox stays OFF (follow-up to re-enable). The preload bridge
      // (preload.ts -> @tileborne/ipc-contracts `buildTileborneBridge` + Effect)
      // bundles a dependency graph that *eagerly* `require()`s Node core modules
      // at module top: `node:path`, `node:fs/promises`, `stream`, `module`
      // (verified in .vite/build/preload.cjs lines 3-7; further lazy requires of
      // `fs`/`os`/`child_process`/`node:url` exist deeper). A sandboxed preload
      // can only require `electron` + a tiny polyfilled subset, so those eager
      // requires throw and window.tileborne is never exposed. node:crypto is NOT
      // the blocker (core derives UUIDs via a pure in-repo SHA-256). Re-enabling
      // sandbox needs an Effect/ipc-contracts preload entry with a pure-browser
      // graph — invasive, so deferred. contextIsolation + nodeIntegration:false
      // (+ the navigation allowlist and CSP below) keep the boundary secure.
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(iconPath);
  }

  // ADR-0003 trust boundary: lock down navigation, contain window.open, and set
  // a Content-Security-Policy on the renderer document. The CSP is applied to
  // the window's session (shared default session; re-registration is
  // idempotent) and the navigation guards to this window's webContents.
  const securityContext = resolveSecurityContext();
  installContentSecurityPolicy(mainWindow.webContents.session, securityContext);
  installNavigationGuards(mainWindow.webContents, securityContext, (url) => {
    void shell.openExternal(url);
  });

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

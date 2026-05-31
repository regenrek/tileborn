import process from "node:process";

import { app, BrowserWindow, ipcMain, protocol } from "electron";

import { ASSET_PROTOCOL_SCHEME } from "./asset-library/asset-protocol.js";
import { createStartupReporter } from "./startup-reporter.js";
import { createMainWindow } from "./window.js";
import {
  STARTUP_STATUS_CHANGED_CHANNEL,
  STARTUP_STATUS_GET_CHANNEL,
  createStartupStatusStore,
  type StartupStatusStore,
} from "../shared/startup-status.js";
import type { DesktopStartupController } from "./startup.js";

// Dev-only: expose CDP for native-devtools-mcp (and other CDP clients). Never in packaged builds.
const cdpPort =
  process.env.TILEBORNE_E2E === "1" ? undefined : process.env.TILEBORNE_REMOTE_DEBUGGING_PORT;
if (!app.isPackaged && cdpPort !== undefined && cdpPort.length > 0) {
  app.commandLine.appendSwitch("remote-debugging-port", cdpPort);
}

// Privileged scheme for streaming installed pack assets (atlases, manifests)
// directly to the renderer. Must run before `app.ready`. The renderer loads
// these via `<img src>` / `fetch`, so decoding happens off the main thread
// instead of base64 data URLs over IPC. See asset-protocol.ts.
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      // The renderer runs on an http(s)/file origin, so `fetch()` to this
      // scheme (viewport atlas loader, manifest load) is cross-origin and must
      // opt into CORS; the handler also returns an Access-Control-Allow-Origin
      // header. Without this, fetch() is blocked while <img> (no-cors) still
      // works.
      corsEnabled: true,
    },
  },
]);

const skipSingleInstance = process.env.TILEBORNE_SMOKE === "true";
const gotSingleInstanceLock = skipSingleInstance || app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  const startupStatus = createStartupStatusStore();
  const startupReporter = createStartupReporter(startupStatus);
  let startupController: DesktopStartupController | undefined;
  let quitting = false;

  const registerStartupIpc = (status: StartupStatusStore): (() => void) => {
    ipcMain.handle(STARTUP_STATUS_GET_CHANNEL, () => status.getSnapshot());
    const unsubscribe = status.subscribe((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(STARTUP_STATUS_CHANGED_CHANNEL, snapshot);
        }
      }
    });
    return () => {
      unsubscribe();
      ipcMain.removeHandler(STARTUP_STATUS_GET_CHANNEL);
    };
  };

  const unregisterStartupIpc = registerStartupIpc(startupStatus);

  const failStartup = (message: string, cause: unknown): void => {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    console.error(`[tileborne:start] ${message}: ${errorMessage}`);
    startupReporter.fail("background-startup", "failed", `${message}: ${errorMessage}`);
  };

  app.on("second-instance", () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow === undefined) {
      return;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.focus();
  });

  startupReporter.begin("app-ready");
  app.whenReady().then(() => {
    startupReporter.complete("app-ready");
    startupReporter.begin("create-load-window");
    createMainWindow({
      onRendererLoaded: () => {
        startupReporter.complete("create-load-window");
      },
      onRendererLoadFailed: ({ errorCode, errorDescription, validatedURL }) => {
        startupReporter.fail(
          "create-load-window",
          "failed",
          `${errorDescription} (${errorCode}) while loading ${validatedURL}`,
        );
      },
    });

    void import("./startup.js")
      .then(({ createDesktopStartupController }) => {
        startupController = createDesktopStartupController({
          status: startupStatus,
          reporter: startupReporter,
        });
        return startupController.start();
      })
      .catch((cause) => {
        failStartup("Failed to start Tileborne desktop domain", cause);
      });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  }).catch((cause) => {
    startupReporter.fail("app-ready", "failed", cause);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (quitting) {
      return;
    }
    quitting = true;
    event.preventDefault();
    void (startupController?.shutdown() ?? Promise.resolve()).then(
      () => {
        unregisterStartupIpc();
        app.exit(0);
      },
      (cause) => {
        console.error("[tileborne:start] Shutdown failed", cause);
        unregisterStartupIpc();
        app.exit(1);
      },
    );
  });

  process.on("uncaughtException", (error) => {
    console.error("[tileborne:start] Uncaught main-process exception", error);
    startupReporter.fail("background-startup", "failed", error);
    if (!quitting) {
      app.exit(1);
    }
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[tileborne:start] Unhandled main-process rejection", reason);
    startupReporter.fail("background-startup", "failed", reason);
    if (!quitting) {
      app.exit(1);
    }
  });
}

import process from 'node:process';
import path from 'node:path';

import { app, BrowserWindow, ipcMain, protocol } from 'electron';

import { ASSET_PROTOCOL_SCHEME } from './asset-library/asset-protocol.js';
import { createStartupReporter } from './startup-reporter.js';
import { createMainWindow } from './window.js';
import { createDocumentRecoveryStore } from './document-recovery-store.js';
import {
  STARTUP_STATUS_CHANGED_CHANNEL,
  STARTUP_STATUS_GET_CHANNEL,
  createStartupStatusStore,
  type StartupStatusStore,
} from '../shared/startup-status.js';
import type { DesktopStartupController } from './startup.js';
import {
  APP_RECOVERY_STORAGE_COMMIT_CHANNEL,
  APP_RECOVERY_STORAGE_LOAD_CHANNEL,
  type AppRecoveryStorageCommit,
} from '../shared/app-lifecycle.js';

// Dev-only: expose CDP for native-devtools-mcp (and other CDP clients). Never in packaged builds.
const cdpPort =
  process.env.TILEBORNE_E2E === '1' ? undefined : process.env.TILEBORNE_REMOTE_DEBUGGING_PORT;
if (!app.isPackaged && cdpPort !== undefined && cdpPort.length > 0) {
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
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

const skipSingleInstance = process.env.TILEBORNE_SMOKE === 'true';
const gotSingleInstanceLock = skipSingleInstance || app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  const startupStatus = createStartupStatusStore();
  const startupReporter = createStartupReporter(startupStatus);
  const recoveryStore = createDocumentRecoveryStore(
    path.join(app.getPath('userData'), 'recovery', 'documents.json'),
  );
  let startupController: DesktopStartupController | undefined;
  let quitting = false;
  let quitRequested = false;
  let exited = false;

  // Hard cap on shutdown. A stuck cleanup must never keep the process — and the
  // dev CDP remote-debugging port (e.g. 9323) — alive as an orphan that a later
  // `dev:cdp` start cannot rebind (t-wk7b). After this, force a clean exit.
  const SHUTDOWN_TIMEOUT_MS = 5_000;

  const registerStartupIpc = (status: StartupStatusStore): (() => void) => {
    ipcMain.handle(STARTUP_STATUS_GET_CHANNEL, () => status.getSnapshot());
    ipcMain.handle(APP_RECOVERY_STORAGE_LOAD_CHANNEL, () => recoveryStore.load());
    ipcMain.handle(
      APP_RECOVERY_STORAGE_COMMIT_CHANNEL,
      (_event, commit: AppRecoveryStorageCommit) => recoveryStore.commit(commit),
    );
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
      ipcMain.removeHandler(APP_RECOVERY_STORAGE_LOAD_CHANNEL);
      ipcMain.removeHandler(APP_RECOVERY_STORAGE_COMMIT_CHANNEL);
    };
  };

  const unregisterStartupIpc = registerStartupIpc(startupStatus);

  const closeLifecycleHooks = {
    onCloseCancelled: () => {
      quitRequested = false;
    },
    onClosed: () => {
      if (quitRequested && BrowserWindow.getAllWindows().length === 0) {
        beginShutdown();
      }
    },
  } as const;

  const failStartup = (message: string, cause: unknown): void => {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    console.error(`[tileborne:start] ${message}: ${errorMessage}`);
    startupReporter.fail('background-startup', 'failed', `${message}: ${errorMessage}`);
  };

  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (existingWindow === undefined) {
      return;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.focus();
  });

  startupReporter.begin('app-ready');
  app
    .whenReady()
    .then(() => {
      startupReporter.complete('app-ready');
      startupReporter.begin('create-load-window');
      createMainWindow({
        onRendererLoaded: () => {
          startupReporter.complete('create-load-window');
        },
        onRendererLoadFailed: ({ errorCode, errorDescription, validatedURL }) => {
          startupReporter.fail(
            'create-load-window',
            'failed',
            `${errorDescription} (${errorCode}) while loading ${validatedURL}`,
          );
        },
        ...closeLifecycleHooks,
      });

      void import('./startup.js')
        .then(({ createDesktopStartupController }) => {
          startupController = createDesktopStartupController({
            status: startupStatus,
            reporter: startupReporter,
          });
          return startupController.start();
        })
        .catch((cause) => {
          failStartup('Failed to start Tileborne desktop domain', cause);
        });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow(closeLifecycleHooks);
        }
      });
    })
    .catch((cause) => {
      startupReporter.fail('app-ready', 'failed', cause);
    });

  app.on('window-all-closed', () => {
    if (quitRequested || process.platform !== 'darwin') {
      beginShutdown();
    }
  });

  // Exit exactly once and release OS resources (the CDP port is freed with the
  // process). Used by both the normal shutdown path and the timeout safety net.
  const finalizeExit = (code: number): void => {
    if (exited) {
      return;
    }
    exited = true;
    unregisterStartupIpc();
    app.exit(code);
  };

  const beginShutdown = (): void => {
    if (quitting) {
      return;
    }
    quitting = true;

    const forceExit = setTimeout(() => {
      console.warn(
        '[tileborne:start] Shutdown timed out; forcing exit to release resources (port)',
      );
      finalizeExit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref?.();

    void (startupController?.shutdown() ?? Promise.resolve()).then(
      () => {
        clearTimeout(forceExit);
        finalizeExit(0);
      },
      (cause) => {
        // Shutdown is designed not to reject (see startup.ts / runtime.ts), but
        // never strand the process if it somehow does — exit cleanly so the
        // CDP port is released instead of leaving an orphan.
        console.error('[tileborne:start] Shutdown error (exiting cleanly anyway)', cause);
        clearTimeout(forceExit);
        finalizeExit(0);
      },
    );
  };

  app.on('before-quit', (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
    if (windows.length === 0) {
      beginShutdown();
      return;
    }
    quitRequested = true;
    for (const window of windows) {
      window.close();
    }
  });

  // Translate process signals (e.g. electron-forge `rs` restart sends SIGTERM,
  // a terminal Ctrl+C sends SIGINT) into a graceful `app.quit()` so cleanup runs
  // and the process reliably exits, releasing the CDP debugging port instead of
  // orphaning it (t-wk7b).
  const requestQuitOnSignal = (signal: NodeJS.Signals): void => {
    console.warn(`[tileborne:start] Received ${signal}; shutting down`);
    app.quit();
  };
  process.once('SIGTERM', () => requestQuitOnSignal('SIGTERM'));
  process.once('SIGINT', () => requestQuitOnSignal('SIGINT'));

  process.on('uncaughtException', (error) => {
    console.error('[tileborne:start] Uncaught main-process exception', error);
    startupReporter.fail('background-startup', 'failed', error);
    if (!quitting) {
      app.exit(1);
    }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[tileborne:start] Unhandled main-process rejection', reason);
    startupReporter.fail('background-startup', 'failed', reason);
    if (!quitting) {
      app.exit(1);
    }
  });
}

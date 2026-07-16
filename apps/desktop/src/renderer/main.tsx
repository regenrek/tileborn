// Install Pixi v8's eval-free program system BEFORE any Pixi renderer is
// created/used (the runtime's PixiRendererAdapter does `new Application()` at
// mount). This side-effect import patches Pixi's shader/UBO/uniform/particle
// systems to compile programs without `new Function`, so the renderer runs
// under the strict prod CSP (no 'unsafe-eval'). Must stay the first import so
// it executes before any module that touches pixi.js classes.
import 'pixi.js/unsafe-eval';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { StartupBoundary } from '@/components/startup/startup-boundary';
import { queryClient } from '@/lib/query-client';
import { installTileborneBridge } from '@/lib/tileborne-bridge';
import {
  initializeDocumentRecoveryStorage,
  installDocumentBeforeUnload,
  installGracefulAppClose,
} from '@/lib/document-lifecycle';
import { router } from '@/router';
import type { AppRecoveryStorageDiagnostic } from '../shared/app-lifecycle';

import './index.css';
import '@tileborne/ui/styles/index.css';

if (
  typeof window === 'undefined' ||
  !window.tileborneIpc ||
  !window.tileborneStartup ||
  !window.tileborneAppLifecycle
) {
  document.body.innerHTML =
    '<pre style="font:14px/1.5 monospace;padding:1.5rem;color:#f87171;background:#1e1e1e;">' +
    'Tileborne preload transport missing (window.tileborneIpc / window.tileborneStartup).\n\n' +
    'The preload script likely failed to load. Open DevTools and check for:\n' +
    '  • "Unable to load preload script"\n' +
    '  • node:crypto / sandbox errors in the main process log\n\n' +
    'Fix: ensure apps/desktop/src/main/window.ts has sandbox: false.</pre>';
  throw new Error(
    'Tileborne preload transport missing. Check main process logs for "Unable to load preload script".',
  );
}

// Build the typed window.tileborne bridge in the renderer realm BEFORE any
// component renders: decoding on this side of contextBridge is what preserves
// schema class instances and Option identity (see lib/tileborne-bridge.ts).
installTileborneBridge();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const devtoolsEnabled = import.meta.env.DEV && import.meta.env.VITE_TILEBORNE_DEVTOOLS === '1';

function RecoveryStorageWarning({
  diagnostic,
}: {
  readonly diagnostic: AppRecoveryStorageDiagnostic;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
      <div
        role="alert"
        data-testid="recovery-storage-warning"
        className="pointer-events-auto max-w-2xl rounded-md border border-amber-500/40 bg-background/95 p-3 text-sm shadow-lg"
      >
        <div className="font-medium">Draft recovery was repaired</div>
        <div className="mt-1 text-muted-foreground">{diagnostic.message}</div>
        <div className="mt-1 break-all text-xs text-muted-foreground">
          Quarantined copy: {diagnostic.quarantinedFile}
        </div>
        <button
          type="button"
          className="mt-2 text-xs font-medium text-foreground underline"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

void initializeDocumentRecoveryStorage().then((recoveryDiagnostic) => {
  installDocumentBeforeUnload();
  installGracefulAppClose();
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StartupBoundary>
          <RouterProvider router={router} />
        </StartupBoundary>
        {recoveryDiagnostic === undefined ? null : (
          <RecoveryStorageWarning diagnostic={recoveryDiagnostic} />
        )}
        {devtoolsEnabled ? (
          <>
            <ReactQueryDevtools initialIsOpen={false} />
            <TanStackRouterDevtools router={router} position="bottom-right" />
          </>
        ) : null}
      </QueryClientProvider>
    </StrictMode>,
  );
});

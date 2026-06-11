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
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StartupBoundary } from '@/components/startup/startup-boundary';
import { queryClient } from '@/lib/query-client';
import { installTileborneBridge } from '@/lib/tileborne-bridge';
import { router } from '@/router';

import './index.css';
import '@tileborne/ui/styles/index.css';

if (typeof window === 'undefined' || !window.tileborneIpc || !window.tileborneStartup) {
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

const devtoolsEnabled =
  import.meta.env.DEV && import.meta.env.VITE_TILEBORNE_DEVTOOLS === '1';

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <StartupBoundary>
        <RouterProvider router={router} />
      </StartupBoundary>
      {devtoolsEnabled ? (
        <>
          <ReactQueryDevtools initialIsOpen={false} />
          <TanStackRouterDevtools router={router} position="bottom-right" />
        </>
      ) : null}
    </QueryClientProvider>
  </StrictMode>,
);

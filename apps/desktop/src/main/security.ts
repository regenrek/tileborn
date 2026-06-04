import type { Session, WebContents } from "electron";

import { ASSET_PROTOCOL_SCHEME } from "./asset-library/asset-protocol-url.js";

/**
 * Renderer/preload/main trust-boundary hardening for the desktop shell
 * (ADR-0003): a navigation allowlist, a `window.open` containment handler, and a
 * Content-Security-Policy applied to the loaded renderer document.
 *
 * Pure policy builders (`buildContentSecurityPolicy`, `isNavigationAllowed`) take
 * no Electron values and are unit tested in security.test.ts. The wiring helpers
 * receive their Electron collaborators as arguments so this module never imports
 * an Electron runtime value (only types, which are erased), keeping it loadable
 * in a jsdom/node test environment.
 */

/** CSP source for the privileged `tileborne-asset` scheme (e.g. `tileborne-asset:`). */
const ASSET_SCHEME_SOURCE = `${ASSET_PROTOCOL_SCHEME}:`;

/**
 * Loopback origins for the local game host (Miniflare, default
 * `http://127.0.0.1:8787`, see apps/game-host/src/local/launcher.ts). The
 * renderer fetches `/rooms/...` over http and opens a `ws://` connection for
 * multiplayer playtests; the chosen port can vary, so allow loopback on any
 * port for both http and ws (never wildcard-external hosts).
 */
const LOCAL_GAME_HOST_SOURCES = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
] as const;

export interface SecurityContext {
  /**
   * True only when the renderer is served by the Vite dev server (unpackaged,
   * dev-server URL present, not the packaged-bundle smoke path). Gates the
   * permissive HMR-friendly CSP; prod/smoke get the strict policy.
   */
  readonly isDev: boolean;
  /**
   * Origin the renderer document is served from in dev (e.g.
   * `http://localhost:5173`). Undefined when loading the packaged `file://`
   * bundle. Used to allow the dev origin + its HMR websocket and to scope the
   * navigation allowlist.
   */
  readonly devServerOrigin?: string | undefined;
}

const httpOriginToWebSocket = (origin: string): string =>
  origin.replace(/^http(s?):\/\//i, (_match, secure: string) => `ws${secure}://`);

/**
 * Build the Content-Security-Policy string for the renderer document.
 *
 * Prod: scripts only from the app's own `file://` origin (`'self'`) plus
 * `'unsafe-eval'`. The `'unsafe-eval'` is NOT optional today: Pixi v8's default
 * renderer generates shader programs via `new Function`, and without eval it
 * throws "RendererInitError: ... does not allow unsafe-eval" and the map canvas
 * never mounts. The eval-free fix lives in the renderer (import
 * `pixi.js/unsafe-eval` and install its no-eval program system); once that lands
 * `'unsafe-eval'` can be dropped from prod. See window.ts / report follow-up.
 * `'unsafe-inline'` is kept for *styles* only (Base UI / Pixi set inline
 * `style` attributes at runtime); the prod bundle ships scripts/CSS as external
 * files (verified: no inline bootstrap script), so inline *scripts* stay blocked.
 *
 * Dev (permissive): additionally allows the Vite dev origin plus inline scripts
 * and the HMR websocket, which the dev server legitimately needs.
 */
export const buildContentSecurityPolicy = (context: SecurityContext): string => {
  const devOrigin = context.isDev ? context.devServerOrigin : undefined;
  const devWebSocket = devOrigin ? httpOriginToWebSocket(devOrigin) : undefined;

  // 'unsafe-eval' is required by Pixi v8's default GenerateProgram path until the
  // renderer adopts pixi.js/unsafe-eval (follow-up). Inline scripts remain
  // blocked in prod (none are emitted) and are only relaxed for Vite dev below.
  const scriptSrc = ["'self'", "'unsafe-eval'"];
  if (devOrigin) {
    scriptSrc.push("'unsafe-inline'", devOrigin);
  }

  const styleSrc = ["'self'", "'unsafe-inline'"];
  if (devOrigin) {
    styleSrc.push(devOrigin);
  }

  const imgSrc = ["'self'", "data:", "blob:", ASSET_SCHEME_SOURCE];
  if (devOrigin) {
    imgSrc.push(devOrigin);
  }

  const fontSrc = ["'self'", "data:", ASSET_SCHEME_SOURCE];
  if (devOrigin) {
    fontSrc.push(devOrigin);
  }

  const mediaSrc = ["'self'", "blob:", "data:", ASSET_SCHEME_SOURCE];

  // `data:`/`blob:` are required in connect-src (not just img-src): Pixi's asset
  // loader FETCHES bundled textures supplied as `data:image/png` / blob URLs
  // (e.g. bundled player-model + projectile textures in playtest), and a fetch
  // is governed by connect-src — without these it fails with "Failed to fetch"
  // and entities fall back to missing textures.
  const connectSrc = ["'self'", "data:", "blob:", ASSET_SCHEME_SOURCE, ...LOCAL_GAME_HOST_SOURCES];
  if (devOrigin) {
    connectSrc.push(devOrigin);
  }
  if (devWebSocket) {
    connectSrc.push(devWebSocket);
  }

  const workerSrc = ["'self'", "blob:"];
  if (devOrigin) {
    workerSrc.push(devOrigin);
  }

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `img-src ${imgSrc.join(" ")}`,
    `font-src ${fontSrc.join(" ")}`,
    `media-src ${mediaSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `worker-src ${workerSrc.join(" ")}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ];

  return directives.join("; ");
};

/**
 * Decide whether a top-level navigation to `targetUrl` is allowed. Only the
 * app's own document origin may be navigated to: the dev server origin in dev,
 * or the packaged `file://` bundle in prod. Everything else (external http(s),
 * arbitrary schemes) is denied. The renderer uses hash routing, so legitimate
 * in-app route changes never trigger `will-navigate`.
 */
export const isNavigationAllowed = (targetUrl: string, context: SecurityContext): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  // Packaged app document is loaded via loadFile -> file:// origin.
  if (parsed.protocol === "file:") {
    return true;
  }

  // Dev: only the exact dev server origin (scheme + host + port) is the app.
  if (context.devServerOrigin) {
    try {
      if (parsed.origin === new URL(context.devServerOrigin).origin) {
        return true;
      }
    } catch {
      // Malformed dev origin: fall through to deny.
    }
  }

  return false;
};

/**
 * Whether a `window.open` / target=_blank URL may be handed to the OS browser.
 * Only explicit https links leave the app; everything else is contained.
 */
export const isExternalOpenAllowed = (targetUrl: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "https:";
};

/**
 * Apply the CSP as a response header on the renderer's document responses.
 *
 * Setting it on the document (mainFrame/subFrame) is sufficient — the policy
 * then governs every subresource the document loads. We deliberately leave
 * other responses (e.g. `tileborne-asset:` image/fetch responses, which set
 * their own CORS/cache headers) untouched.
 *
 * `onHeadersReceived` supports a single listener per session; calling this more
 * than once on the same session simply replaces the handler (idempotent).
 */
export const installContentSecurityPolicy = (
  session: Session,
  context: SecurityContext,
): void => {
  const policy = buildContentSecurityPolicy(context);
  session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") {
      // Leave non-document responses untouched (omitting responseHeaders keeps
      // the originals), e.g. the asset protocol's own CORS/cache headers.
      callback({});
      return;
    }
    const responseHeaders: Record<string, string[]> = { ...details.responseHeaders };
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === "content-security-policy") {
        delete responseHeaders[key];
      }
    }
    responseHeaders["Content-Security-Policy"] = [policy];
    callback({ responseHeaders });
  });
};

/**
 * Install the navigation allowlist + `window.open` containment on a webContents.
 * `openExternal` is injected (electron `shell.openExternal`) so this module
 * stays free of Electron runtime imports.
 */
export const installNavigationGuards = (
  webContents: WebContents,
  context: SecurityContext,
  openExternal: (url: string) => void,
): void => {
  webContents.on("will-navigate", (event, url) => {
    if (isNavigationAllowed(url, context)) {
      return;
    }
    event.preventDefault();
  });

  webContents.setWindowOpenHandler((details) => {
    if (isExternalOpenAllowed(details.url)) {
      openExternal(details.url);
    }
    return { action: "deny" };
  });
};

#!/usr/bin/env node
/**
 * Tileborne v0.1.0 Live-CDP walkthrough runner.
 *
 * Connects to an already-running `dev:cdp` session, executes Done-definition steps,
 * saves screenshots under `.refs/v0.1.0-walkthrough/`, prints PASS/FAIL per step,
 * and exits non-zero on the first failure.
 *
 * See scripts/live-cdp-walkthrough.md for the human-readable script.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const CDP_BASE = process.env.TILEBORNE_CDP_URL ?? 'http://127.0.0.1:9323';
const SCREENSHOT_DIR = path.join(REPO_ROOT, '.refs', 'v0.1.0-walkthrough');
const DEFAULT_STEP_TIMEOUT_MS = Number(process.env.WALKTHROUGH_STEP_TIMEOUT_MS ?? 60_000);
const BR_LOOP_TIMEOUT_MS = Number(process.env.WALKTHROUGH_BR_TIMEOUT_MS ?? 300_000);

const SAMPLE_ASSET_PACK_ID = 'pack:550e8400-e29b-41d4-a716-446655440099';
const BATTLE_ROYALE_PLUGIN_ID = '@tileborne-plugins/battle-royale';
const BATTLE_ROYALE_PLUGIN_SOURCE = path.join(REPO_ROOT, 'packages', 'plugin-battle-royale');
const FORBIDDEN_DOM_PATTERN = /not implemented|stub/i;
const IS_DARWIN = process.platform === 'darwin';

/** @type {{ projectName: string; projectId: string; mapId: string; secondaryClient?: CdpPage | null }} */
const ctx = {
  projectName: `CDP Walkthrough ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
  projectId: '',
  mapId: '',
  secondaryClient: null,
};

class CdpProtocolError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'CdpProtocolError';
    this.details = details;
  }
}

class StepFailure extends Error {
  constructor(stepId, message, cause) {
    super(`[${stepId}] ${message}`);
    this.name = 'StepFailure';
    this.stepId = stepId;
    this.cause = cause;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codeForShortcutKey(key) {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^\d$/.test(key)) {
    return `Digit${key}`;
  }
  return key;
}

function virtualKeyCodeForShortcutKey(key) {
  if (key === 'Escape') {
    return 27;
  }
  if (/^[a-z0-9]$/i.test(key)) {
    return key.toUpperCase().charCodeAt(0);
  }
  return undefined;
}

function modKeyDispatchParams(key, type) {
  const params = {
    type,
    key,
    code: codeForShortcutKey(key),
    modifiers: IS_DARWIN ? 4 : 2,
  };
  const virtualKeyCode = virtualKeyCodeForShortcutKey(key);
  if (virtualKeyCode !== undefined) {
    params.windowsVirtualKeyCode = virtualKeyCode;
    params.nativeVirtualKeyCode = virtualKeyCode;
  }
  return params;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function isTilebornePageTarget(target) {
  if (target.type !== 'page') {
    return false;
  }
  const url = target.url ?? '';
  if (url.startsWith('devtools://')) {
    return false;
  }
  return (
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('tileborne') ||
    url.endsWith('/index.html')
  );
}

class CdpPage {
  /** @param {string} wsUrl @param {string} label */
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    /** @type {WebSocket | null} */
    this.ws = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>} */
    this.pending = new Map();
    /** @type {string[]} */
    this.consoleMessages = [];
    /** @type {string[]} */
    this.consoleErrors = [];
    /** @type {string[]} */
    this.pageErrors = [];
    this.enabled = false;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws) {
        reject(new Error('WebSocket not created'));
        return;
      }
      ws.addEventListener('open', () => resolve(undefined), { once: true });
      ws.addEventListener(
        'error',
        () => reject(new Error(`CDP WebSocket failed for ${this.label}`)),
        { once: true },
      );
    });

    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.method === 'Runtime.consoleAPICalled') {
        const level = payload.params?.type;
        const args = (payload.params?.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ');
        this.consoleMessages.push(args);
        if (level === 'error') {
          this.consoleErrors.push(args);
        }
        return;
      }
      if (payload.method === 'Runtime.exceptionThrown') {
        const details = payload.params?.exceptionDetails;
        const text =
          details?.exception?.description ??
          details?.text ??
          JSON.stringify(details ?? payload.params);
        this.pageErrors.push(String(text));
        return;
      }
      if (payload.id === undefined) {
        return;
      }
      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }
      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new CdpProtocolError(`${pending.method} failed`, payload.error));
        return;
      }
      pending.resolve(payload.result);
    });

    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');
    this.enabled = true;
  }

  async close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }

  /** @param {string} method @param {Record<string, unknown>} [params] */
  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP socket not open (${this.label})`));
    }
    const id = this.nextId++;
    const message = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(message));
    });
  }

  /**
   * @param {string} expression
   * @param {boolean} [awaitPromise]
   */
  async evaluate(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    const remoteObject = result.result;
    if (remoteObject?.subtype === 'error' || result.exceptionDetails) {
      throw new CdpProtocolError(
        'Runtime.evaluate exception',
        result.exceptionDetails ?? remoteObject,
      );
    }
    return remoteObject?.value;
  }

  async navigateHash(routePath) {
    const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
    await this.evaluate(`
      (() => {
        const routePath = ${JSON.stringify(normalized)};
        if (window.location.protocol === 'file:') {
          window.location.hash = routePath;
          return;
        }
        window.history.pushState({}, '', routePath);
        window.dispatchEvent(new PopStateEvent('popstate'));
      })()
    `);
    await this.waitFor(
      () =>
        this.evaluate(`
          (() => {
            const routePath = window.location.hash.replace(/^#/, '') || window.location.pathname;
            return decodeURIComponent(routePath).startsWith(${JSON.stringify(normalized.split('?')[0])});
          })()
        `),
      { timeoutMs: DEFAULT_STEP_TIMEOUT_MS, description: `navigate ${normalized}` },
    );
    await this.waitFor(() => this.evaluate(`typeof window.tileborne === 'object'`), {
      timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
      description: 'window.tileborne ready',
    });
    await sleep(300);
  }

  async dispatchModShortcut(key) {
    await this.send('Input.dispatchKeyEvent', modKeyDispatchParams(key, 'rawKeyDown'));
    await this.send('Input.dispatchKeyEvent', modKeyDispatchParams(key, 'keyUp'));
  }

  async dispatchKey(key) {
    await this.send('Input.dispatchKeyEvent', {
      ...modKeyDispatchParams(key, 'rawKeyDown'),
      modifiers: 0,
    });
    await this.send('Input.dispatchKeyEvent', {
      ...modKeyDispatchParams(key, 'keyUp'),
      modifiers: 0,
    });
  }

  /** @param {string} testId */
  async clickTestId(testId) {
    const clicked = await this.evaluate(`
      (() => {
        const el = document.querySelector('[data-testid="${testId}"]');
        if (!el) return false;
        if (typeof el.click === 'function') el.click();
        return true;
      })()
    `);
    if (!clicked) {
      throw new Error(`Missing [data-testid="${testId}"] on ${this.label}`);
    }
  }

  /** @param {string} label */
  async clickButtonByText(label) {
    const clicked = await this.evaluate(`
      (() => {
        const target = ${JSON.stringify(label)}.toLowerCase();
        const buttons = Array.from(document.querySelectorAll('button'));
        const match = buttons.find((btn) => (btn.textContent ?? '').trim().toLowerCase().includes(target));
        if (!match) return false;
        match.click();
        return true;
      })()
    `);
    if (!clicked) {
      throw new Error(`Button containing "${label}" not found on ${this.label}`);
    }
  }

  /** @param {string} label */
  async clickDialogButtonByText(label) {
    const clicked = await this.evaluate(`
      (() => {
        const target = ${JSON.stringify(label)}.toLowerCase();
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog'));
        const buttons = dialogs.flatMap((dialog) => Array.from(dialog.querySelectorAll('button')));
        const match = buttons.find((btn) => (btn.textContent ?? '').trim().toLowerCase().includes(target));
        if (!match) return false;
        match.click();
        return true;
      })()
    `);
    if (!clicked) {
      throw new Error(`Dialog button containing "${label}" not found on ${this.label}`);
    }
  }

  /** @param {string} selector @param {string} value */
  async fillInput(selector, value) {
    await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Missing input ${selector}');
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        el.focus();
        descriptor?.set?.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
  }

  /**
   * @param {() => Promise<unknown>} predicate
   * @param {{ timeoutMs?: number; intervalMs?: number; description?: string }} [options]
   */
  async waitFor(predicate, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? 250;
    const description = options.description ?? 'condition';
    const deadline = Date.now() + timeoutMs;
    /** @type {unknown} */
    let lastValue;
    while (Date.now() < deadline) {
      lastValue = await predicate();
      if (lastValue) {
        return lastValue;
      }
      await sleep(intervalMs);
    }
    throw new Error(
      `Timed out waiting for ${description} (${timeoutMs}ms); last=${JSON.stringify(lastValue)}`,
    );
  }

  /** @param {string} filePath */
  async screenshot(filePath) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(result.data, 'base64'));
  }

  async readText(testId) {
    return String(
      (await this.evaluate(
        `document.querySelector('[data-testid="${testId}"]')?.textContent ?? ''`,
      )) ?? '',
    );
  }

  async queryExists(testId) {
    return Boolean(
      await this.evaluate(`Boolean(document.querySelector('[data-testid="${testId}"]'))`),
    );
  }

  async readMultiplayerZoneRadius() {
    return this.evaluate(
      `(() => {
        const state = window.__tileborne_e2e?.getMultiplayerSessionState?.();
        return state?.zone?.radius ?? null;
      })()`,
    );
  }

  async countMultiplayerPlayerMarkers() {
    return Number(
      (await this.evaluate(
        `document.querySelectorAll('[data-testid^="playtest-multiplayer-player-"]').length`,
      )) ?? 0,
    );
  }

  async countMultiplayerCanvases() {
    return Number(
      (await this.evaluate(
        `document.querySelectorAll('canvas[data-testid="playtest-multiplayer-canvas"], [data-testid="playtest-multiplayer-canvas"] canvas').length`,
      )) ?? 0,
    );
  }

  async readMultiplayerHudAliveCount() {
    return Number(
      (await this.evaluate(
        `(() => {
          const el = document.querySelector('[data-testid="playtest-hud-overlay"] [data-testid="playtest-hud-alive-count"]');
          const match = (el?.textContent ?? '').match(/(\\d+)/);
          return match ? Number(match[1]) : 0;
        })()`,
      )) ?? 0,
    );
  }

  async readMultiplayerSnapshotPlayerCount() {
    return Number(
      (await this.evaluate(
        `(() => {
          const state = window.__tileborne_e2e?.getMultiplayerSessionState?.();
          return Array.isArray(state?.players) ? state.players.length : 0;
        })()`,
      )) ?? 0,
    );
  }

  async readHudInsetAttributes() {
    return this.evaluate(
      `(() => {
        const el = document.querySelector('[data-testid="playtest-hud-overlay"]');
        if (!el) return null;
        return {
          top: el.getAttribute('data-hud-inset-top'),
          right: el.getAttribute('data-hud-inset-right'),
          bottom: el.getAttribute('data-hud-inset-bottom'),
          left: el.getAttribute('data-hud-inset-left'),
        };
      })()`,
    );
  }
}

/** @returns {Promise<CdpPage>} */
async function connectPrimaryPage() {
  const targets = await fetchJson(`${CDP_BASE}/json/list`);
  const pageTarget = targets.find(isTilebornePageTarget);
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(`No Tileborne renderer page in CDP target list at ${CDP_BASE}/json/list`);
  }
  const client = new CdpPage(pageTarget.webSocketDebuggerUrl, 'primary');
  await client.connect();
  return client;
}

/** @param {string} excludeWsUrl @returns {Promise<CdpPage | null>} */
async function waitForSecondaryPage(excludeWsUrl) {
  const deadline = Date.now() + DEFAULT_STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`${CDP_BASE}/json/list`);
    const candidate = targets.find(
      (target) =>
        isTilebornePageTarget(target) &&
        target.webSocketDebuggerUrl &&
        target.webSocketDebuggerUrl !== excludeWsUrl,
    );
    if (candidate?.webSocketDebuggerUrl) {
      const client = new CdpPage(candidate.webSocketDebuggerUrl, 'secondary');
      await client.connect();
      return client;
    }
    await sleep(500);
  }
  return null;
}

/** @type {CdpPage | null} */
let primary = null;

/** @param {string} id @param {string} name @param {(page: CdpPage) => Promise<void>} fn */
async function runStep(id, name, fn) {
  const label = `${id} — ${name}`;
  process.stdout.write(`\n==> ${label}\n`);
  if (!primary) {
    throw new Error('Primary CDP client not connected');
  }
  try {
    await fn(primary);
    const shot = path.join(SCREENSHOT_DIR, `${id}-${name}.png`);
    await primary.screenshot(shot);
    process.stdout.write(`PASS  ${label}\n       screenshot: ${path.relative(REPO_ROOT, shot)}\n`);
  } catch (error) {
    const shot = path.join(SCREENSHOT_DIR, `${id}-${name}-FAIL.png`);
    try {
      await primary.screenshot(shot);
      process.stdout.write(`       screenshot: ${path.relative(REPO_ROOT, shot)}\n`);
    } catch {
      // ignore screenshot failure
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAIL  ${label}\n       ${message}\n`);
    throw new StepFailure(id, message, error);
  }
}

function parseRuntimeStatus(text) {
  const tickMatch = /Tick\s+(\d+)/i.exec(text);
  const playersMatch = /Players:\s*(\d+)/i.exec(text);
  const eventMatch = /·\s*(onInit|onTick:\d+|multiplayer-live|startup-failed:[^·]+)\s*·/i.exec(
    `${text} · `,
  );
  return {
    tickCount: tickMatch ? Number(tickMatch[1]) : 0,
    playerCount: playersMatch ? Number(playersMatch[1]) : 0,
    lastPluginEvent: eventMatch?.[1] ?? '',
    raw: text,
  };
}

function isCdpUnavailable(error) {
  const message =
    error instanceof Error ? `${error.message} ${error.cause?.message ?? ''}` : String(error);
  return /fetch failed|ECONNREFUSED|No Tileborne renderer page in CDP target list/i.test(message);
}

async function assertMultiplayerRenderSurface(page, label) {
  const domDots = await page.countMultiplayerPlayerMarkers();
  if (domDots !== 0) {
    throw new Error(`${label} still renders ${domDots} multiplayer DOM player marker(s)`);
  }

  const canvases = await page.countMultiplayerCanvases();
  if (canvases < 1) {
    throw new Error(`${label} missing playtest multiplayer Pixi canvas`);
  }

  const hudInsets = await page.readHudInsetAttributes();
  const missingInset = !hudInsets || Object.values(hudInsets).some((value) => value === null);
  if (missingInset) {
    throw new Error(`${label} HUD overlay missing data-hud-inset-* attributes`);
  }
}

function assertNoInvalidProtocolFrame(page, label) {
  const logs = [...page.consoleMessages, ...page.consoleErrors, ...page.pageErrors].join('\n');
  if (logs.includes('Invalid protocol frame')) {
    throw new Error(`${label} console logs contain "Invalid protocol frame"`);
  }
}

async function installBattleRoyalePlugin(page) {
  return page.evaluate(
    `
      (async () => {
        const pluginId = ${JSON.stringify(BATTLE_ROYALE_PLUGIN_ID)};
        const result = await window.tileborne.plugins.install({
          source: { _tag: 'local', path: ${JSON.stringify(BATTLE_ROYALE_PLUGIN_SOURCE)} },
        });
        if (!result.plugin.enabled) {
          await window.tileborne.plugins.enable({ pluginId: result.plugin.id });
        }
        const { plugins } = await window.tileborne.plugins.list({});
        const plugin = plugins.find((entry) => entry.id === pluginId);
        return plugin
          ? { id: plugin.id, enabled: plugin.enabled, rootPath: plugin.rootPath }
          : null;
      })()
    `,
    true,
  );
}

async function stopSinglePlaytest(page) {
  if (await page.queryExists('playtest-viewport')) {
    await page.clickButtonByText('Stop playtest');
    if (await page.evaluate(`Boolean(document.querySelector('[role="dialog"]'))`)) {
      await page.clickDialogButtonByText('Stop playtest');
    }
    await page.waitFor(() => page.queryExists('playtest-viewport').then((v) => !v), {
      timeoutMs: 30_000,
      description: 'playtest overlay close',
    });
  }
}

async function openBottomDrawer(page) {
  await page.evaluate(
    `
    (async () => {
      const origin = window.location.origin;
      try {
        const mod = await import(origin + '/src/renderer/stores/editor-ui-store.ts');
        mod.useEditorUiStore.getState().setBottomDrawerOpen(true);
        return true;
      } catch {
        return false;
      }
    })()
  `,
    true,
  );
  await sleep(400);
}

async function assertDrawerTab(page, tabLabel, shortcutDigit) {
  await page.dispatchModShortcut(shortcutDigit);
  await sleep(300);
  const ok = await page.evaluate(`
    (() => {
      const label = ${JSON.stringify(tabLabel)};
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) =>
        (el.textContent ?? '').includes(label),
      );
      if (!tab) return false;
      const panelId = tab.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      const region = panel ?? document.body;
      const text = (region.textContent ?? '').trim();
      if (text.length === 0) return false;
      const hasEmptyState = Boolean(
        region.querySelector('.border-dashed') ||
          text.toLowerCase().includes('no ') ||
          text.toLowerCase().includes('idle') ||
          text.toLowerCase().includes('start a playtest'),
      );
      const hasContent = text.length > 20;
      return hasEmptyState || hasContent;
    })()
  `);
  if (!ok) {
    throw new Error(`Bottom drawer tab "${tabLabel}" has no visible content or empty-state`);
  }
}

async function main() {
  process.stdout.write(`Tileborne v0.1.0 Live-CDP walkthrough\nCDP: ${CDP_BASE}\n`);

  try {
    primary = await connectPrimaryPage();
  } catch (error) {
    if (isCdpUnavailable(error)) {
      process.stdout.write(
        'SKIP  no Tileborne dev:cdp renderer found. Run `pnpm --filter @tileborne/desktop dev:cdp` and retry `node scripts/live-cdp-walkthrough.mjs`.\n',
      );
      return;
    }
    throw error;
  }
  await primary.send('Runtime.discardConsoleEntries');
  primary.consoleErrors = [];
  primary.pageErrors = [];

  await runStep('01', 'boot-check', async (page) => {
    await page.navigateHash('/');
    const boot = await page.evaluate(`
      (() => ({
        rootMounted: Boolean(document.querySelector('#root')?.childElementCount),
        homeTitle: document.querySelector('h1')?.textContent?.trim() ?? '',
      }))()
    `);
    if (!boot.rootMounted) {
      throw new Error('#root is not mounted');
    }
    if (boot.homeTitle !== 'Tileborne') {
      throw new Error(`Expected home title Tileborne, got "${boot.homeTitle}"`);
    }
    if (page.consoleErrors.length > 0) {
      throw new Error(`Console errors: ${page.consoleErrors.join(' | ')}`);
    }
    if (page.pageErrors.length > 0) {
      throw new Error(`Page errors: ${page.pageErrors.join(' | ')}`);
    }
  });

  await runStep('02', 'project-create', async (page) => {
    await page.navigateHash('/');
    await page.clickButtonByText('Create project');
    await page.waitFor(
      () => page.evaluate(`Boolean(document.querySelector('#create-project-name'))`),
      {
        description: 'create project dialog',
      },
    );
    await page.fillInput('#create-project-name', ctx.projectName);
    await page.clickTestId('create-project-submit');
    await page.waitFor(
      async () => {
        const routePath = await page.evaluate(`
          decodeURIComponent(window.location.hash.replace(/^#/, '') || window.location.pathname)
        `);
        return /^\/projects\//.test(String(routePath));
      },
      { description: 'project route after create' },
    );
    ctx.projectId = String(
      await page.evaluate(`
        decodeURIComponent(window.location.hash.replace(/^#/, '') || window.location.pathname)
          .split('/')[2]
          ?.split('?')[0] ?? ''
      `),
    );
    if (!ctx.projectId) {
      throw new Error('Could not parse projectId from URL hash');
    }
    const projectHeading = await page.evaluate(`document.querySelector('h1')?.textContent ?? ''`);
    if (!String(projectHeading).includes(ctx.projectName)) {
      throw new Error(`Project heading did not include "${ctx.projectName}"`);
    }
    await page.navigateHash('/');
    const listed = await page.evaluate(`
      (() => {
        const name = ${JSON.stringify(ctx.projectName)};
        return Array.from(document.querySelectorAll('a, h3, [class*="CardTitle"]'))
          .some((el) => (el.textContent ?? '').includes(name));
      })()
    `);
    if (!listed) {
      throw new Error(`Project "${ctx.projectName}" not found in recent/all grid`);
    }
  });

  await runStep('03', 'asset-pack', async (page) => {
    await page.navigateHash(`/projects/${ctx.projectId}/assets`);
    await page.clickButtonByText('Import sample tileset');
    await page.waitFor(() => page.queryExists(`asset-pack-card-${SAMPLE_ASSET_PACK_ID}`), {
      timeoutMs: 120_000,
      description: 'sample pack card',
    });
    const thumbBox = await page.waitFor(
      () =>
        page.evaluate(`
      (() => {
        const card = document.querySelector('[data-testid="asset-pack-card-${SAMPLE_ASSET_PACK_ID}"]');
        const img = card?.querySelector('[data-testid="asset-pack-preview-thumb"]');
        if (!img) return false;
        const rect = img.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
          return false;
        }
        return { width: rect.width, height: rect.height };
      })()
    `),
      { timeoutMs: 60_000, description: 'sample pack preview thumb layout' },
    );
    if (!thumbBox || thumbBox.width <= 0 || thumbBox.height <= 0) {
      throw new Error('Sample pack preview thumb has zero size');
    }
  });

  await runStep('04', 'map-generate', async (page) => {
    await page.navigateHash(`/projects/${ctx.projectId}`);
    await page.dispatchModShortcut('g');
    await page.waitFor(
      () =>
        page.evaluate(`
          Array.from(document.querySelectorAll('[role="dialog"]')).some((d) =>
            (d.textContent ?? '').includes('Generate map'),
          )
        `),
      { description: 'generate map dialog' },
    );
    await page.clickButtonByText('Dungeon rooms');
    await page.clickTestId('generate-map-submit');
    await page.waitFor(
      () =>
        page.evaluate(`
          !Array.from(document.querySelectorAll('[role="dialog"]')).some((d) =>
            (d.textContent ?? '').includes('Generate map'),
          )
        `),
      { timeoutMs: 120_000, description: 'generate dialog close' },
    );
    await page.waitFor(
      () => page.evaluate(`Boolean(document.querySelector('[data-testid="sidebar-map-list"] a'))`),
      { description: 'sidebar map list' },
    );
    ctx.mapId = String(
      await page.evaluate(`
        (() => {
          const link = document.querySelector('[data-testid="sidebar-map-list"] a');
          const href = link?.getAttribute('href') ?? '';
          if (href.length > 0) {
            const routePath = decodeURIComponent(new URL(href, window.location.href).pathname);
            const mapId = routePath.split('/maps/')[1]?.split(/[?#]/)[0];
            if (mapId) return mapId;
          }
          return link?.textContent?.trim().split(/\\s+/)[0] ?? '';
        })()
      `),
    );
    if (!ctx.mapId) {
      throw new Error('Could not read generated map id from sidebar');
    }
    await page.waitFor(
      () =>
        page.evaluate(
          `Boolean(document.querySelector('.touch-none.bg-background canvas, canvas'))`,
        ),
      { description: 'map editor canvas' },
    );
  });

  await runStep('05', 'plugin-install-br', async (page) => {
    await page.navigateHash(`/projects/${ctx.projectId}/plugins`);
    const installed = await installBattleRoyalePlugin(page);
    if (!installed?.enabled) {
      throw new Error('Battle Royale plugin did not install enabled');
    }
    await page.evaluate(`window.location.reload()`);
    await page.waitFor(
      () => page.evaluate(`typeof window.tileborne?.plugins?.list === 'function'`),
      { timeoutMs: DEFAULT_STEP_TIMEOUT_MS, description: 'renderer reload after BR install' },
    );
    await page.navigateHash(`/projects/${ctx.projectId}/plugins`);
    const bodyText = await page.waitFor(
      () =>
        page.evaluate(`
          (() => {
            const text = document.body.textContent ?? '';
            return text.includes('Battle Royale') && text.includes('Enabled') ? text : false;
          })()
        `),
      { timeoutMs: DEFAULT_STEP_TIMEOUT_MS, description: 'BR installed plugin visible' },
    );
    if (
      !String(bodyText).includes(BATTLE_ROYALE_PLUGIN_ID) &&
      !String(bodyText).includes('Battle Royale')
    ) {
      throw new Error('Battle Royale plugin not listed after install');
    }
    if (!String(bodyText).includes('Enabled') || String(bodyText).includes('Failed')) {
      throw new Error('Battle Royale plugin is not cleanly enabled');
    }
  });

  await runStep('06', 'playtest-single', async (page) => {
    await page.navigateHash(`/projects/${ctx.projectId}/maps/${ctx.mapId}`);
    await page.waitFor(
      async () => {
        if (await page.queryExists('map-editor-toolbar')) {
          return true;
        }
        return page.evaluate(`!document.querySelector('[data-testid="map-editor-loading"]')`);
      },
      { description: 'map editor ready' },
    );
    await page.clickTestId('playtest-menu-trigger');
    await page.clickTestId('playtest-menu-single');
    await page.waitFor(() => page.queryExists('playtest-viewport'), {
      description: 'playtest viewport',
    });
    const metrics = await page.waitFor(
      async () => {
        const text = await page.readText('playtest-runtime-status');
        const parsed = parseRuntimeStatus(text);
        const freshEvent =
          parsed.lastPluginEvent === 'onInit' || /^onTick:[1-9]\d*$/.test(parsed.lastPluginEvent);
        if (parsed.tickCount > 0 && parsed.playerCount > 0 && freshEvent) {
          return parsed;
        }
        return null;
      },
      { timeoutMs: 120_000, description: 'playtest runtime metrics' },
    );
    process.stdout.write(
      `       tickCount=${metrics.tickCount} playerCount=${metrics.playerCount} lastPluginEvent=${metrics.lastPluginEvent}\n`,
    );
    await stopSinglePlaytest(page);
  });

  await runStep('07', 'playtest-multiplayer-host', async (page) => {
    await page.navigateHash(`/projects/${ctx.projectId}/maps/${ctx.mapId}`);
    await page.clickTestId('playtest-menu-trigger');
    await page.clickTestId('playtest-menu-host');
    await page.waitFor(() => page.queryExists('playtest-host-dialog'), {
      description: 'host dialog',
    });
    const hostUrls = await page.waitFor(
      () =>
        page.evaluate(`
          (() => {
            const roomUrl = document.querySelector('[data-testid="playtest-host-room-url"]')?.value ?? '';
            const wsUrl = document.querySelector('[data-testid="playtest-host-ws-url"]')?.value ?? '';
            return roomUrl && wsUrl ? { roomUrl, wsUrl } : false;
          })()
        `),
      { timeoutMs: 120_000, description: 'host room and WebSocket URLs' },
    );
    const { roomUrl, wsUrl } = hostUrls;
    if (!roomUrl || !wsUrl) {
      throw new Error('Host dialog missing room URL or WebSocket URL');
    }
    process.stdout.write(`       roomUrl=${roomUrl}\n       wsUrl=${wsUrl}\n`);

    await page.clickTestId('playtest-host-open-second-client');
    ctx.secondaryClient = await waitForSecondaryPage(page.wsUrl);
    if (!ctx.secondaryClient) {
      throw new Error('Second renderer window did not appear in CDP target list');
    }

    await ctx.secondaryClient.waitFor(
      () => ctx.secondaryClient.queryExists('playtest-multiplayer-viewport'),
      { timeoutMs: 120_000, description: 'secondary multiplayer viewport' },
    );

    await page.clickButtonByText('Join as host');
    await page.waitFor(() => page.queryExists('playtest-multiplayer-viewport'), {
      timeoutMs: 120_000,
      description: 'host multiplayer viewport',
    });

    const hostPlayers = await page.waitFor(() => page.readMultiplayerHudAliveCount(), {
      timeoutMs: 120_000,
      description: 'host HUD alive count',
    });
    const joinPlayers = await ctx.secondaryClient.waitFor(
      () => ctx.secondaryClient.readMultiplayerHudAliveCount(),
      {
        timeoutMs: 120_000,
        description: 'join HUD alive count',
      },
    );
    if (hostPlayers <= 0 || joinPlayers <= 0) {
      throw new Error(
        `Expected players in both viewports (host=${hostPlayers}, join=${joinPlayers})`,
      );
    }
  });

  await runStep('08', 'br-loop', async (page) => {
    const secondary = ctx.secondaryClient;
    if (!secondary) {
      throw new Error('Secondary client missing for BR loop');
    }

    const initialRadius = await page.readMultiplayerZoneRadius();
    await assertMultiplayerRenderSurface(page, 'host');
    await assertMultiplayerRenderSurface(secondary, 'join');
    assertNoInvalidProtocolFrame(page, 'host');
    assertNoInvalidProtocolFrame(secondary, 'join');

    const initialPlayers = Math.max(
      await page.readMultiplayerSnapshotPlayerCount(),
      await secondary.readMultiplayerSnapshotPlayerCount(),
    );
    if (typeof initialRadius !== 'number' || initialRadius <= 0) {
      throw new Error(`Could not read initial zone radius: ${JSON.stringify(initialRadius)}`);
    }
    if (initialPlayers <= 0) {
      throw new Error('No multiplayer players in session state at BR loop start');
    }

    let zoneShrunk = false;
    let killsSeen = false;
    let winnerSeen = false;

    const deadline = Date.now() + BR_LOOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const radius = await page.readMultiplayerZoneRadius();
      if (typeof radius === 'number' && radius < initialRadius) {
        zoneShrunk = true;
      }

      const zoneLabel = await page.readText('playtest-hud-zone-status');
      if (zoneLabel.toLowerCase().includes('shrinking')) {
        zoneShrunk = true;
      }

      const hostPlayers = await page.readMultiplayerSnapshotPlayerCount();
      const joinPlayers = await secondary.readMultiplayerSnapshotPlayerCount();
      const combined = Math.max(hostPlayers, joinPlayers);
      if (combined < initialPlayers) {
        killsSeen = true;
      }

      const winDialog =
        (await page.queryExists('playtest-win-dialog')) ||
        (await secondary.queryExists('playtest-win-dialog'));
      if (winDialog) {
        winnerSeen = true;
        break;
      }

      if (combined === 1 && zoneShrunk) {
        winnerSeen = true;
        break;
      }

      await sleep(1_000);
    }

    if (!zoneShrunk) {
      throw new Error('Zone did not shrink within BR loop timeout');
    }
    if (!killsSeen && initialPlayers > 1) {
      throw new Error('No kill / player elimination observed within BR loop timeout');
    }
    if (!winnerSeen) {
      throw new Error('GameOver / winner not observed within BR loop timeout');
    }
    await assertMultiplayerRenderSurface(page, 'host');
    await assertMultiplayerRenderSurface(secondary, 'join');
    assertNoInvalidProtocolFrame(page, 'host');
    assertNoInvalidProtocolFrame(secondary, 'join');
    process.stdout.write(
      `       zoneShrunk=${zoneShrunk} killsSeen=${killsSeen} winnerSeen=${winnerSeen}\n`,
    );
  });

  await runStep('09', 'stop-hosting', async (page) => {
    if (await page.queryExists('playtest-stop-hosting')) {
      await page.clickTestId('playtest-stop-hosting');
    } else {
      await page.clickButtonByText('Stop hosting');
    }
    await page.waitFor(() => page.queryExists('playtest-local-host-pill').then((v) => !v), {
      timeoutMs: 30_000,
      description: 'hosting pill removed',
    });
    if (ctx.secondaryClient) {
      await ctx.secondaryClient.close();
      ctx.secondaryClient = null;
    }
  });

  await runStep('10', 'theme-shortcuts', async (page) => {
    await page.navigateHash('/settings');
    await page.clickButtonByText('Dark');
    const isDark = await page.waitFor(
      () => page.evaluate(`document.documentElement.classList.contains('dark')`),
      { description: 'dark theme class' },
    );
    if (!isDark) {
      throw new Error('Dark theme not applied to documentElement');
    }
    await page.dispatchModShortcut('k');
    const paletteOpen = await page.waitFor(
      () =>
        page.evaluate(`
          Boolean(
            document.querySelector('[cmdk-root], [data-slot="command"], input[placeholder*="command" i]') ||
              Array.from(document.querySelectorAll('[role="dialog"]')).some((d) =>
                (d.textContent ?? '').toLowerCase().includes('command'),
              ),
          )
        `),
      { description: 'command palette open' },
    );
    if (!paletteOpen) {
      throw new Error('Command palette did not open');
    }
    await page.dispatchKey('Escape');
  });

  await runStep('11', 'bottom-drawer', async (page) => {
    await page.navigateHash(`/projects/${ctx.projectId}/maps/${ctx.mapId}`);
    await openBottomDrawer(page);
    const tabs = [
      ['Jobs', '1'],
      ['Logs', '2'],
      ['Problems', '3'],
      ['Playtest', '4'],
      ['Runtime', '5'],
    ];
    for (const [label, shortcut] of tabs) {
      await assertDrawerTab(page, label, shortcut);
    }
  });

  await runStep('12', 'no-stub-text', async (page) => {
    await page.navigateHash('/');
    const matches = await page.evaluate(`
      (() => {
        const pattern = ${FORBIDDEN_DOM_PATTERN.toString()};
        const text = document.body?.innerText ?? '';
        const hits = text.match(pattern);
        return hits ? [...new Set(hits.map((h) => h.toLowerCase()))] : [];
      })()
    `);
    if (Array.isArray(matches) && matches.length > 0) {
      throw new Error(`Forbidden DOM text found: ${matches.join(', ')}`);
    }
  });

  process.stdout.write('\nAll walkthrough steps passed.\n');
}

main()
  .catch((error) => {
    if (!(error instanceof StepFailure)) {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ctx.secondaryClient) {
      await ctx.secondaryClient.close().catch(() => undefined);
    }
    if (primary) {
      await primary.close().catch(() => undefined);
    }
  });

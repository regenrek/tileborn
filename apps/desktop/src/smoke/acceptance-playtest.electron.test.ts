import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  addBattleRoyaleSpawnAnchors,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  resolveBattleRoyaleInstallPath,
  resolveMainEntry,
  setProjectActiveGameMode,
  SMOKE_PROJECT_NAME,
  BATTLE_ROYALE_PLUGIN_ID,
  waitForJob,
  type SmokeContext,
} from './helpers.js';

const SHELL_FONT_PACK_ID = 'pack:9a97c29e-0d74-4e64-8b35-085e142238a1';
const SHELL_FONT_ASSET_ID = 'asset:9a97c29e-0d74-4e64-8b35-085e142238a2';
const SHELL_FONT_PATH = 'fonts/ibm-plex-sans-latin.woff2';

const createShellFontPack = async (
  tileborneHome: string,
): Promise<{ readonly packRoot: string; readonly size: number; readonly hash: string }> => {
  const rendererAssetsDir = path.resolve(process.cwd(), '.vite/renderer/main_window/assets');
  const rendererAssets = await readdir(rendererAssetsDir);
  const fontFile =
    rendererAssets.find((file) => /^ibm-plex-sans-latin-wght-normal-.*\.woff2$/.test(file)) ??
    rendererAssets.find((file) => file.endsWith('.woff2'));
  if (fontFile === undefined) {
    throw new Error(`No renderer font asset found in ${rendererAssetsDir}`);
  }
  const sourcePath = path.join(rendererAssetsDir, fontFile);
  const bytes = await readFile(sourcePath);
  const packRoot = path.join(tileborneHome, 'shell-font-pack');
  const fontDir = path.join(packRoot, 'fonts');
  await mkdir(fontDir, { recursive: true });
  await copyFile(sourcePath, path.join(packRoot, SHELL_FONT_PATH));
  const { size } = await stat(sourcePath);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  await writeFile(
    path.join(packRoot, 'tileborne-asset-pack.json'),
    `${JSON.stringify(
      {
        id: SHELL_FONT_PACK_ID,
        name: 'Smoke Shell Font Pack',
        version: '1.0.0',
        license: {
          spdxId: 'OFL-1.1',
          sourceUrl: 'https://github.com/IBM/plex',
        },
        assets: [
          {
            id: SHELL_FONT_ASSET_ID,
            path: SHELL_FONT_PATH,
            mime: 'font/woff2',
            size,
            hash,
            license: {
              spdxId: 'OFL-1.1',
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return { packRoot, size, hash };
};

const step = async <T>(label: string, action: () => Promise<T>, timeoutMs = 12_000): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Step timed out after ${timeoutMs}ms: ${label}`));
        }, timeoutMs);
      }),
    ]);
  } catch (cause) {
    throw new Error(
      `Step failed: ${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

type RendererPageEvent = {
  readonly type: string;
  readonly at: number;
  readonly text?: string;
  readonly url?: string;
  readonly name?: string;
  readonly message?: string;
};

const installRendererPageEventDiagnostics = (page: SmokeContext['page']) => {
  const events: RendererPageEvent[] = [];
  const record = (event: RendererPageEvent) => {
    events.push(event);
    if (events.length > 200) events.shift();
  };
  page.on('console', (message) => {
    record({
      type: `console:${message.type()}`,
      at: Date.now(),
      text: message.text(),
    });
  });
  page.on('pageerror', (error) => {
    record({
      type: 'pageerror',
      at: Date.now(),
      name: error.name,
      message: error.message,
    });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      record({
        type: 'framenavigated',
        at: Date.now(),
        url: frame.url(),
      });
    }
  });
  page.on('domcontentloaded', () => {
    record({ type: 'domcontentloaded', at: Date.now(), url: page.url() });
  });
  page.on('load', () => {
    record({ type: 'load', at: Date.now(), url: page.url() });
  });
  page.on('crash', () => {
    record({ type: 'crash', at: Date.now(), url: page.url() });
  });
  page.on('close', () => {
    record({ type: 'close', at: Date.now(), url: page.url() });
  });
  return events;
};

const shellHitTestDiagnostics = async (
  page: SmokeContext['page'],
  targetTestId = 'shell-action-title-start',
) =>
  page.evaluate(async (targetTestId) => {
    const sleepFrame = () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame((at) => resolve(at));
      });
    const beforeFrame = performance.now();
    const frameAt = await sleepFrame();
    const afterFrame = performance.now();
    const target = document.querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`);
    const targetRect = target?.getBoundingClientRect();
    const center =
      targetRect === undefined
        ? undefined
        : {
            x: targetRect.left + targetRect.width / 2,
            y: targetRect.top + targetRect.height / 2,
          };
    const describe = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return undefined;
      const style = window.getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id,
        testId: element.getAttribute('data-testid'),
        slot: element.getAttribute('data-slot'),
        className: element.className,
        text: element.textContent?.trim().slice(0, 80),
        pointerEvents: style.pointerEvents,
        position: style.position,
        zIndex: style.zIndex,
        visibility: style.visibility,
        display: style.display,
        opacity: style.opacity,
        rect: (() => {
          const rect = element.getBoundingClientRect();
          return {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })(),
      };
    };
    const hit = center === undefined ? undefined : document.elementFromPoint(center.x, center.y);
    const ancestry: Array<ReturnType<typeof describe>> = [];
    let current: Element | null = hit ?? null;
    while (current !== null && ancestry.length < 8) {
      ancestry.push(describe(current));
      current = current.parentElement;
    }
    const overlaySelectors = [
      '[data-testid="playtest-runtime-shell"]',
      '[data-testid="playtest-overlay"]',
      '[data-testid="playtest-viewport"]',
      '[data-testid="playtest-hud-overlay"]',
      '.tb-root',
      '[role="dialog"]',
      '[data-radix-popper-content-wrapper]',
      '[data-slot="tooltip-content"]',
      '[data-slot="dropdown-menu-content"]',
    ];
    const overlays = overlaySelectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) => ({
        selector,
        ...describe(element),
      })),
    );
    const active = describe(document.activeElement);
    const runtimeShell = document.querySelector<HTMLElement>(
      '[data-testid="playtest-runtime-shell"]',
    );
    const runtimeRoot = document.querySelector<HTMLElement>(
      '[data-testid="playtest-runtime-shell"] .tb-root',
    );
    const screens = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="shell-screen-"]'),
    ).map((element) => describe(element));
    const actions = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="shell-action-"]'),
    ).map((element) => describe(element));
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      heartbeat: {
        beforeFrame,
        frameAt,
        afterFrame,
        frameDelayMs: afterFrame - beforeFrame,
      },
      target: describe(target),
      targetCenter: center,
      elementFromPoint: describe(hit),
      ancestry,
      active,
      runtimeShellState:
        runtimeShell === null
          ? undefined
          : {
              queryStatus: runtimeShell.dataset.shellQueryStatus,
              queryFetchStatus: runtimeShell.dataset.shellQueryFetchStatus,
              queryError: runtimeShell.dataset.shellQueryError,
              fallbackStatus: runtimeShell.dataset.shellFallbackStatus,
              fallbackError: runtimeShell.dataset.shellFallbackError,
              projectionState: runtimeShell.dataset.shellProjectionState,
            },
      runtimeRootState:
        runtimeRoot === null
          ? undefined
          : {
              phase: runtimeRoot.dataset.phase,
              screen: runtimeRoot.dataset.screen,
              shellScreenId: runtimeRoot.dataset.shellScreenId,
            },
      screens,
      actions,
      overlays,
    };
  }, targetTestId);

const rendererPlaytestDebug = async (page: SmokeContext['page']) =>
  page
    .evaluate(() => ({
      rendererRoot: (window as unknown as { __tileborneRendererRootDebug?: unknown })
        .__tileborneRendererRootDebug,
      startupBoundary: (window as unknown as { __tileborneStartupBoundaryDebug?: unknown })
        .__tileborneStartupBoundaryDebug,
      appShell: (window as unknown as { __tileborneAppShellDebug?: unknown })
        .__tileborneAppShellDebug,
      shell: (window as unknown as { __tileborneShellDebug?: unknown }).__tileborneShellDebug,
      route: (window as unknown as { __tileborneMapEditorPlaytestDebug?: unknown })
        .__tileborneMapEditorPlaytestDebug,
      readiness: (window as unknown as { __tileborneReadinessDebug?: unknown })
        .__tileborneReadinessDebug,
      topBar: (window as unknown as { __tileborneTopBarDebug?: unknown }).__tileborneTopBarDebug,
      location: {
        href: window.location.href,
        hash: window.location.hash,
        pathname: window.location.pathname,
      },
      document: {
        readyState: document.readyState,
        title: document.title,
        rootChildCount: document.getElementById('root')?.childElementCount,
        rootText: document.getElementById('root')?.textContent?.trim().slice(0, 300),
        bodyText: document.body.textContent?.trim().slice(0, 500),
        rootHtml: document.getElementById('root')?.innerHTML.slice(0, 1_500),
      },
    }))
    .catch(() => undefined);

const readinessStatusSnapshots = async (page: SmokeContext['page']) =>
  page.locator('[data-testid="readiness-status"]').evaluateAll((elements) =>
    elements.map((element) => {
      const button = element as HTMLElement;
      const style = window.getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent?.trim() ?? '',
        visible:
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0,
        instanceId: button.getAttribute('data-topbar-instance-id'),
        queryKey: button.getAttribute('data-readiness-query-key'),
        dataUpdatedAt: button.getAttribute('data-readiness-data-updated-at'),
        queryStatus: button.getAttribute('data-readiness-query-status'),
        fetchStatus: button.getAttribute('data-readiness-fetch-status'),
        failureCount: button.getAttribute('data-readiness-failure-count'),
        failureReason: button.getAttribute('data-readiness-failure-reason'),
        error: button.getAttribute('data-readiness-error'),
      };
    }),
  );

type ShellStateSnapshot = {
  runtimeShell: {
    queryStatus: string | null;
    queryFetchStatus: string | null;
    projectionState: string | null;
    fallbackStatus: string | null;
    runtimeRootState: string | null;
    sessionState: string | null;
    rendererKey: string | null;
    cacheKey: string | null;
    projectionSource: string | null;
    hostGeneration: string | null;
    rootCount: number;
  };
  runtimeRoot: {
    phase: string | null;
    screen: string | null;
    shellScreenId: string | null;
  };
};

const shellStateSnapshot = async (page: SmokeContext['page']): Promise<ShellStateSnapshot> => {
  return page.evaluate(() => {
    const runtimeShell = document.querySelector<HTMLElement>(
      '[data-testid="playtest-runtime-shell"]',
    );
    const runtimeRoots = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="playtest-runtime-shell"] .tb-root'),
    );
    const runtimeRoot = runtimeRoots[0];
    return {
      runtimeShell: {
        queryStatus: runtimeShell?.getAttribute('data-shell-query-status') ?? null,
        queryFetchStatus: runtimeShell?.getAttribute('data-shell-query-fetch-status') ?? null,
        projectionState: runtimeShell?.getAttribute('data-shell-projection-state') ?? null,
        fallbackStatus: runtimeShell?.getAttribute('data-shell-fallback-status') ?? null,
        runtimeRootState: runtimeShell?.getAttribute('data-shell-runtime-root-state') ?? null,
        sessionState: runtimeShell?.getAttribute('data-shell-session-state') ?? null,
        rendererKey: runtimeShell?.getAttribute('data-shell-renderer-key') ?? null,
        cacheKey: runtimeShell?.getAttribute('data-shell-cache-key') ?? null,
        projectionSource: runtimeShell?.getAttribute('data-shell-projection-source') ?? null,
        hostGeneration: runtimeShell?.getAttribute('data-shell-host-generation') ?? null,
        rootCount: runtimeRoots.length,
      },
      runtimeRoot: {
        phase: runtimeRoot?.getAttribute('data-phase') ?? null,
        screen: runtimeRoot?.getAttribute('data-screen') ?? null,
        shellScreenId: runtimeRoot?.getAttribute('data-shell-screen-id') ?? null,
      },
    };
  });
};

const waitForRuntimeRootMounted = async (page: SmokeContext['page']): Promise<void> => {
  const runtimeShell = page.getByTestId('playtest-runtime-shell');
  try {
    await expect(runtimeShell).toHaveAttribute('data-shell-runtime-root-state', 'mounted', {
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="playtest-runtime-shell"] .tb-root')).toHaveCount(1, {
      timeout: 1_000,
    });
  } catch (cause) {
    const rendererDebug = await rendererPlaytestDebug(page);
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)}\n` +
        `runtimeShell=${JSON.stringify({
          queryStatus: await runtimeShell.getAttribute('data-shell-query-status').catch(() => null),
          queryFetchStatus: await runtimeShell
            .getAttribute('data-shell-query-fetch-status')
            .catch(() => null),
          projectionState: await runtimeShell
            .getAttribute('data-shell-projection-state')
            .catch(() => null),
          runtimeRootState: await runtimeShell
            .getAttribute('data-shell-runtime-root-state')
            .catch(() => null),
          fallbackStatus: await runtimeShell
            .getAttribute('data-shell-fallback-status')
            .catch(() => null),
          fallbackError: await runtimeShell
            .getAttribute('data-shell-fallback-error')
            .catch(() => null),
          sessionState: await runtimeShell
            .getAttribute('data-shell-session-state')
            .catch(() => null),
          rendererKey: await runtimeShell.getAttribute('data-shell-renderer-key').catch(() => null),
          cacheKey: await runtimeShell.getAttribute('data-shell-cache-key').catch(() => null),
          projectionSource: await runtimeShell
            .getAttribute('data-shell-projection-source')
            .catch(() => null),
          hostGeneration: await runtimeShell
            .getAttribute('data-shell-host-generation')
            .catch(() => null),
        })}\n` +
        `rendererDebug=${JSON.stringify(rendererDebug)}`,
      { cause },
    );
  }
};

const assertStableShellState = async (
  page: SmokeContext['page'],
  expected: { readonly phase: string; readonly shellScreenId?: string | undefined },
): Promise<void> => {
  await waitForRuntimeRootMounted(page);
  await expect
    .poll(
      async () => {
        const samples: ShellStateSnapshot[] = [];
        for (let index = 0; index < 3; index += 1) {
          samples.push(await shellStateSnapshot(page));
          if (index < 2) await page.waitForTimeout(120);
        }
        const encoded = samples.map((sample) => JSON.stringify(sample));
        if (new Set(encoded).size !== 1) {
          return `unstable:${encoded.join('\n')}`;
        }
        const [sample] = samples;
        if (sample.runtimeShell.queryStatus !== 'success') return `query:${encoded[0]}`;
        if (!/fresh|retained|fallback/.test(sample.runtimeShell.projectionState ?? '')) {
          return `projection:${encoded[0]}`;
        }
        if (!/idle|success/.test(sample.runtimeShell.fallbackStatus ?? '')) {
          return `fallback:${encoded[0]}`;
        }
        if (sample.runtimeShell.runtimeRootState !== 'mounted') return `root:${encoded[0]}`;
        if (sample.runtimeShell.rootCount !== 1) return `root-count:${encoded[0]}`;
        if (sample.runtimeShell.sessionState !== 'Running') return `session:${encoded[0]}`;
        if (sample.runtimeShell.rendererKey !== 'battle-royale.renderer') {
          return `renderer:${encoded[0]}`;
        }
        if (!sample.runtimeShell.hostGeneration) return `generation:${encoded[0]}`;
        if (sample.runtimeRoot.phase !== expected.phase) return `phase:${encoded[0]}`;
        if (
          expected.shellScreenId !== undefined &&
          sample.runtimeRoot.shellScreenId !== expected.shellScreenId
        ) {
          return `screen:${encoded[0]}`;
        }
        return 'stable';
      },
      { timeout: 5_000 },
    )
    .toBe('stable');
};

const clickShellActionByPointer = async (
  page: SmokeContext['page'],
  targetTestId: string,
  expectedShellState: { readonly phase: string; readonly shellScreenId?: string | undefined },
  assertTransition: () => Promise<void>,
): Promise<void> => {
  await assertStableShellState(page, expectedShellState);
  const target = page.getByTestId(targetTestId);
  await expect(target).toBeVisible({ timeout: 8_000 });
  await expect(target).toBeEnabled({ timeout: 8_000 });
  const beforeClick = await shellHitTestDiagnostics(page, targetTestId);
  const center = beforeClick.targetCenter;
  if (center === undefined) {
    throw new Error(`No center point for ${targetTestId}: ${JSON.stringify(beforeClick)}`);
  }
  const hitTestIds = [
    beforeClick.elementFromPoint?.testId,
    ...beforeClick.ancestry.map((entry) => entry?.testId),
  ];
  if (!hitTestIds.includes(targetTestId)) {
    throw new Error(
      `Center hit-test did not resolve ${targetTestId}: ${JSON.stringify(beforeClick)}`,
    );
  }
  await page.mouse.click(center.x, center.y);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      assertTransition(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Transition after ${targetTestId} did not complete within 10000ms`));
        }, 10_000);
      }),
    ]);
  } catch (cause) {
    const runtimeShell = page.getByTestId('playtest-runtime-shell');
    const runtimeRoot = page.locator('[data-testid="playtest-runtime-shell"] .tb-root');
    const rendererDebug = await Promise.race([
      rendererPlaytestDebug(page),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_000)),
    ]);
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)}\n` +
        `beforeClick=${JSON.stringify(beforeClick)}\n` +
        `afterClick=${JSON.stringify(await shellHitTestDiagnostics(page, targetTestId))}\n` +
        `runtimeShell=${JSON.stringify({
          queryStatus: await runtimeShell.getAttribute('data-shell-query-status'),
          queryFetchStatus: await runtimeShell.getAttribute('data-shell-query-fetch-status'),
          projectionState: await runtimeShell.getAttribute('data-shell-projection-state'),
          fallbackStatus: await runtimeShell.getAttribute('data-shell-fallback-status'),
        })}\n` +
        `runtimeRoot=${JSON.stringify({
          phase: await runtimeRoot.getAttribute('data-phase'),
          screen: await runtimeRoot.getAttribute('data-screen'),
          shellScreenId: await runtimeRoot.getAttribute('data-shell-screen-id'),
        })}\n` +
        `rendererDebug=${JSON.stringify(rendererDebug)}`,
      { cause },
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const assertEmptyMatchAreaReachesViewport = async (page: SmokeContext['page']): Promise<void> => {
  await assertStableShellState(page, { phase: 'in-match' });
  const sample = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="playtest-viewport"]');
    const shell = document.querySelector<HTMLElement>('[data-testid="playtest-runtime-shell"]');
    const root = document.querySelector<HTMLElement>(
      '[data-testid="playtest-runtime-shell"] .tb-root',
    );
    if (viewport === null || shell === null || root === null) {
      return { ok: false, reason: 'missing-elements', point: undefined };
    }
    const rect = viewport.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      ok: viewport === hit || viewport.contains(hit),
      point,
      hitTestId: hit instanceof HTMLElement ? hit.getAttribute('data-testid') : undefined,
      hitTag: hit instanceof HTMLElement ? hit.tagName.toLowerCase() : undefined,
      shellPointerEvents: window.getComputedStyle(shell).pointerEvents,
      rootPointerEvents: window.getComputedStyle(root).pointerEvents,
      rootPhase: root.dataset.phase,
      rootPaused: root.dataset.paused,
    };
  });
  if (!sample.ok || sample.point === undefined) {
    throw new Error(`Empty match area does not hit playtest viewport: ${JSON.stringify(sample)}`);
  }
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="playtest-viewport"]');
    if (viewport === null) throw new Error('playtest viewport missing before empty-area click');
    const recorder = window as unknown as { __tileborneSmokeViewportMouseDown?: unknown };
    delete recorder.__tileborneSmokeViewportMouseDown;
    viewport.addEventListener(
      'mousedown',
      (event) => {
        recorder.__tileborneSmokeViewportMouseDown = {
          button: event.button,
          targetTestId:
            event.target instanceof HTMLElement ? event.target.getAttribute('data-testid') : null,
        };
      },
      { capture: true, once: true },
    );
  });
  await page.mouse.click(sample.point.x, sample.point.y);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __tileborneSmokeViewportMouseDown?: unknown })
              .__tileborneSmokeViewportMouseDown,
        ),
      { timeout: 5_000 },
    )
    .toMatchObject({ button: 0 });
};

const pressShellActionByKeyboard = async (
  page: SmokeContext['page'],
  targetTestId: string,
  expectedShellState: { readonly phase: string; readonly shellScreenId?: string | undefined },
  assertTransition: () => Promise<void>,
): Promise<void> => {
  await assertStableShellState(page, expectedShellState);
  const target = page.getByTestId(targetTestId);
  await expect(target).toBeVisible({ timeout: 8_000 });
  await expect(target).toBeEnabled({ timeout: 8_000 });
  const focusSequence: Array<{
    key: 'Tab' | 'Shift+Tab';
    testId: string | null;
    text: string | null;
  }> = [];
  const tabUntilFocused = async (key: 'Tab' | 'Shift+Tab') => {
    for (let index = 0; index < 32; index += 1) {
      const active = page.locator(':focus');
      const testId = await active.getAttribute('data-testid', { timeout: 200 }).catch(() => null);
      const text = await active.textContent({ timeout: 200 }).catch(() => null);
      focusSequence.push({ key, testId, text: text?.trim().slice(0, 80) ?? null });
      if (testId === targetTestId) {
        await expect(target).toBeFocused({ timeout: 1_000 });
        return true;
      }
      await page.keyboard.press(key);
    }
    return false;
  };
  if (!(await tabUntilFocused('Tab'))) {
    const active = page.locator(':focus');
    const testId = await active.getAttribute('data-testid', { timeout: 200 }).catch(() => null);
    if (testId === targetTestId) {
      await expect(target).toBeFocused({ timeout: 1_000 });
    } else {
      await tabUntilFocused('Shift+Tab');
    }
  }
  await expect(target, `focus sequence: ${JSON.stringify(focusSequence)}`).toBeFocused({
    timeout: 1_000,
  });
  await page.keyboard.press('Enter');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      assertTransition(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(`Keyboard transition after ${targetTestId} did not complete within 10000ms`),
          );
        }, 10_000);
      }),
    ]);
  } catch (cause) {
    const focused = page.locator(':focus');
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)}\n` +
        `focusSequence=${JSON.stringify(focusSequence)}\n` +
        `focused=${JSON.stringify({
          testId: await focused.getAttribute('data-testid', { timeout: 200 }).catch(() => null),
          text:
            (await focused.textContent({ timeout: 200 }).catch(() => null))?.trim().slice(0, 80) ??
            null,
        })}\n` +
        `shellState=${JSON.stringify(await shellStateSnapshot(page))}\n` +
        `rendererDebug=${JSON.stringify(await rendererPlaytestDebug(page))}`,
      { cause },
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

describe('acceptance: playtest', () => {
  let smokeContext: SmokeContext | undefined;
  let projectId = '';
  let mapId = '';

  beforeAll(async () => {
    resolveMainEntry();
    smokeContext = await launchElectron(await createTileborneHome());
    const { page } = smokeContext;
    projectId = await page.evaluate(async (name) => {
      const result = await window.tileborne.projects.create({ name });
      return result.projectId;
    }, SMOKE_PROJECT_NAME);

    mapId = await page.evaluate(async (pid) => {
      const { mapId: createdMapId } = await window.tileborne.maps.create({
        projectId: pid,
        width: 32,
        height: 32,
      });
      return createdMapId;
    }, projectId);
    await addBattleRoyaleSpawnAnchors(page, projectId, mapId);

    const pluginSourcePath = resolveBattleRoyaleInstallPath();
    await page.evaluate(
      async ({ sourcePath, pluginId }) => {
        await window.tileborne.plugins.install({
          source: { _tag: 'local', path: sourcePath },
        });
        const { plugins } = await window.tileborne.plugins.list({});
        const installed = plugins.find((plugin) => plugin.id === pluginId);
        if (!installed) {
          throw new Error('No plugin installed');
        }
        if (!installed.enabled) {
          await window.tileborne.plugins.enable({ pluginId: installed.id });
        }
      },
      { sourcePath: pluginSourcePath, pluginId: BATTLE_ROYALE_PLUGIN_ID },
    );
    await setProjectActiveGameMode(page, projectId, BATTLE_ROYALE_PLUGIN_ID);
  }, 60_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('starts playtest via IPC with artifact and active plugins', async () => {
    const { page } = smokeContext!;

    const session = await page.evaluate(
      async ({ pid, mid }) => {
        const { session: started } = await window.tileborne.playtest.start({
          projectId: pid,
          mapId: mid,
        });
        return started;
      },
      { pid: projectId, mid: mapId },
    );

    expect(session.status).toBe('Running');
    expect(session.artifactDirectory).toBeTruthy();
    expect(session.activePlugins?.length ?? 0).toBeGreaterThan(0);
    await page.evaluate(async (ownedSession) => {
      await window.tileborne.playtest.stop({
        sessionId: ownedSession.id,
        projectId: ownedSession.projectId,
        mapId: ownedSession.mapId,
      });
    }, session);
  });

  it('exposes authored shell phases and retry/exit lifecycle through the PlaytestViewport shell', async () => {
    const { page } = smokeContext!;
    const rendererPageEvents = installRendererPageEventDiagnostics(page);
    page.setDefaultTimeout(8_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const fontPack = await step(
      'create and import real authored shell font pack',
      async () => {
        const context = smokeContext;
        if (context === undefined) throw new Error('smoke context is unavailable');
        const pack = await createShellFontPack(context.tileborneHome);
        const jobId = await page.evaluate(async (sourcePath) => {
          const { jobId: id } = await window.tileborne.assets.importPack({
            sourceKind: 'directory',
            path: sourcePath,
          });
          return id;
        }, pack.packRoot);
        const job = await waitForJob(page, jobId);
        if (job.status !== 'Completed') {
          throw new Error(`font pack import failed: ${job.status} ${job.errorMessage ?? ''}`);
        }
        return pack;
      },
      60_000,
    );

    await step('author shell background and font and prove IPC projection', () =>
      page.evaluate(
        async ({ pid, fontHash }) => {
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'register-asset',
              asset: {
                assetId: 'asset:b4111e00-0000-4000-8000-000000000003',
                packId: 'pack:b4111e00-0000-4000-8000-000000000001',
                packVersion: '0.1.0',
                path: 'atlases/objects.png',
                mime: 'image/png',
                kind: 'background',
              },
            },
          });
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'register-asset',
              asset: {
                assetId: 'asset:9a97c29e-0d74-4e64-8b35-085e142238a2',
                packId: 'pack:9a97c29e-0d74-4e64-8b35-085e142238a1',
                packVersion: '1.0.0',
                path: 'fonts/ibm-plex-sans-latin.woff2',
                mime: 'font/woff2',
                kind: 'font',
              },
            },
          });
          const applied = await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'set-screen-asset',
              screenId: 'main-menu',
              slot: 'background',
              assetId: 'asset:b4111e00-0000-4000-8000-000000000003',
            },
          });
          const fontApplied = await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'set-screen-asset',
              screenId: 'main-menu',
              slot: 'font',
              assetId: 'asset:9a97c29e-0d74-4e64-8b35-085e142238a2',
            },
          });
          void fontHash;
          const projection = fontApplied.projection;
          const mainMenu = applied.projection.screens.find((screen) => screen.id === 'main-menu');
          if (mainMenu?.backgroundAssetId !== 'asset:b4111e00-0000-4000-8000-000000000003') {
            throw new Error('Authored main-menu background asset was not projected');
          }
          const fontMainMenu = projection.screens.find((screen) => screen.id === 'main-menu');
          if (fontMainMenu?.fontAssetId !== 'asset:9a97c29e-0d74-4e64-8b35-085e142238a2') {
            throw new Error('Authored main-menu font asset was not projected');
          }
          const backgroundAsset = projection.assets.find(
            (asset) => asset.assetId === mainMenu.backgroundAssetId,
          );
          if (backgroundAsset?.path !== 'atlases/objects.png') {
            throw new Error('Authored main-menu background asset path was not projected');
          }
          const fontAsset = projection.assets.find(
            (asset) => asset.assetId === fontMainMenu.fontAssetId,
          );
          if (fontAsset?.path !== 'fonts/ibm-plex-sans-latin.woff2') {
            throw new Error('Authored main-menu font asset path was not projected');
          }
        },
        { pid: projectId, fontHash: fontPack.hash },
      ),
    );

    const assetProof = await step(
      'fetch authored background through tileborne-asset protocol',
      () =>
        page.evaluate(async () => {
          const { packs } = await window.tileborne.assets.listPacks({});
          const pack = packs.find(
            (entry) => entry.id === 'pack:b4111e00-0000-4000-8000-000000000001',
          );
          if (pack === undefined) throw new Error('Battle Royale asset pack was not installed');
          const params = new URLSearchParams({ id: pack.id, path: 'atlases/objects.png' });
          const url = `tileborne-asset://pack?${params.toString()}`;
          const response = await fetch(url);
          return {
            url,
            ok: response.ok,
            contentType: response.headers.get('content-type'),
          };
        }),
    );
    expect(assetProof.url).toContain('tileborne-asset://pack?');
    expect(assetProof.url).toContain('id=pack%3Ab4111e00-0000-4000-8000-000000000001');
    expect(assetProof.ok).toBe(true);
    expect(assetProof.contentType).toContain('image/png');
    const fontProof = await step('fetch authored font through tileborne-asset protocol', () =>
      page.evaluate(async () => {
        const params = new URLSearchParams({
          id: 'pack:9a97c29e-0d74-4e64-8b35-085e142238a1',
          path: 'fonts/ibm-plex-sans-latin.woff2',
          v: '1.0.0',
        });
        const url = `tileborne-asset://pack?${params.toString()}`;
        const response = await fetch(url);
        return {
          url,
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          byteLength: (await response.arrayBuffer()).byteLength,
        };
      }),
    );
    expect(fontProof.url).toContain('tileborne-asset://pack?');
    expect(fontProof.url).toContain('id=pack%3A9a97c29e-0d74-4e64-8b35-085e142238a1');
    expect(fontProof.ok).toBe(true);
    expect(fontProof.contentType).toContain('font/woff2');
    expect(fontProof.byteLength).toBe(fontPack.size);
    const missingAssetProof = await step('fetch missing authored background returns failure', () =>
      page.evaluate(async () => {
        const params = new URLSearchParams({
          id: 'pack:b4111e00-0000-4000-8000-000000000001',
          path: 'atlases/not-found.png',
        });
        const response = await fetch(`tileborne-asset://pack?${params.toString()}`);
        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      }),
    );
    expect(missingAssetProof.ok).toBe(false);
    expect(missingAssetProof.status).toBeGreaterThanOrEqual(400);
    const missingFontProof = await step('fetch missing authored font returns failure', () =>
      page.evaluate(async () => {
        const params = new URLSearchParams({
          id: 'pack:9a97c29e-0d74-4e64-8b35-085e142238a1',
          path: 'fonts/not-found.woff2',
        });
        const response = await fetch(`tileborne-asset://pack?${params.toString()}`);
        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      }),
    );
    expect(missingFontProof.ok).toBe(false);
    expect(missingFontProof.status).toBeGreaterThanOrEqual(400);

    await step('initialize renderer diagnostics', () =>
      page.evaluate(() => {
        (window as unknown as { __tileborneShellDebug?: unknown }).__tileborneShellDebug = {};
        (
          window as unknown as { __tileborneMapEditorPlaytestDebug?: unknown }
        ).__tileborneMapEditorPlaytestDebug = { events: [] };
        (window as unknown as { __tileborneReadinessDebug?: unknown }).__tileborneReadinessDebug = {
          requests: [],
        };
        (window as unknown as { __tileborneTopBarDebug?: unknown }).__tileborneTopBarDebug = {
          events: [],
        };
        const debugWindow = window as unknown as {
          __tileborneRendererRootDebug?: unknown;
          __tileborneStartupBoundaryDebug?: unknown;
          __tileborneAppShellDebug?: unknown;
        };
        debugWindow.__tileborneRendererRootDebug ??= { events: [] };
        debugWindow.__tileborneStartupBoundaryDebug ??= { events: [] };
        debugWindow.__tileborneAppShellDebug ??= { events: [] };
      }),
    );
    await step('navigate to map editor route', () =>
      navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`),
    );
    await expect(page.getByText('Loading map…')).toBeHidden({ timeout: 20_000 });
    try {
      await expect
        .poll(
          async () => {
            const visible = (await readinessStatusSnapshots(page)).filter((entry) => entry.visible);
            const ready = visible.find((entry) => /Ready|warnings/.test(entry.text));
            if (ready !== undefined) return `ready:${JSON.stringify(ready)}`;
            return `pending:${JSON.stringify(visible)}`;
          },
          { timeout: 15_000 },
        )
        .toMatch(/^ready:/);
    } catch (cause) {
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)}\n` +
          `readinessNodes=${JSON.stringify(await readinessStatusSnapshots(page))}\n` +
          `rendererPageEvents=${JSON.stringify(rendererPageEvents.slice(-80))}\n` +
          `rendererDebug=${JSON.stringify(await rendererPlaytestDebug(page))}`,
        { cause },
      );
    }

    await step('open playtest menu and start local playtest', async () => {
      await page.getByRole('button', { name: /Playtest menu/i }).click();
      await page.getByRole('menuitem', { name: /Single \(local-only\)/i }).click();
    });
    await expect(page.getByTestId('playtest-runtime-shell')).toBeVisible({ timeout: 20_000 });
    const authoredMainMenu = page.getByTestId('shell-screen-main-menu');
    const authoredTitle = page.getByTestId('shell-screen-title');
    const authoredLoading = page.getByTestId('shell-screen-loading');
    const authoredUnavailable = page.getByTestId('shell-screen-unavailable');
    await expect
      .poll(
        async () =>
          (await authoredMainMenu.isVisible())
            ? 'main-menu'
            : (await authoredTitle.isVisible())
              ? 'title'
              : (await authoredUnavailable.isVisible())
                ? 'unavailable'
                : (await authoredLoading.isVisible())
                  ? 'loading'
                  : 'missing',
        { timeout: 15_000 },
      )
      .toMatch(/title|main-menu|loading|unavailable/);
    if (await authoredUnavailable.isVisible()) {
      throw new Error(
        `Playtest shell projection unavailable: ${JSON.stringify(
          await shellHitTestDiagnostics(page),
        )}`,
      );
    }
    if (await authoredLoading.isVisible()) {
      await expect
        .poll(
          async () => {
            if (await authoredMainMenu.isVisible()) return 'main-menu';
            if (await authoredTitle.isVisible()) return 'title';
            const shellState = await page
              .getByTestId('playtest-runtime-shell')
              .evaluate((element) => ({
                queryStatus: element.getAttribute('data-shell-query-status'),
                queryFetchStatus: element.getAttribute('data-shell-query-fetch-status'),
                queryError: element.getAttribute('data-shell-query-error'),
                fallbackStatus: element.getAttribute('data-shell-fallback-status'),
                fallbackError: element.getAttribute('data-shell-fallback-error'),
                projectionState: element.getAttribute('data-shell-projection-state'),
              }));
            if (await authoredUnavailable.isVisible()) {
              return `unavailable:${JSON.stringify(shellState)}`;
            }
            if (await authoredLoading.isVisible()) {
              return `loading:${JSON.stringify(shellState)}`;
            }
            return `missing:${JSON.stringify(shellState)}`;
          },
          { timeout: 30_000 },
        )
        .toMatch(/title|main-menu/);
    }
    if (await authoredTitle.isVisible()) {
      await step(
        'press authored title start action with keyboard',
        () =>
          pressShellActionByKeyboard(
            page,
            'shell-action-title-start',
            { phase: 'menu', shellScreenId: 'title' },
            () => expect(authoredMainMenu).toBeVisible({ timeout: 10_000 }),
          ),
        30_000,
      );
    }
    await step(
      'wait for authored main-menu shell',
      async () => {
        try {
          await expect(authoredMainMenu).toBeVisible({ timeout: 15_000 });
          await expect(authoredMainMenu).toHaveAttribute('data-shell-screen-id', 'main-menu');
          await expect(page.getByTestId('shell-screen-loading')).toBeHidden({ timeout: 1_000 });
          await expect(page.getByTestId('shell-asset-diagnostics')).toBeHidden({ timeout: 1_000 });
          await expect(authoredMainMenu).toHaveCSS('background-image', /tileborne-asset:\/\/pack/);
          await expect(authoredMainMenu).toHaveCSS(
            'background-image',
            /path=atlases%2Fobjects\.png/,
          );
          await expect(authoredMainMenu.locator('.tb-panel')).toHaveCSS(
            'font-family',
            /tb-shell-main-menu-asset-9a97c29e-0d74-4e64-8b35-085e142238a2/,
          );
        } catch (cause) {
          throw new Error(
            `${cause instanceof Error ? cause.message : String(cause)}\n` +
              `afterNavigation=${JSON.stringify(await shellHitTestDiagnostics(page))}`,
            { cause },
          );
        }
      },
      35_000,
    );
    await expect(page.getByTestId('main-menu')).toBeHidden({ timeout: 1_000 });

    await step(
      'bind missing authored shell assets and assert accessible diagnostics',
      async () => {
        await page.evaluate(async (pid) => {
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'register-asset',
              asset: {
                assetId: 'asset:missing-bg',
                packId: 'pack:b4111e00-0000-4000-8000-000000000001',
                packVersion: '0.1.0',
                path: 'atlases/not-found.png',
                mime: 'image/png',
                kind: 'background',
              },
            },
          });
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'register-asset',
              asset: {
                assetId: 'asset:missing-font',
                packId: 'pack:9a97c29e-0d74-4e64-8b35-085e142238a1',
                packVersion: '1.0.0',
                path: 'fonts/not-found.woff2',
                mime: 'font/woff2',
                kind: 'font',
              },
            },
          });
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'set-screen-asset',
              screenId: 'main-menu',
              slot: 'background',
              assetId: 'asset:missing-bg',
            },
          });
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'set-screen-asset',
              screenId: 'main-menu',
              slot: 'font',
              assetId: 'asset:missing-font',
            },
          });
        }, projectId);
        await page.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        });
        const diagnostics = page.getByTestId('shell-asset-diagnostics');
        await expect(diagnostics).toBeVisible({ timeout: 15_000 });
        await expect(diagnostics).toContainText('Background asset failed to load');
        await expect(diagnostics).toContainText('Font asset failed to load');
        await expect(page.getByTestId('shell-action-menu-settings')).toBeVisible();
      },
      30_000,
    );

    await step(
      'navigate authored shell while missing assets remain active',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-menu-settings',
          { phase: 'menu', shellScreenId: 'main-menu' },
          () => expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );
    await step(
      'return from authored settings while missing assets remain active',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-settings-back',
          { phase: 'menu', shellScreenId: 'settings' },
          () => expect(authoredMainMenu).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );
    await expect(page.getByTestId('shell-asset-diagnostics')).toBeVisible({ timeout: 5_000 });

    await step(
      'restore authored shell assets after diagnostics',
      async () => {
        await page.evaluate(async (pid) => {
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'set-screen-asset',
              screenId: 'main-menu',
              slot: 'background',
              assetId: 'asset:b4111e00-0000-4000-8000-000000000003',
            },
          });
          await window.tileborne.gameShell.apply({
            projectId: pid,
            command: {
              type: 'set-screen-asset',
              screenId: 'main-menu',
              slot: 'font',
              assetId: 'asset:9a97c29e-0d74-4e64-8b35-085e142238a2',
            },
          });
        }, projectId);
        await page.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        });
        await expect(page.getByTestId('shell-asset-diagnostics')).toBeHidden({ timeout: 15_000 });
        await expect(authoredMainMenu.locator('.tb-panel')).toHaveCSS(
          'font-family',
          /tb-shell-main-menu-asset-9a97c29e-0d74-4e64-8b35-085e142238a2/,
        );
      },
      30_000,
    );

    await step(
      'press authored menu settings action with keyboard after asset restore',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-menu-settings',
          { phase: 'menu', shellScreenId: 'main-menu' },
          () => expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );
    await step(
      'press authored settings back action with keyboard after asset restore',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-settings-back',
          { phase: 'menu', shellScreenId: 'settings' },
          () => expect(authoredMainMenu).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );

    await step(
      'click authored menu settings action with native mouse',
      () =>
        clickShellActionByPointer(
          page,
          'shell-action-menu-settings',
          { phase: 'menu', shellScreenId: 'main-menu' },
          () => expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 }),
        ),
      25_000,
    );
    await step(
      'click authored settings back action with native mouse',
      () =>
        clickShellActionByPointer(
          page,
          'shell-action-settings-back',
          { phase: 'menu', shellScreenId: 'settings' },
          () => expect(authoredMainMenu).toBeVisible({ timeout: 10_000 }),
        ),
      25_000,
    );

    await step(
      'press authored single-player action with keyboard',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-menu-single',
          { phase: 'menu', shellScreenId: 'main-menu' },
          () => expect(page.getByTestId('playtest-shell-lobby')).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );

    await step('install deterministic playtest list override', () =>
      page.evaluate(async () => {
        const { sessions } = await window.tileborne.playtest.list({});
        const running = sessions.find((session) => session.status === 'Running');
        if (running === undefined) throw new Error('No running playtest session');
        const original = window.tileborne.playtest;
        const originalList = original.list.bind(original);
        let showGameOver = false;
        let lastSessions = sessions;
        Object.defineProperty(window, '__tileborneSmokeShowGameOver', {
          configurable: true,
          get: () => showGameOver,
          set: (value) => {
            showGameOver = Boolean(value);
          },
        });
        Object.defineProperty(window, '__tileborneSmokeRunningSessionCount', {
          configurable: true,
          get: () => lastSessions.filter((session) => session.status === 'Running').length,
        });
        Object.defineProperty(window.tileborne, 'playtest', {
          configurable: true,
          value: {
            ...original,
            list: async (input: Parameters<typeof original.list>[0]) => {
              const result = await originalList(input);
              lastSessions = result.sessions.map((session) => {
                if (session.status !== 'Running') return session;
                if (showGameOver) {
                  return {
                    ...session,
                    runtimeMetrics: {
                      tickCount: 42,
                      playerCount: 1,
                      hud: {
                        totalPlayers: 1,
                        gameplayEvents: [],
                        gameOver: { winnerId: 'player-1', reason: 'last-player-standing' },
                        scoreboard: [
                          {
                            playerId: 'player-1',
                            displayName: 'Electron Ada',
                            health: 100,
                            alive: true,
                            kills: 7,
                            deaths: 0,
                          },
                        ],
                      },
                    },
                  };
                }
                if (session.runtimeMetrics?.hud === undefined) return session;
                const { gameOver, ...hud } = session.runtimeMetrics.hud;
                void gameOver;
                return {
                  ...session,
                  runtimeMetrics: {
                    ...session.runtimeMetrics,
                    hud,
                  },
                };
              });
              return { sessions: lastSessions };
            },
          },
        });
      }),
    );

    await step(
      'press authored lobby start match action with keyboard',
      () =>
        pressShellActionByKeyboard(
          page,
          'playtest-shell-start-match',
          { phase: 'lobby', shellScreenId: 'loading' },
          () => expect(page.getByTestId('in-match')).toBeVisible({ timeout: 6_000 }),
        ),
      30_000,
    );
    await step('click empty match area with native mouse reaches viewport input', () =>
      assertEmptyMatchAreaReachesViewport(page),
    );
    await step('press Escape in authored runtime shell with keyboard', () =>
      page.keyboard.press('Escape'),
    );
    await expect(page.getByTestId('shell-screen-pause')).toBeVisible({ timeout: 10_000 });
    await step(
      'click authored pause resume action with native mouse',
      () =>
        clickShellActionByPointer(
          page,
          'shell-action-pause-resume',
          { phase: 'in-match', shellScreenId: 'pause' },
          () => expect(page.getByTestId('in-match')).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );
    await step('click empty match area with native mouse reaches viewport input after resume', () =>
      assertEmptyMatchAreaReachesViewport(page),
    );
    await step('switch mocked runtime metrics to game-over', () =>
      page.evaluate(() => {
        (
          window as unknown as { __tileborneSmokeShowGameOver: boolean }
        ).__tileborneSmokeShowGameOver = true;
      }),
    );
    try {
      await expect(page.getByTestId('results-screen')).toContainText('Electron Ada', {
        timeout: 15_000,
      });
    } catch (cause) {
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)}\n` +
          `rendererPageEvents=${JSON.stringify(rendererPageEvents.slice(-80))}\n` +
          `rendererDebug=${JSON.stringify(await rendererPlaytestDebug(page))}`,
        { cause },
      );
    }
    await expect(page.getByTestId('shell-screen-results')).toBeVisible();

    await step(
      'press authored results retry action with keyboard',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-results-retry',
          { phase: 'results', shellScreenId: 'results' },
          () => expect(page.getByTestId('playtest-shell-lobby')).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );
    await step('clear mocked game-over metrics after retry', () =>
      page.evaluate(() => {
        (
          window as unknown as { __tileborneSmokeShowGameOver: boolean }
        ).__tileborneSmokeShowGameOver = false;
      }),
    );
    await expect
      .poll(
        async () => {
          return page.evaluate(
            () =>
              (window as unknown as { __tileborneSmokeRunningSessionCount: number })
                .__tileborneSmokeRunningSessionCount,
          );
        },
        { timeout: 15_000 },
      )
      .toBe(1);

    await step(
      'press authored lobby start match action after retry with keyboard',
      () =>
        pressShellActionByKeyboard(
          page,
          'playtest-shell-start-match',
          { phase: 'lobby', shellScreenId: 'loading' },
          () => expect(page.getByTestId('in-match')).toBeVisible({ timeout: 10_000 }),
        ),
      30_000,
    );
    await step('switch mocked runtime metrics to second game-over', () =>
      page.evaluate(() => {
        (
          window as unknown as { __tileborneSmokeShowGameOver: boolean }
        ).__tileborneSmokeShowGameOver = true;
      }),
    );
    try {
      await expect(page.getByTestId('results-screen')).toContainText('Electron Ada', {
        timeout: 15_000,
      });
    } catch (cause) {
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)}\n` +
          `rendererPageEvents=${JSON.stringify(rendererPageEvents.slice(-80))}\n` +
          `rendererDebug=${JSON.stringify(await rendererPlaytestDebug(page))}`,
        { cause },
      );
    }
    await step(
      'press authored results menu action with keyboard',
      () =>
        pressShellActionByKeyboard(
          page,
          'shell-action-results-menu',
          { phase: 'results', shellScreenId: 'results' },
          () => expect(page.getByTestId('playtest-runtime-shell')).toBeHidden({ timeout: 15_000 }),
        ),
      30_000,
    );
  }, 120_000);
});

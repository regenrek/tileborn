import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  readMapJson,
  readProjectManifest,
  resolveMainEntry,
  waitForAppPage,
  type SmokeContext,
} from './helpers.js';

describe('project creation flow (Playwright Electron via vitest)', () => {
  let smokeContext: SmokeContext | undefined;

  beforeAll(async () => {
    resolveMainEntry();
    const tileborneHome = await createTileborneHome();
    smokeContext = await launchElectron(tileborneHome);
  }, 60_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  const reopenAfterRegularClose = async (context: SmokeContext): Promise<SmokeContext> => {
    try {
      await context.app.evaluate(({ app }) => app.emit('activate'));
      const page = await waitForAppPage(context.app);
      await page.waitForLoadState('domcontentloaded');
      return { ...context, page };
    } catch {
      return launchElectron(context.tileborneHome);
    }
  };

  it('boots and shows the home route', async () => {
    const { page } = smokeContext!;

    await expect.poll(async () => page.title(), { timeout: 10_000 }).toMatch(/Tileborne/i);
    await expect(page.getByRole('heading', { name: /^Tileborne$/i })).toBeVisible();
  });

  it('creates a project from the home CTA and persists project.json', async () => {
    const { page, tileborneHome } = smokeContext!;
    const projectName = 'Smoke Test Project';

    const createButton = page
      .getByRole('button', {
        name: /New game/i,
      })
      .first();
    await expect(createButton).toBeVisible();
    await createButton.click();

    await expect(page.getByRole('dialog', { name: /New game/i })).toBeVisible();
    await expect(page.getByTestId('new-game-type-battle-royale')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const projectNameInput = page.getByLabel('Project name');
    await projectNameInput.press('Enter');
    const validationAlert = page.getByRole('alert').filter({
      hasText: 'Project name is required.',
    });
    await expect(validationAlert).toBeVisible();
    await expect(projectNameInput).toBeFocused();
    await expect(projectNameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(projectNameInput).toHaveAttribute(
      'aria-describedby',
      await validationAlert.getAttribute('id'),
    );
    await projectNameInput.fill(projectName);
    await projectNameInput.press('Enter');

    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({
      timeout: 15_000,
    });

    const projectId = await page.evaluate(async (name) => {
      const { projects } = await window.tileborne.projects.list({});
      const created = projects.find((project) => project.name === name);
      if (!created) {
        throw new Error('Created project missing from projects.list()');
      }
      return created.id;
    }, projectName);

    const manifest = await readProjectManifest(tileborneHome, projectId);
    expect(manifest.id).toBe(projectId);
    expect(manifest.name).toBe(projectName);
    expect(manifest.maps).toHaveLength(1);
    expect(manifest.settings?.activeGameMode).toBe('@tileborne-plugins/battle-royale');
    expect(manifest.settings?.newGameWizard).toMatchObject({
      templateId: 'battle-royale-starter-v1',
      completed: true,
    });
  });

  it('resumes the same wizard request without duplicating project or starter map', async () => {
    const { page, tileborneHome } = smokeContext!;
    const name = 'Retry-safe BR Game';
    const result = await page.evaluate(
      async ({ name }) => {
        const request = {
          name,
          gameType: 'battle-royale' as const,
          idempotencyKey: 'smoke-idempotency-request',
        };
        const first = await window.tileborne.projects.createGame(request);
        const second = await window.tileborne.projects.createGame(request);
        const projects = await window.tileborne.projects.list({});
        return {
          first,
          second,
          matchingProjects: projects.projects.filter((project) => project.name === name).length,
        };
      },
      { name },
    );

    expect(result.second).toMatchObject({
      projectId: result.first.projectId,
      mapId: result.first.mapId,
      resumed: true,
    });
    expect(result.matchingProjects).toBe(1);
    const manifest = await readProjectManifest(tileborneHome, result.first.projectId);
    expect(manifest.maps).toHaveLength(1);
  });

  it('coordinates regular window close with cancel, failed save, discard, save and reopen', async () => {
    const context = smokeContext!;
    const created = await context.page.evaluate(async () =>
      window.tileborne.projects.createGame({
        name: 'Lifecycle Smoke Game',
        gameType: 'battle-royale',
        idempotencyKey: 'lifecycle-smoke-request',
      }),
    );

    await navigateToRoute(context.page, `/projects/${created.projectId}/maps/${created.mapId}`);
    const maxPlayers = context.page.getByTestId('br-setting-maxPlayers');
    await expect(maxPlayers).toBeVisible({ timeout: 15_000 });
    await maxPlayers.fill('31');

    const mapTab = context.page.locator('[data-testid="workspace-tab"][data-tab-kind="map"]');
    const mapClose = mapTab.getByTestId('workspace-tab-close');
    let cancelPrompt = 0;
    const cancelClose = async (dialog: { dismiss: () => Promise<void> }) => {
      cancelPrompt += 1;
      await dialog.dismiss();
    };
    context.page.on('dialog', cancelClose);
    await mapClose.click();
    await expect.poll(() => cancelPrompt).toBe(2);
    context.page.off('dialog', cancelClose);
    await expect(maxPlayers).toHaveValue('31');
    await expect(mapTab).toBeVisible();

    context.page.once('dialog', async (dialog) => dialog.accept());
    await mapClose.click();
    await expect(mapTab).toHaveCount(0);
    const persistedAfterClose = await readMapJson(
      context.tileborneHome,
      created.projectId,
      created.mapId,
    );
    expect(persistedAfterClose.properties).toMatchObject({
      '@tileborne-plugins/battle-royale': { maxPlayers: 31 },
    });
    await navigateToRoute(context.page, `/projects/${created.projectId}/maps/${created.mapId}`);
    await expect(context.page.getByTestId('br-setting-maxPlayers')).toHaveValue('31');

    await navigateToRoute(context.page, `/projects/${created.projectId}/game-content`);
    await context.page.getByTestId('content-tab-items').click();
    await context.page.getByTestId('content-name').fill('Recovered Potion');
    await expect(context.page.getByTestId('content-document-status')).toHaveText('dirty');

    let windowCancelPrompt = 0;
    const cancelWindowClose = async (dialog: { dismiss: () => Promise<void> }) => {
      windowCancelPrompt += 1;
      await dialog.dismiss();
    };
    context.page.on('dialog', cancelWindowClose);
    await context.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect.poll(() => windowCancelPrompt).toBe(2);
    context.page.off('dialog', cancelWindowClose);
    expect(context.page.isClosed()).toBe(false);
    await expect(context.page.getByTestId('content-name')).toHaveValue('Recovered Potion');

    await navigateToRoute(context.page, `/projects/${created.projectId}`);
    await navigateToRoute(context.page, `/projects/${created.projectId}/game-content`);
    await expect(context.page.getByTestId('content-name')).toHaveValue('Recovered Potion');
    await expect(context.page.getByTestId('content-document-status')).toHaveText('dirty');

    context.page.once('dialog', async (dialog) => dialog.accept());
    await context.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect(context.page.getByTestId('content-document-status')).toHaveText('error');
    expect(context.page.isClosed()).toBe(false);

    let discardPrompt = 0;
    context.page.on('dialog', async (dialog) => {
      discardPrompt += 1;
      if (discardPrompt === 1) await dialog.dismiss();
      else await dialog.accept();
    });
    const discardedWindowClosed = context.page.waitForEvent('close');
    await context.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await discardedWindowClosed;
    smokeContext = await reopenAfterRegularClose(context);
    await navigateToRoute(smokeContext.page, `/projects/${created.projectId}/game-content`);
    await smokeContext.page.getByTestId('content-tab-items').click();
    await expect(smokeContext.page.getByTestId('content-name')).toHaveValue('');
    await expect(smokeContext.page.getByTestId('content-document-status')).toHaveText('clean');

    await navigateToRoute(
      smokeContext.page,
      `/projects/${created.projectId}/maps/${created.mapId}`,
    );
    const closeSavedMaxPlayers = smokeContext.page.getByTestId('br-setting-maxPlayers');
    await expect(closeSavedMaxPlayers).toBeVisible();
    await closeSavedMaxPlayers.fill('30');
    smokeContext.page.once('dialog', async (dialog) => dialog.accept());
    const savedWindowClosed = smokeContext.page.waitForEvent('close');
    await smokeContext.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await savedWindowClosed;
    smokeContext = await reopenAfterRegularClose(smokeContext);
    await navigateToRoute(
      smokeContext.page,
      `/projects/${created.projectId}/maps/${created.mapId}`,
    );
    await expect(smokeContext.page.getByTestId('br-setting-maxPlayers')).toHaveValue('30');
  });

  it('coordinates app quit with renderer cancel and discard before relaunch', async () => {
    const context = smokeContext!;
    const created = await context.page.evaluate(async () =>
      window.tileborne.projects.createGame({
        name: 'App Quit Smoke Game',
        gameType: 'battle-royale',
        idempotencyKey: 'app-quit-smoke-request',
      }),
    );
    await navigateToRoute(context.page, `/projects/${created.projectId}/game-content`);
    await context.page.getByTestId('content-tab-items').click();
    await context.page.getByTestId('content-name').fill('Quit Guard Draft');
    await expect(context.page.getByTestId('content-document-status')).toHaveText('dirty');

    let cancelPrompt = 0;
    const cancelQuit = async (dialog: { dismiss: () => Promise<void> }) => {
      cancelPrompt += 1;
      await dialog.dismiss();
    };
    context.page.on('dialog', cancelQuit);
    await context.app.evaluate(({ app }) => app.quit());
    await expect.poll(() => cancelPrompt).toBe(2);
    context.page.off('dialog', cancelQuit);
    expect(context.page.isClosed()).toBe(false);

    let discardPrompt = 0;
    context.page.on('dialog', async (dialog) => {
      discardPrompt += 1;
      if (discardPrompt === 1) await dialog.dismiss();
      else await dialog.accept();
    });
    const appClosed = context.app.waitForEvent('close');
    await context.app.evaluate(({ app }) => app.quit());
    await appClosed;
    smokeContext = await launchElectron(context.tileborneHome);
    await expect
      .poll(async () => smokeContext!.page.title(), { timeout: 10_000 })
      .toMatch(/Tileborne/i);
  });

  it('restores an unsaved creator draft after an ungraceful process exit', async () => {
    const context = smokeContext!;
    const created = await context.page.evaluate(async () =>
      window.tileborne.projects.createGame({
        name: 'Crash Recovery Smoke Game',
        gameType: 'battle-royale',
        idempotencyKey: 'crash-recovery-smoke-request',
      }),
    );
    await navigateToRoute(context.page, `/projects/${created.projectId}/game-content`);
    await context.page.getByTestId('content-tab-items').click();
    await context.page.getByTestId('content-name').fill('Crash Recovered Potion');
    await expect(context.page.getByTestId('content-document-status')).toHaveText('dirty');
    const recoveryDocumentId = `game-content:${created.projectId}`;
    await expect
      .poll(() =>
        context.page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return (
            records.find((record) => record.documentId === documentId)?.snapshot as
              | { label?: string }
              | undefined
          )?.label;
        }, recoveryDocumentId),
      )
      .toBe('Crash Recovered Potion');

    const appClosed = context.app.waitForEvent('close');
    context.app.process().kill('SIGKILL');
    await appClosed;

    smokeContext = await launchElectron(context.tileborneHome);
    await expect
      .poll(() =>
        smokeContext!.page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return records.some((record) => record.documentId === documentId);
        }, recoveryDocumentId),
      )
      .toBe(true);
    await navigateToRoute(smokeContext.page, `/projects/${created.projectId}/game-content`);
    await smokeContext.page.getByTestId('content-tab-items').click();
    await expect(smokeContext.page.getByTestId('content-name')).toHaveValue(
      'Crash Recovered Potion',
    );
    await expect(smokeContext.page.getByTestId('content-document-status')).toHaveText('dirty');
    await smokeContext.page.getByTestId('content-discard-draft').click();
    await expect(smokeContext.page.getByTestId('content-document-status')).toHaveText('clean');
    await expect
      .poll(() =>
        smokeContext!.page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return records.every((record) => record.documentId !== documentId);
        }, recoveryDocumentId),
      )
      .toBe(true);

    const discardedAppClosed = smokeContext.app.waitForEvent('close');
    smokeContext.app.process().kill('SIGKILL');
    await discardedAppClosed;
    smokeContext = await launchElectron(context.tileborneHome);
    await expect
      .poll(() =>
        smokeContext!.page.evaluate(async (documentId) => {
          const { records } = await window.tileborneAppLifecycle.loadRecoveryStorage();
          return records.every((record) => record.documentId !== documentId);
        }, recoveryDocumentId),
      )
      .toBe(true);
    await navigateToRoute(smokeContext.page, `/projects/${created.projectId}/game-content`);
    await smokeContext.page.getByTestId('content-tab-items').click();
    await expect(smokeContext.page.getByTestId('content-name')).toHaveValue('');
    await expect(smokeContext.page.getByTestId('content-document-status')).toHaveText('clean');
  });

  it('completes an IPC ping round-trip after project creation', async () => {
    const { page } = smokeContext!;
    const response = await page.evaluate(async () => window.tileborne.system.ping({}));
    expect(response.pong).toBe(true);
    expect(typeof response.ts).toBe('number');
    expect(Number.isFinite(response.ts)).toBe(true);
  });
});

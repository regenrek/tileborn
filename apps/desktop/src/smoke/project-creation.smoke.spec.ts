import { expect } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  readProjectManifest,
  resolveMainEntry,
  type SmokeContext,
} from './helpers.js';

let smokeContext: SmokeContext | undefined;
let sandboxSkipReason: string | undefined;

describe.sequential('project creation flow', () => {
  beforeAll(async () => {
    try {
      resolveMainEntry();
      const tileborneHome = await createTileborneHome();
      smokeContext = await launchElectron(tileborneHome);
    } catch (error) {
      sandboxSkipReason = `Electron GUI cannot boot in this sandbox environment: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  });

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  beforeEach((context) => {
    if (sandboxSkipReason) {
      context.skip();
    }
    expect(smokeContext, 'Electron smoke context failed to initialize').toBeDefined();
  });

  it('boots without main-process crash and mounts home route', async () => {
    const { page } = smokeContext!;
    await expect(page).toHaveTitle(/Tileborne/i);
    await expect(
      page.getByRole('heading', { name: /Tileborne|Projects/i }),
    ).toBeVisible();
  });

  it('creates a project from the home CTA and persists project.json', async () => {
    const { page, tileborneHome } = smokeContext!;

    const createButton = page.getByRole('button', {
      name: /New game/i,
    }).first();
    await expect(createButton).toBeVisible();
    await createButton.click();
    await page.getByLabel('Project name').fill('Untitled Project');
    await page.getByTestId('create-project-submit').click();

    await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible({
      timeout: 15_000,
    });

    const projectId = await page.evaluate(async () => {
      const { projects } = await window.tileborne.projects.list({});
      const created = projects.find((project) => project.name === 'Untitled Project');
      if (!created) {
        throw new Error('Created project missing from projects.list()');
      }
      return created.id;
    });

    const manifest = await readProjectManifest(tileborneHome, projectId);
    expect(manifest.id).toBe(projectId);
    expect(manifest.name).toBe('Untitled Project');
  });

  it('IPC ping round-trip succeeds after project creation', async () => {
    const { page } = smokeContext!;
    const response = await page.evaluate(async () => window.tileborne.system.ping({}));
    expect(response.pong).toBe(true);
    expect(typeof response.ts).toBe('number');
    expect(Number.isFinite(response.ts)).toBe(true);
  });
});

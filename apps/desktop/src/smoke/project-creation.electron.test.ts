import { expect } from '@playwright/test';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  readProjectManifest,
  resolveMainEntry,
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

  it('boots and shows the home route', async () => {
    const { page } = smokeContext!;

    await expect.poll(async () => page.title(), { timeout: 10_000 }).toMatch(/Tileborne/i);
    await expect(page.getByRole('heading', { name: /^Tileborne$/i })).toBeVisible();
  });

  it('creates a project from the home CTA and persists project.json', async () => {
    const { page, tileborneHome } = smokeContext!;
    const projectName = 'Smoke Test Project';

    const createButton = page.getByRole('button', {
      name: /Create project/i,
    }).first();
    await expect(createButton).toBeVisible();
    await createButton.click();

    await expect(page.getByRole('dialog', { name: /New project/i })).toBeVisible();
    await page.getByLabel('Project name').fill(projectName);
    await page.getByTestId('create-project-submit').click();

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
  });

  it('completes an IPC ping round-trip after project creation', async () => {
    const { page } = smokeContext!;
    const response = await page.evaluate(async () => window.tileborne.system.ping({}));
    expect(response.pong).toBe(true);
    expect(typeof response.ts).toBe('number');
    expect(Number.isFinite(response.ts)).toBe(true);
  });
});

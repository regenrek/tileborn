import { expect } from './playwright-expect.js';
import { afterAll, beforeAll, describe, it } from 'vitest';

import {
  createTileborneHome,
  disposeSmokeContext,
  launchElectron,
  navigateToRoute,
  readMapJson,
  resolveMainEntry,
  SMOKE_PROJECT_NAME,
  type SmokeContext,
} from './helpers.js';

describe('acceptance: map generate', () => {
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
  }, 60_000);

  afterAll(async () => {
    await disposeSmokeContext(smokeContext);
    smokeContext = undefined;
  });

  it('generates a procedural map with non-empty tile data', async () => {
    const { page, tileborneHome } = smokeContext!;

    const generated = await page.evaluate(
      async ({ pid }) => {
        const { map } = await window.tileborne.maps.generate({
          projectId: pid,
          width: 32,
          height: 32,
          seed: 1337,
          preset: 'dungeon',
        });
        return map;
      },
      { pid: projectId },
    );

    mapId = generated.id;
    const tileLayer = generated.layers.find(
      (layer) => layer.kind === 'tile' || layer._tag === 'tile',
    );
    expect(tileLayer?.kind ?? tileLayer?._tag).toBe('tile');
    const chunk = tileLayer?.chunks[0];
    expect(chunk?.tiles.some((value) => value === 1)).toBe(true);
    expect(chunk?.tiles.some((value) => value === 2)).toBe(true);

    const saved = await readMapJson(tileborneHome, projectId, mapId);
    expect(saved).toMatchObject({ id: mapId });
  });

  it('opens generated map in editor viewport', async () => {
    const { page } = smokeContext!;
    await navigateToRoute(page, `/projects/${projectId}/maps/${mapId}`);
    await expect(page.getByText('Loading map…')).toBeHidden({ timeout: 20_000 });
    const viewport = page.locator('.touch-none.bg-background');
    await expect(viewport).toBeVisible({ timeout: 20_000 });
    await expect(viewport.locator(':scope > canvas')).toBeVisible({ timeout: 20_000 });
  });
});

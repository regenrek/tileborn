import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { writeBrokenMapFixture, initHomeProject } from './helpers/fixtures.js';
import { expectCliJsonData, runCli } from './helpers/run-cli.js';
import { registerE2eHomeHooks } from './helpers/temp-home.js';

describe.sequential('map e2e', () => {
  registerE2eHomeHooks();

  const seedProject = async (): Promise<{
    readonly projectSlug: string;
    readonly projectPath: string;
  }> => {
    const project = await initHomeProject('map-proj');
    return { projectSlug: project.projectSlug, projectPath: project.projectPath };
  };

  it('map generate creates a map in an initialized project', async () => {
    const { projectSlug } = await seedProject();
    const data = await expectCliJsonData<{ readonly mapId: string }>([
      'map',
      'generate',
      'hello',
      '--width',
      '8',
      '--height',
      '8',
      '--project',
      projectSlug,
    ]);
    expect(data.mapId).toMatch(/^map:/);
  });

  it('map validate exits 0 for a generated map', async () => {
    const { projectSlug } = await seedProject();
    const generated = await expectCliJsonData<{ readonly mapId: string }>([
      'map',
      'generate',
      'hello',
      '--width',
      '8',
      '--height',
      '8',
      '--project',
      projectSlug,
    ]);
    const validated = await expectCliJsonData<{ readonly ok: boolean }>([
      'map',
      'validate',
      generated.mapId,
      '--project',
      projectSlug,
    ]);
    expect(validated.ok).toBe(true);
  });

  it('map export writes parseable canonical json', async () => {
    const { projectSlug, projectPath } = await seedProject();
    const generated = await expectCliJsonData<{ readonly mapId: string }>([
      'map',
      'generate',
      'hello',
      '--width',
      '8',
      '--height',
      '8',
      '--project',
      projectSlug,
    ]);
    const outFile = 'exports/out.json';
    await expectCliJsonData([
      'map',
      'export',
      generated.mapId,
      '--format',
      'json',
      '--out',
      outFile,
      '--project',
      projectSlug,
    ]);
    const exported = JSON.parse(await readFile(path.join(projectPath, outFile), 'utf8')) as {
      readonly id: string;
    };
    expect(exported.id).toBe(generated.mapId);
  });
});

describe.sequential('map e2e negative', () => {
  registerE2eHomeHooks();

  it('map validate against tampered fixture json exits 65', async () => {
    const brokenDir = await writeBrokenMapFixture();
    const result = await runCli(['map', 'validate', '--file', path.join(brokenDir, 'broken.json')]);
    expect(result.code).toBe(65);
  });
});

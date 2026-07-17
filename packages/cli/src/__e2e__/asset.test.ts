import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { makePackId, type PackId } from '@tileborne/core';

import { describe, expect, it } from 'vitest';

import { initHomeProject, writeAssetPackSource } from './helpers/fixtures.js';
import { expectCliJsonData, runCli } from './helpers/run-cli.js';
import { registerE2eHomeHooks } from './helpers/temp-home.js';

describe.sequential('asset e2e', () => {
  registerE2eHomeHooks();

  it('asset import --json imports a fixture directory', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-asset-import-'));
    await writeAssetPackSource(source);
    const data = await expectCliJsonData<{ readonly packId: string }>(['asset', 'import', source]);
    expect(data.packId).toMatch(/^pack:/);
  });

  it('asset list --json lists imported packs', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-asset-list-'));
    await writeAssetPackSource(source);
    await expectCliJsonData(['asset', 'import', source]);
    const data = await expectCliJsonData<{
      readonly packs: readonly { readonly id: string; readonly assetCount: number }[];
    }>(['asset', 'list']);
    expect(data.packs.length).toBeGreaterThan(0);
    expect(data.packs[0]?.assetCount).toBe(1);
  });

  it('asset reindex --json rebuilds the project asset index', async () => {
    const packId = makePackId('550e8400-e29b-41d4-a716-446655440020');
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-asset-reindex-'));
    await writeAssetPackSource(source, packId);
    const init = await initHomeProject('asset-proj');
    await expectCliJsonData(['asset', 'import', source]);
    const manifest = JSON.parse(
      await readFile(path.join(init.projectPath, 'project.json'), 'utf8'),
    ) as {
      assetPacks: { id: PackId; version: string }[];
    };
    manifest.assetPacks = [{ id: packId, version: '1.0.0' }];
    await writeFile(
      path.join(init.projectPath, 'project.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const data = await expectCliJsonData<{ readonly indexPath: string }>([
      'asset',
      'reindex',
      '--project',
      'asset-proj',
    ]);
    expect(data.indexPath).toContain('.tileborne');
    await expect(readFile(data.indexPath, 'utf8')).resolves.toContain(packId);
  });
});

describe.sequential('asset e2e negative', () => {
  registerE2eHomeHooks();

  it('asset import on a missing path exits 66', async () => {
    const result = await runCli(['asset', 'import', '/nonexistent-tileborne-e2e-asset-path']);
    expect(result.code).toBe(66);
  });
});

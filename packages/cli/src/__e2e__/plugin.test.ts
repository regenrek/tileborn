import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { packPluginTarball, writePluginSource } from './helpers/fixtures.js';
import { expectCliJsonData, runCli } from './helpers/run-cli.js';
import { makeTempDir, registerE2eHomeHooks, tileborneHome } from './helpers/temp-home.js';

describe.sequential('plugin e2e', () => {
  registerE2eHomeHooks();

  it('plugin create scaffolds a plugin directory', async () => {
    const cwd = makeTempDir('tileborne-cli-e2e-plugin-create-');
    const previous = process.cwd();
    process.chdir(cwd);
    try {
      const data = await expectCliJsonData<{
        readonly directory: string;
        readonly manifest: { readonly id: string };
      }>(['plugin', 'create', 'my-plug']);
      expect(data.manifest.id).toBe('@tileborne-plugins/my-plug');
      await expect(
        readFile(path.join(cwd, 'my-plug', 'tileborne-plugin.json'), 'utf8'),
      ).resolves.toContain('@tileborne-plugins/my-plug');
    } finally {
      process.chdir(previous);
    }
  });

  it('plugin pack writes .tbpack and integrity metadata', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-plugin-pack-src-'));
    await writePluginSource(source, '@tileborne-plugins/e2e-pack');
    const outDir = makeTempDir('tileborne-cli-e2e-plugin-pack-out-');
    const archive = path.join(outDir, 'plugin.tbpack');
    const data = await expectCliJsonData<{
      readonly archivePath: string;
      readonly integrity: string;
    }>(['plugin', 'pack', source, '--out', archive]);
    expect(data.archivePath).toMatch(/\.tbpack$/);
    expect(data.integrity).toMatch(/^sha256:/);
    await expect(readFile(`${data.archivePath}.meta.json`, 'utf8')).resolves.toContain(
      data.integrity,
    );
  });

  it('plugin install --tarball installs with integrity', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-plugin-install-src-'));
    await writePluginSource(source, '@tileborne-plugins/e2e-install');
    const outDir = makeTempDir('tileborne-cli-e2e-plugin-install-out-');
    const archive = path.join(outDir, 'plugin.tbpack');
    const packed = await packPluginTarball(source, archive);
    const data = await expectCliJsonData<{ readonly id: string }>([
      'plugin',
      'install',
      '--tarball',
      packed.archive,
      '--integrity',
      packed.integrity,
    ]);
    expect(data.id).toBe('@tileborne-plugins/e2e-install');
  });

  it('plugin list --json shows the installed plugin', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-plugin-list-src-'));
    await writePluginSource(source, '@tileborne-plugins/e2e-list');
    await expectCliJsonData(['plugin', 'install', '--local', source]);
    const data = await expectCliJsonData<{
      readonly plugins: readonly { readonly id: string; readonly integrityOk: boolean }[];
    }>(['plugin', 'list']);
    expect(data.plugins.some((entry) => entry.id === '@tileborne-plugins/e2e-list')).toBe(true);
    expect(
      data.plugins.find((entry) => entry.id === '@tileborne-plugins/e2e-list')?.integrityOk,
    ).toBe(true);
  });
});

describe.sequential('plugin e2e negative', () => {
  registerE2eHomeHooks();

  it('plugin verify exits 65 after corrupting an installed plugin file', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-e2e-plugin-verify-src-'));
    const pluginId = '@tileborne-plugins/e2e-verify';
    await writePluginSource(source, pluginId);
    await expectCliJsonData(['plugin', 'install', '--local', source]);
    const installedDir = path.join(
      tileborneHome(),
      'plugins',
      `${encodeURIComponent(pluginId)}-0.1.0`,
    );
    await writeFile(path.join(installedDir, 'README.md'), 'tampered\n');
    const verify = await runCli(['plugin', 'verify', pluginId]);
    expect(verify.code).toBe(65);
  });
});

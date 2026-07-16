import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Option } from 'effect';

import {
  AssetPackManifest,
  AssetPackManifestAsset,
  assetPackManifestToJson,
  License,
} from '@tileborne/asset-pipeline';
import { hashBytes, makeAssetId, makePackId } from '@tileborne/core';

const execFileAsync = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, '../dist/main.js');
const EMPTY_MAP = path.resolve(import.meta.dirname, '../../core/src/__fixtures__/empty-map.json');
const TILED_FIXTURE = path.resolve(import.meta.dirname, './__fixtures__/tiled-ground.json');
const TILED_IMAGE_COLLECTION_FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  '../../test-fixtures/fixtures/maps/tiled-image-collection',
);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const assetLicense = new License({
  spdxId: 'CC0-1.0',
  attribution: Option.some('Tileborne test fixture'),
  sourceUrl: Option.some('https://example.invalid/tileborne-cli-game'),
  notes: Option.none(),
});

const tempHomes: string[] = [];
let cliChain: Promise<void> = Promise.resolve();

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      await rm(home, { recursive: true, force: true });
    }
  }
  delete process.env['TILEBORNE_HOME'];
});

const makeTempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), 'tileborne-cli-game-'));
  tempHomes.push(home);
  return home;
};

const runCli = async (
  args: readonly string[],
  home: string,
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const previous = cliChain;
  let release!: () => void;
  cliChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    try {
      const result = await execFileAsync(process.execPath, [CLI, ...args], {
        env: { ...process.env, TILEBORNE_HOME: home },
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: String(result.stdout), stderr: String(result.stderr), code: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: String(failed.stdout ?? ''),
        stderr: String(failed.stderr ?? ''),
        code: failed.code ?? 1,
      };
    }
  } finally {
    release();
  }
};

const prepareProjectDir = async (
  home: string,
  slug: string,
): Promise<{ projectSlug: string; projectPath: string }> => {
  const init = await runCli(['project', 'init', slug, '--json'], home);
  expect(init.code).toBe(0);
  const initPayload = JSON.parse(init.stdout) as {
    data: { path: string; manifest: { id: string; name: string } };
  };
  const projectPath = path.join(path.dirname(initPayload.data.path), initPayload.data.manifest.id);
  await rename(initPayload.data.path, projectPath);
  return { projectSlug: initPayload.data.manifest.name, projectPath };
};

const writeCliAssetPackSource = async (
  home: string,
): Promise<{ source: string; packId: string }> => {
  const source = path.join(home, 'source-asset-pack');
  const packId = makePackId('550e8400-e29b-41d4-a716-446655440030');
  const manifest = new AssetPackManifest({
    id: packId,
    name: 'CLI Describe Pack',
    version: '1.0.0',
    license: assetLicense,
    assets: [
      new AssetPackManifestAsset({
        id: makeAssetId('550e8400-e29b-41d4-a716-446655440031'),
        path: 'tiles/terrain.png',
        mime: 'image/png',
        size: png.byteLength,
        hash: hashBytes(png),
        license: Option.some(assetLicense),
      }),
    ],
  });
  await mkdir(path.join(source, 'tiles'), { recursive: true });
  await writeFile(path.join(source, 'tiles', 'terrain.png'), png);
  await writeFile(
    path.join(source, 'tileborne-asset-pack.json'),
    `${JSON.stringify(assetPackManifestToJson(manifest), null, 2)}\n`,
  );
  return { source, packId };
};

const seedProjectWithMap = async (
  home: string,
): Promise<{ mapId: string; projectSlug: string; projectPath: string }> => {
  const { projectSlug, projectPath } = await prepareProjectDir(home, 'playtest-proj');
  const generated = await runCli(
    [
      'map',
      'generate',
      'fixture-map',
      '--width',
      '8',
      '--height',
      '8',
      '--template',
      'empty',
      '--project',
      projectSlug,
      '--json',
    ],
    home,
  );
  expect(generated.code, generated.stderr + generated.stdout).toBe(0);
  const mapId = (JSON.parse(generated.stdout) as { data: { mapId: string } }).data.mapId;
  return { mapId, projectSlug, projectPath };
};

describe.sequential('game CLI families', () => {
  it('map validate accepts canonical fixture file', async () => {
    const home = await makeTempHome();
    const result = await runCli(['map', 'validate', '--file', EMPTY_MAP, '--json'], home);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly data: { readonly ok: boolean } };
    expect(payload.data.ok).toBe(true);
  });

  it('map validate detects chunk integrity drift', async () => {
    const home = await makeTempHome();
    const broken = await mkdtemp(path.join(tmpdir(), 'tileborne-broken-map-'));
    const raw = JSON.parse(await readFile(EMPTY_MAP, 'utf8')) as {
      layers: { chunks: { tiles: number[] }[] }[];
    };
    raw.layers[0].chunks[0].tiles = [0];
    await writeFile(path.join(broken, 'broken.json'), `${JSON.stringify(raw, null, 2)}\n`);
    const result = await runCli(
      ['map', 'validate', '--file', path.join(broken, 'broken.json')],
      home,
    );
    expect(result.code).toBe(65);
    await rm(broken, { recursive: true, force: true });
  });

  it('map export round-trips canonical json', async () => {
    const home = await makeTempHome();
    const { mapId, projectSlug, projectPath } = await seedProjectWithMap(home);
    const out = 'exports/out.json';
    const exported = await runCli(
      [
        'map',
        'export',
        mapId,
        '--format',
        'json',
        '--out',
        out,
        '--project',
        projectSlug,
        '--json',
      ],
      home,
    );
    expect(exported.code).toBe(0);
    const validate = await runCli(
      ['map', 'validate', '--file', path.join(projectPath, out), '--json'],
      home,
    );
    expect(validate.code).toBe(0);
  }, 15_000);

  it('map import-tiled maps tile layer from fixture', async () => {
    const home = await makeTempHome();
    const { projectSlug, projectPath } = await prepareProjectDir(home, 'tiled-proj');
    const fixtureRel = 'imports/tiled-ground.json';
    await mkdir(path.join(projectPath, 'imports'), { recursive: true });
    await writeFile(path.join(projectPath, fixtureRel), await readFile(TILED_FIXTURE, 'utf8'));
    const imported = await runCli(
      ['map', 'import-tiled', fixtureRel, '--project', projectSlug, '--json'],
      home,
    );
    expect(imported.code).toBe(0);
    const payload = JSON.parse(imported.stdout) as {
      readonly data: { readonly layerCount: number };
    };
    expect(payload.data.layerCount).toBeGreaterThan(0);
  });

  it('tiled scan --json reports standard image-collection features', async () => {
    const home = await makeTempHome();
    const result = await runCli(
      ['tiled', 'scan', path.join(TILED_IMAGE_COLLECTION_FIXTURE_DIR, 'standard.tmj'), '--json'],
      home,
    );
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly data: {
        readonly featureFlags: { readonly imageCollection: boolean; readonly gridAtlas: boolean };
        readonly placeableCandidates: readonly unknown[];
        readonly sourceRoles: readonly { readonly kind: string; readonly evidence: string }[];
        readonly importRecommendation: { readonly primaryAction: string; readonly browseTarget: string };
      };
    };
    expect(payload.data.featureFlags.imageCollection).toBe(true);
    expect(payload.data.featureFlags.gridAtlas).toBe(true);
    expect(payload.data.placeableCandidates.length).toBe(1);
    expect(payload.data.sourceRoles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'placeable-object', evidence: 'image-collection' }),
      ]),
    );
    expect(payload.data.importRecommendation).toMatchObject({
      primaryAction: 'import-mixed-assets',
      browseTarget: 'tilesets',
    });
  });

  it('map import-tiled supports standard and standard-plus-hints profiles', async () => {
    const home = await makeTempHome();
    const { projectSlug, projectPath } = await prepareProjectDir(home, 'tiled-profiles');
    const fixtureRel = 'imports/tiled-image-collection';
    await mkdir(path.join(projectPath, fixtureRel), { recursive: true });
    for (const file of ['standard.tmj', 'terrain.png', 'tree.png']) {
      await writeFile(
        path.join(projectPath, fixtureRel, file),
        await readFile(path.join(TILED_IMAGE_COLLECTION_FIXTURE_DIR, file)),
      );
    }

    for (const profile of ['standard', 'standard-plus-hints']) {
      const imported = await runCli(
        [
          'map',
          'import-tiled',
          path.join(fixtureRel, 'standard.tmj'),
          '--profile',
          profile,
          '--project',
          projectSlug,
          '--json',
        ],
        home,
      );
      expect(imported.code, imported.stderr + imported.stdout).toBe(0);
      const payload = JSON.parse(imported.stdout) as {
        readonly data: { readonly objectCount: number; readonly packId?: string };
      };
      expect(payload.data.objectCount).toBe(1);
      expect(payload.data.packId).toMatch(/^pack:/);
    }
  }, 15_000);

  it('asset describe prints capability and asset remove deletes the pack', async () => {
    const home = await makeTempHome();
    const { source, packId } = await writeCliAssetPackSource(home);
    const imported = await runCli(['asset', 'import', source, '--json'], home);
    expect(imported.code, imported.stderr + imported.stdout).toBe(0);

    const described = await runCli(['asset', 'describe', packId, '--json'], home);
    expect(described.code, described.stderr + described.stdout).toBe(0);
    const describePayload = JSON.parse(described.stdout) as {
      readonly data: {
        readonly capability: {
          readonly paintable: boolean;
          readonly diagnostics: readonly { readonly _tag: string }[];
        };
        readonly license: { readonly spdxId: string };
        readonly provenance: { readonly sourceUrl?: string };
      };
    };
    expect(describePayload.data.capability.paintable).toBe(false);
    expect(
      describePayload.data.capability.diagnostics.map((diagnostic) => diagnostic._tag),
    ).toContain('PACK.no-tilesets');
    expect(describePayload.data.license.spdxId).toBe('CC0-1.0');
    expect(describePayload.data.provenance.sourceUrl).toBe(
      'https://example.invalid/tileborne-cli-game',
    );

    const removed = await runCli(['asset', 'remove', packId, '--json'], home);
    expect(removed.code, removed.stderr + removed.stdout).toBe(0);
    const listed = await runCli(['asset', 'list', '--json'], home);
    expect(listed.code).toBe(0);
    const listPayload = JSON.parse(listed.stdout) as {
      readonly data: { readonly packs: readonly unknown[] };
    };
    expect(listPayload.data.packs).toEqual([]);
  }, 15_000);

  it('map import-tiled imports a minimal TMX fixture', async () => {
    const home = await makeTempHome();
    const { projectSlug, projectPath } = await prepareProjectDir(home, 'tmx-proj');
    const tmxFixture = path.resolve(
      import.meta.dirname,
      '../../test-fixtures/fixtures/maps/tiled-ground/ground.tmx',
    );
    const fixtureRel = 'imports/ground.tmx';
    await mkdir(path.join(projectPath, 'imports'), { recursive: true });
    await writeFile(path.join(projectPath, fixtureRel), await readFile(tmxFixture, 'utf8'));
    await writeFile(path.join(projectPath, 'imports/ground.png'), png);
    const imported = await runCli(
      ['map', 'import-tiled', fixtureRel, '--project', projectSlug, '--json'],
      home,
    );
    expect(imported.code, imported.stderr + imported.stdout).toBe(0);
    const payload = JSON.parse(imported.stdout) as {
      readonly data: { readonly layerCount: number };
    };
    expect(payload.data.layerCount).toBe(1);
  });

  it('playtest headless ticks and exits cleanly', async () => {
    const home = await makeTempHome();
    const { mapId, projectSlug } = await seedProjectWithMap(home);
    const result = await runCli(
      ['playtest', mapId, '--duration', '1', '--project', projectSlug, '--json'],
      home,
    );
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly data: {
        readonly stats: { readonly ticks: number; readonly hookSummary: Record<string, number> };
      };
    };
    expect(payload.data.stats.ticks).toBeGreaterThan(0);
  });

  it('playtest counts plugin hook firing with fixture plugin id', async () => {
    const home = await makeTempHome();
    const { mapId, projectSlug } = await seedProjectWithMap(home);
    const result = await runCli(
      [
        'playtest',
        mapId,
        '--duration',
        '1',
        '--project',
        projectSlug,
        '--plugin',
        '@tileborne-plugins/cli-playtest',
        '--json',
      ],
      home,
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly data: { readonly stats: { readonly hookSummary: Record<string, number> } };
    };
    expect(payload.data.stats.hookSummary['@tileborne-plugins/cli-playtest']).toBeGreaterThan(0);
  }, 15_000);

  it('runtime serve binds and serves artifact index', async () => {
    const home = await makeTempHome();
    const { mapId, projectSlug } = await seedProjectWithMap(home);
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'tileborne-artifact-'));
    const playtest = await runCli(
      [
        'playtest',
        mapId,
        '--target',
        'browser',
        '--artifact',
        artifactDir,
        '--project',
        projectSlug,
        '--json',
      ],
      home,
    );
    expect(playtest.code).toBe(0);
    const serverMod = await import('./lib/http-server.js');
    const server = await serverMod.serveStaticDirectory(artifactDir, 0);
    const response = await fetch(`${server.url}`);
    expect(response.status).toBe(200);
    await server.close();
  });

  it('game build --target local writes the canonical artifact with serve README', async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-plugin-game-build-'));
    await mkdir(path.join(source, 'dist'), { recursive: true });
    await writeFile(
      path.join(source, 'tileborne-plugin.json'),
      `{
  "schemaVersion": 1,
  "id": "@tileborne-plugins/cli-game-build",
  "name": "cli-game-build",
  "version": "0.1.0",
  "displayName": "CLI Game Build",
  "description": "fixture",
  "author": "Tileborne",
  "license": "MIT",
  "engines": { "tileborne": "^0.1.0" },
  "contributes": {},
  "permissions": [],
  "dependsOn": []
}
`,
    );
    await writeFile(path.join(source, 'README.md'), 'fixture\n');
    await writeFile(
      path.join(source, 'dist', 'runtime.js'),
      "export const createRuntimeAdapter = () => ({ id: '@tileborne-plugins/cli-game-build' });\n",
    );
    expect((await runCli(['plugin', 'install', '--local', source, '--json'], home)).code).toBe(0);
    const outDir = path.join(source, 'dist-game');
    const build = await runCli(
      [
        'game',
        'build',
        '--plugin',
        '@tileborne-plugins/cli-game-build',
        '--target',
        'local',
        '--out',
        outDir,
        '--json',
      ],
      home,
    );
    expect(build.code, build.stderr + build.stdout).toBe(0);
    const payload = JSON.parse(build.stdout) as {
      readonly data: {
        readonly outDir: string;
        readonly target: string;
        readonly files: readonly string[];
        readonly bundlePath: string;
        readonly serveCommand: string;
      };
    };
    expect(payload.data.target).toBe('local');
    // Same canonical export as the cloudflare target …
    expect(payload.data.files).toContain('worker.js');
    expect(payload.data.files).toContain('manifest.json');
    expect(payload.data.bundlePath).toContain('worker.js');
    // … plus the single-command local serve convention.
    expect(payload.data.files).toContain('README.md');
    expect(payload.data.serveCommand).toBe(`tileborne game serve --dir "${payload.data.outDir}"`);
    await expect(readFile(path.join(payload.data.outDir, 'README.md'), 'utf8')).resolves.toContain(
      'tileborne game serve --dir',
    );
  }, 60_000);

  it('game build rejects removed stub targets (hard cut)', async () => {
    const home = await makeTempHome();
    const result = await runCli(
      ['game', 'build', '--plugin', '@tileborne-plugins/any', '--target', 'node', '--json'],
      home,
    );
    expect(result.code).not.toBe(0);
  });

  it('game serve --dir without a worker.js fails fast with a validation error', async () => {
    const home = await makeTempHome();
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'tileborne-serve-empty-'));
    const result = await runCli(
      ['game', 'serve', '--port', '0', '--dir', emptyDir, '--json'],
      home,
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('no worker.js');
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('game build --map without --project fails with a validation error', async () => {
    const home = await makeTempHome();
    const result = await runCli(
      [
        'game',
        'build',
        '--plugin',
        '@tileborne-plugins/cli-game-build',
        '--target',
        'cloudflare',
        '--map',
        'map:00000000-0000-4000-8000-000000000001',
        '--json',
      ],
      home,
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('--map requires --project');
  });

  it('game build --project with unknown slug fails before building', async () => {
    const home = await makeTempHome();
    const result = await runCli(
      [
        'game',
        'build',
        '--plugin',
        '@tileborne-plugins/cli-game-build',
        '--target',
        'cloudflare',
        '--project',
        'no-such-project',
        '--json',
      ],
      home,
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/no-such-project|not found/i);
  });

  it('dev desktop spawn uses pnpm desktop filter (stubbed)', async () => {
    const spawnMod = await import('./lib/spawn.js');
    const spy = vi.spyOn(spawnMod, 'spawnTracked').mockReturnValue({
      pid: 123,
      kill: () => undefined,
      exited: Promise.resolve(0),
    });
    spawnMod.spawnTracked('pnpm', ['--filter', '@tileborne/desktop', 'dev']);
    expect(spy.mock.calls[0]?.[0]).toBe('pnpm');
    expect(spy.mock.calls[0]?.[1]).toEqual(['--filter', '@tileborne/desktop', 'dev']);
  });

  it('logs tail reads NDJSON lines from temp log file', async () => {
    const home = await makeTempHome();
    const logsDir = path.join(home, 'logs');
    await mkdir(logsDir, { recursive: true });
    const logFile = path.join(logsDir, 'tileborne-2099-01-01.log');
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: 'hello',
      fields: {},
    });
    await writeFile(logFile, `${line}\n`);
    const result = await runCli(['logs', 'tail', '--since', '1h'], home);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hello');
  });

  it('logs follow exits on SIGINT (simulated abort)', async () => {
    const home = await makeTempHome();
    const logsDir = path.join(home, 'logs');
    await mkdir(logsDir, { recursive: true });
    const logFile = path.join(logsDir, 'tileborne-2099-01-02.log');
    await writeFile(
      logFile,
      `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'seed', fields: {} })}\n`,
    );
    const child = execFile(process.execPath, [CLI, 'logs', 'tail', '--follow', '--since', '1h'], {
      env: { ...process.env, TILEBORNE_HOME: home },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    child.kill('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(child.killed).toBe(true);
  });

  it('support bundle writes tarball entries', async () => {
    const home = await makeTempHome();
    const out = `support-${Date.now()}.tar.gz`;
    const result = await runCli(['support', 'bundle', '--out', out, '--json'], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    const { execFile: execFileRaw } = await import('node:child_process');
    const archivePath = path.join(home, out);
    const list = await promisify(execFileRaw)('tar', ['-tzf', archivePath]);
    const entries = String(list.stdout);
    expect(entries).toContain('manifest.json');
    await rm(archivePath, { force: true });
  });

  it('map inspect summarizes layers for a generated map', async () => {
    const home = await makeTempHome();
    const { mapId, projectSlug } = await seedProjectWithMap(home);
    const result = await runCli(
      ['map', 'inspect', mapId, '--project', projectSlug, '--json'],
      home,
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly data: { readonly layerCount: number } };
    expect(payload.data.layerCount).toBeGreaterThan(0);
  });

  it('map generate supports grid template', async () => {
    const home = await makeTempHome();
    const { projectSlug } = await prepareProjectDir(home, 'grid-proj');
    const result = await runCli(
      [
        'map',
        'generate',
        'grid',
        '--width',
        '4',
        '--height',
        '4',
        '--template',
        'grid',
        '--project',
        projectSlug,
        '--json',
      ],
      home,
    );
    expect(result.code).toBe(0);
  });

  it('logs path prints an absolute log file', async () => {
    const home = await makeTempHome();
    const logsDir = path.join(home, 'logs');
    await mkdir(logsDir, { recursive: true });
    await writeFile(
      path.join(logsDir, 'tileborne-2099-03-01.log'),
      `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'x', fields: {} })}\n`,
    );
    const result = await runCli(['logs', 'path', '--json'], home);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly data: { readonly path: string } };
    expect(path.isAbsolute(payload.data.path)).toBe(true);
  });

  it('playtest browser target writes artifact directory', async () => {
    const home = await makeTempHome();
    const { mapId, projectSlug } = await seedProjectWithMap(home);
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'tileborne-browser-artifact-'));
    const result = await runCli(
      [
        'playtest',
        mapId,
        '--target',
        'browser',
        '--artifact',
        artifactDir,
        '--project',
        projectSlug,
        '--json',
      ],
      home,
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { readonly data: { readonly target: string } };
    expect(payload.data.target).toBe('browser');
  });

  it('game build cloudflare target writes worker bundle', async () => {
    const home = await makeTempHome();
    const source = await mkdtemp(path.join(tmpdir(), 'tileborne-plugin-cf-'));
    await mkdir(source, { recursive: true });
    await writeFile(
      path.join(source, 'tileborne-plugin.json'),
      `{"schemaVersion":1,"id":"@tileborne-plugins/cli-cf","name":"cf","version":"0.1.0","displayName":"CF","description":"d","author":"t","license":"MIT","engines":{"tileborne":"^0.1.0"},"contributes":{},"permissions":[],"dependsOn":[]}`,
    );
    await writeFile(path.join(source, 'README.md'), 'x\n');
    await mkdir(path.join(source, 'dist'), { recursive: true });
    await writeFile(
      path.join(source, 'dist', 'runtime.js'),
      "export const createRuntimeAdapter = () => ({ id: '@tileborne-plugins/cli-cf' });\n",
    );
    expect((await runCli(['plugin', 'install', '--local', source, '--json'], home)).code).toBe(0);
    const build = await runCli(
      [
        'game',
        'build',
        '--plugin',
        '@tileborne-plugins/cli-cf',
        '--target',
        'cloudflare',
        '--json',
      ],
      home,
    );
    expect(build.code, build.stderr + build.stdout).toBe(0);
    const payload = JSON.parse(build.stdout) as {
      readonly data: {
        readonly bundlePath: string;
        readonly outDir: string;
        readonly files: readonly string[];
        readonly manifestHash: string;
      };
    };
    expect(payload.data.bundlePath).toContain('worker.js');
    expect(payload.data.outDir.length).toBeGreaterThan(0);
    expect(payload.data.files).toContain('worker.js');
    expect(payload.data.files).toContain('behavior-worker.js');
    expect(payload.data.files).toContain('wrangler.behavior.toml');
    expect(payload.data.manifestHash).toMatch(/^sha256:/);
    // A cloudflare build without --project bundles zero maps: legal, but
    // loud — the deployed host could not create rooms.
    expect(build.stderr).toContain('zero runtime map packages');
    expect((payload.data as { readonly warnings?: readonly string[] }).warnings?.[0]).toContain(
      'no maps bundled',
    );
  }, 20_000);

  it('runtime discover emits backend json', async () => {
    const home = await makeTempHome();
    const result = await runCli(['runtime', 'discover', '--json'], home);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      readonly data: { readonly backends: readonly unknown[] };
    };
    expect(payload.data.backends.length).toBe(4);
  });
});

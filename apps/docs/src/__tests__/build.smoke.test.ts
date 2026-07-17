import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const docsAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const readManifest = () => {
  const manifestPath = path.join(docsAppRoot, 'src/generated/page-manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw) as { pages: string[] };
};

describe('docs page manifest', () => {
  it('lists canonical pages', () => {
    const manifest = readManifest();
    expect(manifest.pages).toEqual(
      expect.arrayContaining([
        'index',
        'getting-started',
        'architecture',
        'gameplay-behaviors',
        'battle-royale/creator-guide',
        'plugins',
        'adrs',
      ]),
    );
  });
});

describe('docs build output', () => {
  it('includes canonical routes in dist/', () => {
    const distRoot = path.join(docsAppRoot, 'dist');
    const expectedPaths = [
      'index.html',
      'getting-started/index.html',
      'architecture/index.html',
      'gameplay-behaviors/index.html',
      'battle-royale/creator-guide/index.html',
      'plugins/index.html',
      'plugins/sdk/index.html',
      'reference/game-sdk/index.html',
      'adrs/index.html',
    ];

    for (const relativePath of expectedPaths) {
      const absolutePath = path.join(distRoot, relativePath);
      expect(fs.existsSync(absolutePath), `missing ${relativePath}`).toBe(true);
    }
  });

  it('publishes executable plugin/SDK examples without stale manifest or CLI contracts', () => {
    const read = (relativePath: string) =>
      fs.readFileSync(path.join(docsAppRoot, 'src/content/docs', relativePath), 'utf8');
    const plugins = read('plugins/index.md');
    const sdk = read('plugins/sdk/index.md');
    const behaviors = read('gameplay-behaviors/index.md');

    expect(plugins).toContain('"engines": { "tileborne":');
    expect(plugins).toContain('tileborne plugin install --local');
    expect(plugins).toContain('encodeURIComponent(id)');
    expect(plugins).not.toMatch(
      /"engineRange"|"contributions"|tileborne plugin add|tileborne plugin validate/u,
    );
    expect(sdk).toContain('export const createRuntimeAdapter');
    expect(sdk).toContain('CreateRuntimeAdapter<ExampleHost>');
    expect(sdk).toContain('plugin-api/examples/runtime-adapter.ts');
    expect(sdk).toContain('tileborne plugin verify');
    expect(sdk).not.toContain('export default {');
    expect(behaviors).toContain('/battle-royale/creator-guide/');
    expect(
      fs.existsSync(path.join(docsAppRoot, '../..', 'packages/game-sdk/examples/open-exit.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(docsAppRoot, '../..', 'packages/game-sdk/examples/plugin-event.ts')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(docsAppRoot, '../..', 'packages/plugin-battle-royale/src/runtime-adapter.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(docsAppRoot, '../..', 'packages/plugin-example-arena/src/runtime-adapter.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(docsAppRoot, '../..', 'packages/plugin-api/examples/runtime-adapter.ts'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(docsAppRoot, '../..', 'packages/plugin-api/examples/tileborne-plugin.json'),
      ),
    ).toBe(true);
  });
});

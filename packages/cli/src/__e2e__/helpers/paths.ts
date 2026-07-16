import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const cliEntrypoint = path.join(packageRoot, 'dist/main.js');
export const repoRoot = path.resolve(packageRoot, '../..');
export const emptyMapFixture = path.join(repoRoot, 'packages/core/src/__fixtures__/empty-map.json');
export const sampleAssetPackFixture = path.join(
  repoRoot,
  'packages/test-fixtures/fixtures/asset-packs/smoke-pack',
);

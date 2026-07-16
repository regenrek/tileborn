import { cp, mkdir } from 'node:fs/promises';

import { getFixturePath } from '@tileborne/test-fixtures';

/** Copy the canonical smoke plugin fixture into a writable directory for CLI install tests. */
export const writeSmokePluginFixture = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await cp(getFixturePath('plugins', 'smoke-fixture'), directory, { recursive: true });
};

/** Copy the canonical smoke asset pack fixture into a writable directory for CLI import tests. */
export const writeSmokeAssetPackFixture = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  await cp(getFixturePath('asset-packs', 'smoke-pack'), directory, { recursive: true });
};

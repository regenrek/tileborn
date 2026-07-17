import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const distPath = resolve('dist');
const buildOutputIt = existsSync(distPath) ? it : it.skip;

const collectMapFiles = async (directory: string): Promise<Array<string>> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return collectMapFiles(entryPath);
      }
      return entry.name.endsWith('.map') ? [entryPath] : [];
    }),
  );

  return nested.flat();
};

describe('build output source maps', () => {
  buildOutputIt('does not emit source maps for package consumers', async () => {
    await expect(collectMapFiles(distPath)).resolves.toEqual([]);
  });
});

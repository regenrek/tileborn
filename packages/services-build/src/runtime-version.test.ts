import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TILEBORNE_RUNTIME_VERSION } from '@tileborne/runtime';
import { describe, expect, it } from 'vitest';

describe('runtime version boundary', () => {
  it('keeps the build-time constant aligned with the runtime package', async () => {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../runtime/package.json',
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      readonly version?: string;
    };

    expect(TILEBORNE_RUNTIME_VERSION).toBe(packageJson.version);
  });
});

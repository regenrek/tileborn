import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const desktopPackage = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
) as { readonly scripts?: Readonly<Record<string, string>> };

describe('desktop clean-checkout dependency build order', () => {
  it('serializes the topological workspace build before bundling the game host', () => {
    const command = desktopPackage.scripts?.['predev:cdp'];

    expect(command).toBeDefined();
    expect(command).toContain(
      "pnpm -w -r --workspace-concurrency=1 --filter '@tileborne/desktop^...' --filter '!tileborne' build",
    );
    expect(command).toMatch(
      /--workspace-concurrency=1[\s\S]+@tileborne\/desktop\^\.\.\.[\s\S]+build[\s\S]+&& pnpm --filter @tileborne\/game-host build$/,
    );
  });
});

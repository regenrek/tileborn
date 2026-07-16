import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createReleaseGateMatrix, releaseGates } from './release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('canonical release gates', () => {
  it('publishes unique, executable gates to the CI matrix without copying commands', () => {
    const ids = releaseGates.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(releaseGates.every(({ commands }) => commands.length > 0)).toBe(true);
    expect(
      releaseGates.every(({ commands }) => commands.every((command) => command.length > 0)),
    ).toBe(true);

    expect(createReleaseGateMatrix().include).toEqual(
      releaseGates.map(({ id, label, required, xvfb }) => ({ id, label, required, xvfb })),
    );
  });

  it('makes root CI delegate to the canonical runner', () => {
    const rootPackage = JSON.parse(read('package.json')) as {
      readonly scripts: Record<string, string>;
    };

    expect(rootPackage.scripts.ci).toBe('pnpm release:gates');
    expect(rootPackage.scripts['release:gates']).toBe('node scripts/release-gates.mjs run-all');
    expect(rootPackage.scripts['release:gate']).toBe('node scripts/release-gates.mjs run');
    expect(rootPackage.scripts['release:gates:matrix']).toBe(
      'node scripts/release-gates.mjs matrix',
    );
  });

  it('makes GitHub Actions derive scheduling and execution from the same runner', () => {
    const workflow = read('.github/workflows/ci.yml');

    expect(workflow).toContain('run: pnpm release:gates:matrix');
    expect(workflow).toContain('matrix: ${{ fromJSON(needs.release-gate-plan.outputs.matrix) }}');
    expect(workflow).toContain('pnpm release:gate -- "${{ matrix.id }}"');

    for (const command of [
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test -- --run',
      'pnpm build',
      'pnpm test:boundaries',
      'pnpm test:cli-e2e',
      'pnpm test:desktop-smoke',
      'pnpm docs:build',
    ]) {
      expect(workflow).not.toContain(`run: ${command}`);
    }
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PlaytestArtifact } from '@tileborne/services-build';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runHeadlessPlaytest } from './playtest-headless.js';

describe('runHeadlessPlaytest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tileborne-headless-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs the registered plugins to completion and reports ticks', async () => {
    const artifact = {
      directory: dir,
      manifestPath: path.join(dir, 'playtest.json'),
      indexPath: path.join(dir, 'index.html'),
      manifest: { plugins: ['@tileborne-plugins/example'] },
    } as unknown as PlaytestArtifact;

    const result = await runHeadlessPlaytest(artifact, 0.2);

    expect(result.ticks).toBeGreaterThan(0);
    expect(result.hookSummary['@tileborne-plugins/example']).toBeGreaterThan(0);
  });
});

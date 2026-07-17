import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, toDiscoverSummary } from './types.js';
import { runtimeManifest } from './.generated/runtime-manifest.js';
import { bundledSamplePackId } from './.generated/bundled-assets.js';

describe('game-host types', () => {
  it('keeps protocol version aligned with runtime SSOT value', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('toDiscoverSummary strips file hashes from manifest', () => {
    const summary = toDiscoverSummary(runtimeManifest);
    expect(summary.plugin.id).toBe(runtimeManifest.plugin.id);
    expect(summary.assetPacks).toEqual([
      { id: bundledSamplePackId, version: runtimeManifest.assetPacks[0]?.version },
    ]);
    expect(summary.buildId).toBe(runtimeManifest.buildId);
    expect(Object.hasOwn(summary, 'workerFiles')).toBe(false);
  });
});

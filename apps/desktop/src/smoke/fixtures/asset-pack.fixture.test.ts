import { AssetPackManifest } from '@tileborne/asset-pipeline';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import fixture from './asset-pack/tileborne-asset-pack.json' with { type: 'json' };

describe('smoke asset-pack fixture', () => {
  it('matches AssetPackManifest branded ID contract', () => {
    const decoded = Schema.decodeUnknownSync(AssetPackManifest)(fixture);
    expect(decoded.id).toBe('pack:550e8400-e29b-41d4-a716-446655440001');
    expect(decoded.assets[0]?.id).toBe('asset:550e8400-e29b-41d4-a716-446655440000');
    expect(decoded.assets[0]?.hash).toBe(
      'sha256:4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6',
    );
  });
});

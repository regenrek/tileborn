import { AssetId, ContentHash, PackId } from '@tileborne/core';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { PackDeltaApplyError } from '../errors.js';
import { License } from '../license/license.js';
import { applyPackDelta, diffPacks } from './pack-delta.js';
import { indexPack } from './pack-index.js';
import { mergePacks } from './pack-merge.js';
import { AssetPackManifest, AssetPackManifestAsset, assetsFromManifest } from './pack-manifest.js';

const hash = (n: number): ContentHash =>
  `sha256:${n.toString(16).padStart(64, '0')}` as ContentHash;
const packId = (n: number): PackId =>
  `pack:550e8400-e29b-4${n.toString(16).padStart(3, '0')}-a716-446655440000` as PackId;
const assetId = (n: number): AssetId =>
  `asset:550e8400-e29b-4${n.toString(16).padStart(3, '0')}-a716-446655440000` as AssetId;

const cc0 = new License({
  spdxId: 'CC0-1.0',
  attribution: Option.none(),
  sourceUrl: Option.none(),
  notes: Option.none(),
});

const mit = new License({
  spdxId: 'MIT',
  attribution: Option.some('Example Artist'),
  sourceUrl: Option.some('https://example.invalid/mit'),
  sourcePath: 'fixtures/mit/source.png',
  modifications: 'Trimmed transparent border',
  notes: Option.none(),
  redistributable: true,
});

const asset = (id: AssetId, path: string, n: number, license = Option.none<License>()) =>
  new AssetPackManifestAsset({
    id,
    path,
    mime: 'image/png',
    size: n * 10,
    hash: hash(n),
    license,
  });

const manifest = (assets: readonly AssetPackManifestAsset[], version = '1.0.0') =>
  new AssetPackManifest({
    id: packId(1),
    name: 'Pack',
    version,
    license: cc0,
    assets: [...assets],
  });

describe('pack delta', () => {
  it('detects added files', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1)]);
    const after = manifest([asset(assetId(1), 'a.png', 1), asset(assetId(2), 'b.png', 2)]);

    expect(diffPacks(before, after).added.map((entry) => entry.path)).toEqual(['b.png']);
  });

  it('detects removed files', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1), asset(assetId(2), 'b.png', 2)]);
    const after = manifest([asset(assetId(1), 'a.png', 1)]);

    expect(diffPacks(before, after).removed.map((entry) => entry.path)).toEqual(['b.png']);
  });

  it('detects modified file content metadata', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1)]);
    const after = manifest([asset(assetId(1), 'a.png', 9)]);

    expect(diffPacks(before, after).modified.map((entry) => entry.id)).toEqual([assetId(1)]);
  });

  it('detects license changes separately', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1)]);
    const after = manifest([asset(assetId(1), 'a.png', 1, Option.some(mit))]);
    const delta = diffPacks(before, after);

    expect(delta.licenseChanged.map((entry) => entry.id)).toEqual([assetId(1)]);
    expect(delta.modified).toEqual([]);
  });

  it('detects provenance and redistribution metadata license changes', () => {
    const beforeLicense = new License({
      spdxId: 'CC0-1.0',
      attribution: Option.none(),
      sourceUrl: Option.none(),
      sourcePath: 'fixtures/source-a.png',
      modifications: 'Original fixture',
      notes: Option.none(),
      redistributable: true,
    });
    const afterLicense = new License({
      spdxId: 'CC0-1.0',
      attribution: Option.none(),
      sourceUrl: Option.none(),
      sourcePath: 'fixtures/source-b.png',
      modifications: 'Cropped for runtime atlas',
      notes: Option.none(),
      redistributable: false,
    });
    const before = manifest([asset(assetId(1), 'a.png', 1, Option.some(beforeLicense))]);
    const after = manifest([asset(assetId(1), 'a.png', 1, Option.some(afterLicense))]);
    const delta = diffPacks(before, after);

    expect(delta.licenseChanged.map((entry) => entry.id)).toEqual([assetId(1)]);
    expect(delta.licenseChanged[0]?.after).toMatchObject({
      sourcePath: 'fixtures/source-b.png',
      modifications: 'Cropped for runtime atlas',
      redistributable: false,
    });
    expect(delta.modified).toEqual([]);
  });

  it('applies a delta without mutating the original catalog', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1)]);
    const after = manifest([asset(assetId(1), 'a.png', 1), asset(assetId(2), 'b.png', 2)]);
    const catalog = mergePacks([indexPack(before, assetsFromManifest(before))]);

    const updated = applyPackDelta(catalog, diffPacks(before, after), packId(1));

    expect(catalog.assets.map((entry) => entry.path)).toEqual(['a.png']);
    expect(updated.assets.map((entry) => entry.path)).toEqual(['a.png', 'b.png']);
  });

  it('round-trips diff apply diff to empty', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1)]);
    const after = manifest([
      asset(assetId(1), 'a.png', 8, Option.some(mit)),
      asset(assetId(2), 'b.png', 2),
    ]);
    const updated = applyPackDelta(
      mergePacks([indexPack(before, assetsFromManifest(before))]),
      diffPacks(before, after),
      packId(1),
    );

    const empty = diffPacks(after, updated.packs[0]!.manifest);

    expect(empty.added).toEqual([]);
    expect(empty.removed).toEqual([]);
    expect(empty.modified).toEqual([]);
    expect(empty.licenseChanged).toEqual([]);
  });

  it('rejects deltas for missing packs', () => {
    const before = manifest([asset(assetId(1), 'a.png', 1)]);
    const after = manifest([asset(assetId(1), 'a.png', 2)]);

    expect(() => applyPackDelta(mergePacks([]), diffPacks(before, after), packId(1))).toThrow(
      PackDeltaApplyError,
    );
  });
});

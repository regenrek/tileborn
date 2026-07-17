import { AssetId, ContentHash, PackId } from '@tileborne/core';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { indexPack } from '../pack/pack-index.js';
import { mergePacks, PreferFirst, PreferLast, resolveConflicts } from '../pack/pack-merge.js';
import {
  AssetPackManifest,
  AssetPackManifestAsset,
  assetsFromManifest,
} from '../pack/pack-manifest.js';
import {
  formatLicenseReportMarkdown,
  formatLicenseReportPlain,
  summarizeLicenses,
} from './license-report.js';
import { License } from './license.js';

const hash = (n: number): ContentHash =>
  `sha256:${n.toString(16).padStart(64, '0')}` as ContentHash;
const packId = (n: number): PackId =>
  `pack:550e8400-e29b-4${n.toString(16).padStart(3, '0')}-a716-446655440000` as PackId;
const assetId = (n: number): AssetId =>
  `asset:550e8400-e29b-4${n.toString(16).padStart(3, '0')}-a716-446655440000` as AssetId;

const cc0 = new License({
  spdxId: 'CC0-1.0',
  attribution: Option.none(),
  sourceUrl: Option.some('https://example.invalid/cc0'),
  notes: Option.none(),
});

const mit = new License({
  spdxId: 'MIT',
  attribution: Option.some('Example Artist'),
  sourceUrl: Option.some('https://example.invalid/mit'),
  notes: Option.none(),
});

const apache = new License({
  spdxId: 'Apache-2.0',
  attribution: Option.some('Later Artist'),
  sourceUrl: Option.some('https://example.invalid/apache'),
  notes: Option.none(),
});

const asset = (n: number, license = Option.none<License>()) =>
  new AssetPackManifestAsset({
    id: assetId(n),
    path: `asset-${n}.png`,
    mime: 'image/png',
    size: n * 10,
    hash: hash(n),
    license,
  });

const manifest = (id: PackId, assets: readonly AssetPackManifestAsset[]) =>
  new AssetPackManifest({
    id,
    name: 'Pack',
    version: '1.0.0',
    license: cc0,
    assets: [...assets],
  });

describe('license report', () => {
  it('aggregates duplicate SPDX ids for a pack', () => {
    const pack = manifest(packId(1), [asset(1), asset(2), asset(3, Option.some(mit))]);

    expect(
      summarizeLicenses(indexPack(pack, assetsFromManifest(pack))).entries.map((entry) => [
        entry.spdxId,
        entry.count,
      ]),
    ).toEqual([
      ['CC0-1.0', 2],
      ['MIT', 1],
    ]);
  });

  it('sorts report entries by count descending', () => {
    const pack = manifest(packId(1), [asset(1, Option.some(mit)), asset(2), asset(3), asset(4)]);
    const report = summarizeLicenses(indexPack(pack, assetsFromManifest(pack)));

    expect(report.entries[0]?.spdxId).toBe('CC0-1.0');
    expect(report.entries[0]?.count).toBe(3);
  });

  it('aggregates across merged catalogs', () => {
    const first = manifest(packId(1), [asset(1), asset(2, Option.some(mit))]);
    const second = manifest(packId(2), [asset(3, Option.some(mit))]);
    const report = summarizeLicenses(
      mergePacks([
        indexPack(first, assetsFromManifest(first)),
        indexPack(second, assetsFromManifest(second)),
      ]),
    );

    expect(report.entries.map((entry) => [entry.spdxId, entry.count])).toEqual([
      ['MIT', 2],
      ['CC0-1.0', 1],
    ]);
  });

  it('attributes resolved collisions to the prefer-first pack license', () => {
    const first = manifest(packId(1), [asset(1)]);
    const second = new AssetPackManifest({
      ...manifest(packId(2), [asset(1)]),
      license: apache,
    });
    const report = summarizeLicenses(
      resolveConflicts(
        mergePacks([
          indexPack(first, assetsFromManifest(first)),
          indexPack(second, assetsFromManifest(second)),
        ]),
        new PreferFirst({}),
      ),
    );

    expect(report.entries).toEqual([
      {
        spdxId: 'CC0-1.0',
        count: 1,
        attribution: [],
        sourceUrls: ['https://example.invalid/cc0'],
      },
    ]);
  });

  it('attributes resolved collisions to the prefer-last pack license', () => {
    const first = manifest(packId(1), [asset(1)]);
    const second = new AssetPackManifest({
      ...manifest(packId(2), [asset(1)]),
      license: apache,
    });
    const report = summarizeLicenses(
      resolveConflicts(
        mergePacks([
          indexPack(first, assetsFromManifest(first)),
          indexPack(second, assetsFromManifest(second)),
        ]),
        new PreferLast({}),
      ),
    );

    expect(report.entries).toEqual([
      {
        spdxId: 'Apache-2.0',
        count: 1,
        attribution: ['Later Artist'],
        sourceUrls: ['https://example.invalid/apache'],
      },
    ]);
  });

  it('formats plain text reports', () => {
    const pack = manifest(packId(1), [asset(1)]);

    expect(
      formatLicenseReportPlain(summarizeLicenses(indexPack(pack, assetsFromManifest(pack)))),
    ).toContain('CC0-1.0: 1');
  });

  it('formats markdown with attribution links', () => {
    const pack = manifest(packId(1), [asset(1, Option.some(mit))]);
    const markdown = formatLicenseReportMarkdown(
      summarizeLicenses(indexPack(pack, assetsFromManifest(pack))),
    );

    expect(markdown).toContain('## MIT');
    expect(markdown).toContain('- Example Artist');
    expect(markdown).toContain('[https://example.invalid/mit](https://example.invalid/mit)');
  });
});

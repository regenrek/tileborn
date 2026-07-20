import { AssetId, PackId, canonicalJson } from '@tileborne/core';
import { Option, Schema } from 'effect';

import { PackDeltaApplyError } from '../errors.js';
import { License } from '../license/license.js';
import { indexPack } from './pack-index.js';
import { mergePacks, type MergedCatalog } from './pack-merge.js';
import { AssetPackManifestAsset, AssetPackManifest, assetsFromManifest } from './pack-manifest.js';

export class ModifiedAsset extends Schema.TaggedClass<ModifiedAsset>()('modified', {
  id: AssetId,
  before: AssetPackManifestAsset,
  after: AssetPackManifestAsset,
}) {}

export class LicenseChangedAsset extends Schema.TaggedClass<LicenseChangedAsset>()(
  'licenseChanged',
  {
    id: AssetId,
    before: License,
    after: License,
  },
) {}

export class PackDelta extends Schema.Class<PackDelta>('PackDelta')({
  from: AssetPackManifest,
  to: AssetPackManifest,
  added: Schema.Array(AssetPackManifestAsset),
  removed: Schema.Array(AssetPackManifestAsset),
  modified: Schema.Array(ModifiedAsset),
  licenseChanged: Schema.Array(LicenseChangedAsset),
}) {}

const optionOr = <A>(value: Option.Option<A>, fallback: A): A =>
  Option.match(value, {
    onNone: () => fallback,
    onSome: (inner) => inner,
  });

const licenseFor = (manifest: AssetPackManifest, file: AssetPackManifestAsset): License =>
  optionOr(file.license, manifest.license);

const optionOrNull = <A>(value: Option.Option<A>): A | null =>
  Option.match(value, {
    onNone: () => null,
    onSome: (inner) => inner,
  });

const licenseKey = (license: License): string =>
  canonicalJson({
    attribution: optionOrNull(license.attribution),
    modifications: license.modifications ?? null,
    notes: optionOrNull(license.notes),
    redistributable: license.redistributable ?? null,
    sourcePath: license.sourcePath ?? null,
    sourceUrl: optionOrNull(license.sourceUrl),
    spdxId: license.spdxId,
  });

const fileContentKey = (file: AssetPackManifestAsset): string =>
  canonicalJson({
    hash: file.hash,
    mime: file.mime,
    path: file.path,
    size: file.size,
  });

export const diffPacks = (a: AssetPackManifest, b: AssetPackManifest): PackDelta => {
  const aFiles = new Map(a.assets.map((file) => [file.id, file]));
  const bFiles = new Map(b.assets.map((file) => [file.id, file]));
  const added: AssetPackManifestAsset[] = [];
  const removed: AssetPackManifestAsset[] = [];
  const modified: ModifiedAsset[] = [];
  const licenseChanged: LicenseChangedAsset[] = [];

  for (const [id, after] of bFiles.entries()) {
    const before = aFiles.get(id);
    if (before === undefined) {
      added.push(after);
      continue;
    }

    if (fileContentKey(before) !== fileContentKey(after)) {
      modified.push(new ModifiedAsset({ id, before, after }));
    }

    const beforeLicense = licenseFor(a, before);
    const afterLicense = licenseFor(b, after);
    if (licenseKey(beforeLicense) !== licenseKey(afterLicense)) {
      licenseChanged.push(
        new LicenseChangedAsset({ id, before: beforeLicense, after: afterLicense }),
      );
    }
  }

  for (const [id, before] of aFiles.entries()) {
    if (!bFiles.has(id)) {
      removed.push(before);
    }
  }

  const byPath = (left: AssetPackManifestAsset, right: AssetPackManifestAsset) =>
    left.path.localeCompare(right.path);

  return new PackDelta({
    from: a,
    to: b,
    added: added.sort(byPath),
    removed: removed.sort(byPath),
    modified: modified.sort((left, right) => left.after.path.localeCompare(right.after.path)),
    licenseChanged: licenseChanged.sort((left, right) => left.id.localeCompare(right.id)),
  });
};

export const applyPackDelta = (
  catalog: MergedCatalog,
  delta: PackDelta,
  packId: PackId,
): MergedCatalog => {
  if (delta.from.id !== packId || delta.to.id !== packId) {
    throw new PackDeltaApplyError({
      packId,
      message: 'delta manifests do not match requested pack id',
    });
  }

  const packExists = catalog.packs.some((pack) => pack.packId === packId);
  if (!packExists) {
    throw new PackDeltaApplyError({
      packId,
      message: 'catalog does not contain the pack to update',
    });
  }

  const updatedPack = indexPack(delta.to, assetsFromManifest(delta.to));
  const packs = catalog.packs.map((pack) => (pack.packId === packId ? updatedPack : pack));
  return mergePacks(packs);
};

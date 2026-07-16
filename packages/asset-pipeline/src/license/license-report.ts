import { Option, Schema } from 'effect';

import { licenseForAsset, PackIndex } from '../pack/pack-index.js';
import { MergedCatalog } from '../pack/pack-merge.js';

export interface LicenseReportEntry {
  readonly spdxId: string;
  readonly count: number;
  readonly attribution: readonly string[];
  readonly sourceUrls: readonly string[];
}

export interface LicenseReport {
  readonly entries: readonly LicenseReportEntry[];
}

const isMergedCatalog = Schema.is(MergedCatalog);
const isPackIndex = Schema.is(PackIndex);

const optionValues = (value: Option.Option<string>): readonly string[] =>
  Option.match(value, {
    onNone: () => [],
    onSome: (inner) => [inner],
  });

export const summarizeLicenses = (input: PackIndex | MergedCatalog): LicenseReport => {
  const mergedCatalog = isMergedCatalog(input) ? input : undefined;
  const packIndex = mergedCatalog === undefined && isPackIndex(input) ? input : undefined;
  const assets = input.assets;
  const byLicense = new Map<
    string,
    { count: number; attribution: Set<string>; sourceUrls: Set<string> }
  >();

  for (const asset of assets) {
    const owningPack =
      mergedCatalog !== undefined
        ? mergedCatalog.packs.find(
            (pack) => pack.packId === mergedCatalog.entriesByAssetId.get(asset.id)?.packId,
          )
        : packIndex;
    const license = owningPack === undefined ? undefined : licenseForAsset(owningPack, asset);
    if (license === undefined) {
      continue;
    }
    const spdxId = license.spdxId;
    const entry = byLicense.get(spdxId) ?? {
      count: 0,
      attribution: new Set<string>(),
      sourceUrls: new Set<string>(),
    };

    entry.count += 1;
    for (const attribution of optionValues(license.attribution)) {
      entry.attribution.add(attribution);
    }
    for (const sourceUrl of optionValues(license.sourceUrl)) {
      entry.sourceUrls.add(sourceUrl);
    }
    byLicense.set(spdxId, entry);
  }

  return {
    entries: [...byLicense.entries()]
      .map(([spdxId, entry]) => ({
        spdxId,
        count: entry.count,
        attribution: [...entry.attribution].sort((left, right) => left.localeCompare(right)),
        sourceUrls: [...entry.sourceUrls].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => {
        const countOrder = right.count - left.count;
        return countOrder === 0 ? left.spdxId.localeCompare(right.spdxId) : countOrder;
      }),
  };
};

export const formatLicenseReportPlain = (report: LicenseReport): string =>
  report.entries
    .map((entry) => {
      const lines = [`${entry.spdxId}: ${entry.count}`];
      if (entry.attribution.length > 0) {
        lines.push(`  Attribution: ${entry.attribution.join('; ')}`);
      }
      if (entry.sourceUrls.length > 0) {
        lines.push(`  Sources: ${entry.sourceUrls.join(', ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

export const formatLicenseReportMarkdown = (report: LicenseReport): string => {
  const lines = ['# License Report', ''];

  for (const entry of report.entries) {
    lines.push(`## ${entry.spdxId}`, '', `Asset count: ${entry.count}`, '');
    if (entry.attribution.length > 0) {
      lines.push('Attribution:');
      for (const attribution of entry.attribution) {
        lines.push(`- ${attribution}`);
      }
      lines.push('');
    }
    if (entry.sourceUrls.length > 0) {
      lines.push('Sources:');
      for (const sourceUrl of entry.sourceUrls) {
        lines.push(`- [${sourceUrl}](${sourceUrl})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
};

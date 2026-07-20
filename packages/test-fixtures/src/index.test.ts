import path from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FIXTURE_CATEGORIES,
  CREATOR_PERFORMANCE_FLOW_IDS,
  creatorPerformanceFlowPasses,
  creatorPerformanceMetricPasses,
  decodeCreatorPerformanceContract,
  fixtureExists,
  getFixturePath,
  getSampleAssetPackPath,
  listFixtures,
  loadCreatorPerformanceContract,
  SAMPLE_ASSET_PACK_DIR,
} from './index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const binaryExtensions = new Set([
  '.flac',
  '.icns',
  '.ico',
  '.jpg',
  '.jpeg',
  '.mp3',
  '.ogg',
  '.otf',
  '.png',
  '.svg',
  '.ttf',
  '.wav',
  '.webp',
  '.woff',
  '.woff2',
]);

const SHIPPED_SAMPLE_BINARY_ROOTS = [
  'apps/desktop/assets',
  'apps/desktop/public/tileborn-app-icon.png',
  'apps/desktop/src/smoke/fixtures/asset-pack',
  'packages/plugin-battle-royale/assets/core',
  'packages/test-fixtures/fixtures/asset-packs',
  'packages/test-fixtures/fixtures/maps/tiled-image-collection',
  'packages/test-fixtures/fixtures/tiled-sources/compat-hardening',
] as const;

const collectBinaryFiles = (root: string): readonly string[] => {
  const absolute = path.join(repoRoot, root);
  if (statSync(absolute).isFile()) {
    return binaryExtensions.has(path.extname(root).toLowerCase()) ? [root] : [];
  }
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return collectBinaryFiles(relative);
    }
    return binaryExtensions.has(path.extname(entry.name).toLowerCase()) ? [relative] : [];
  });
};

const inventoryCoversPath = (inventory: string, relativePath: string): boolean => {
  const normalized = relativePath.split(path.sep).join('/');
  const segments = normalized.split('/');
  const prefixes = segments.map((_segment, index) => `${segments.slice(0, index + 1).join('/')}/`);
  return (
    inventory.includes(`\`${normalized}\``) ||
    prefixes.some((prefix) => inventory.includes(`\`${prefix}\``))
  );
};

const mutableRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected mutable record');
  }
  return value as Record<string, unknown>;
};

const mutableArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('expected mutable array');
  return value;
};

const mutableFlow = (budgets: Record<string, unknown>, index: number): Record<string, unknown> =>
  mutableRecord(mutableArray(budgets.flows)[index]);

const mutableMetric = (
  budgets: Record<string, unknown>,
  flowIndex: number,
  metricIndex: number,
): Record<string, unknown> =>
  mutableRecord(mutableArray(mutableFlow(budgets, flowIndex).metrics)[metricIndex]);

describe('@tileborne/test-fixtures', () => {
  it('lists fixtures in every category', () => {
    for (const category of FIXTURE_CATEGORIES) {
      const entries = listFixtures(category);
      expect(entries.length).toBeGreaterThan(0);
    }
  });

  it('resolves smoke plugin and asset pack paths', () => {
    expect(getFixturePath('plugins', 'smoke-fixture', 'tileborne-plugin.json')).toContain(
      'tileborne-plugin.json',
    );
    expect(getFixturePath('asset-packs', 'smoke-pack', 'tileborne-asset-pack.json')).toContain(
      'tileborne-asset-pack.json',
    );
  });

  it('inventories every shipped/sample binary asset root', () => {
    const inventory = readFileSync(getFixturePath('ASSET_INVENTORY.md'), 'utf8');
    const missing = SHIPPED_SAMPLE_BINARY_ROOTS.flatMap((root) => collectBinaryFiles(root)).filter(
      (relativePath) => !inventoryCoversPath(inventory, relativePath),
    );

    expect(missing).toEqual([]);
  });

  it('lists and resolves the sample asset pack fixture', () => {
    expect(listFixtures('asset-packs')).toContain(SAMPLE_ASSET_PACK_DIR);
    expect(getSampleAssetPackPath()).toContain(path.join('asset-packs', SAMPLE_ASSET_PACK_DIR));
  });

  it('ships the complete project schema-compatibility matrix', () => {
    expect(listFixtures('projects')).toContain('schema-compatibility');
    for (const fixture of ['legacy-v0', 'current-v1', 'future-v2', 'invalid-version', 'corrupt']) {
      expect(
        fixtureExists('projects', 'schema-compatibility', fixture, 'project.json'),
        fixture,
      ).toBe(true);
    }
    expect(fixtureExists('projects', 'schema-compatibility', 'PROVENANCE.md')).toBe(true);
    for (const fixture of [
      'legacy-catalog.json',
      'current-v1.json',
      'future-v2.json',
      'corrupt.json',
    ]) {
      expect(
        fixtureExists('projects', 'schema-compatibility', 'project-content', fixture),
        fixture,
      ).toBe(true);
    }
  });

  it('ships the complete persisted-map schema-compatibility matrix', () => {
    expect(listFixtures('maps')).toContain('schema-compatibility');
    for (const fixture of ['legacy-shape', 'current-v1', 'future-v2', 'corrupt']) {
      expect(fixtureExists('maps', 'schema-compatibility', fixture, 'map.json'), fixture).toBe(
        true,
      );
    }
    expect(fixtureExists('maps', 'schema-compatibility', 'PROVENANCE.md')).toBe(true);
  });

  it('ships one versioned creator performance fixture and deterministic budget contract', () => {
    expect(listFixtures('performance')).toContain('creator-v1');
    for (const file of ['fixture.json', 'budgets.json', 'PROVENANCE.md']) {
      expect(fixtureExists('performance', 'creator-v1', file), file).toBe(true);
    }

    const { fixture, budgets } = loadCreatorPerformanceContract();
    expect(fixture).toMatchObject({
      schemaVersion: 1,
      id: 'creator-performance-v1',
      generator: {
        algorithm: 'tileborne-creator-performance-v1',
        ordering: 'lexicographic-index',
      },
    });
    expect(budgets.fixtureId).toBe(fixture.id);
    expect(budgets.measurementPolicy.deterministicUnitsOnly).toBe(true);
    expect(budgets.measurementPolicy.ciEnforcement).toBe(
      'required-release-gate:creator-performance',
    );
    expect(budgets.measurementPolicy.nativeTimingCalibration).toBe(
      'advisory-release-gate:creator-performance-native',
    );
  });

  it('fixes the v1 large-project scale and derived totals without materializing 2,000 files', () => {
    const { project } = loadCreatorPerformanceContract().fixture;

    expect(project.assets.assetCount).toBeGreaterThanOrEqual(2_000);
    expect(project.assets.workingPaletteItems).toBe(project.assets.assetCount);
    expect(project.behaviors.visualCount + project.behaviors.typescriptCount).toBe(
      project.behaviors.count,
    );
    expect(project.behaviors.totalReferences).toBe(
      project.behaviors.count * project.behaviors.referencesPerBehavior,
    );
    expect(project.validation.validVariantFaults).toBe(0);
    expect(project.validation.invalidVariantFaults).toBeGreaterThan(0);
    expect(new Set(project.validation.faultKinds).size).toBe(project.validation.faultKinds.length);
  });

  it('defines an unambiguous stable metric budget for every required creator flow', () => {
    const { budgets } = loadCreatorPerformanceContract();
    const flowIds = budgets.flows.map(({ id }) => id);

    expect(flowIds).toEqual(CREATOR_PERFORMANCE_FLOW_IDS);
    expect(new Set(flowIds).size).toBe(flowIds.length);

    for (const flow of budgets.flows) {
      expect(flow.description.length, flow.id).toBeGreaterThan(0);
      expect(flow.metrics.length, flow.id).toBeGreaterThan(0);
      const metricIds = flow.metrics.map(({ id }) => id);
      expect(new Set(metricIds).size, flow.id).toBe(metricIds.length);
      for (const metric of flow.metrics) {
        expect(['bytes', 'count', 'operations'], `${flow.id}.${metric.id}`).toContain(metric.unit);
        expect(['exact', 'max', 'min'], `${flow.id}.${metric.id}`).toContain(metric.limit);
        expect(Number.isSafeInteger(metric.value), `${flow.id}.${metric.id}`).toBe(true);
        expect(metric.value, `${flow.id}.${metric.id}`).toBeGreaterThanOrEqual(0);
        expect(metric.rationale.length, `${flow.id}.${metric.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('derives corpus-sensitive budgets from the committed fixture instead of hidden data', () => {
    const { fixture, budgets } = loadCreatorPerformanceContract();
    const metric = (flowId: (typeof CREATOR_PERFORMANCE_FLOW_IDS)[number], metricId: string) => {
      const flow = budgets.flows.find(({ id }) => id === flowId);
      const result = flow?.metrics.find(({ id }) => id === metricId);
      expect(result, `${flowId}.${metricId}`).toBeDefined();
      return result!.value;
    };

    expect(metric('asset-library-2000', 'fixture-assets')).toBe(fixture.project.assets.assetCount);
    expect(metric('large-behaviors-references', 'fixture-behaviors')).toBe(
      fixture.project.behaviors.count,
    );
    expect(metric('large-behaviors-references', 'fixture-references')).toBe(
      fixture.project.behaviors.totalReferences,
    );
    expect(metric('validation', 'invalid-variant-faults')).toBe(
      fixture.project.validation.invalidVariantFaults,
    );
    expect(metric('playtest-start', 'source-behavior-bytes')).toBe(
      fixture.project.behaviors.count * fixture.project.behaviors.sourceBytesPerBehavior,
    );
    expect(metric('package', 'asset-payload-input-bytes')).toBe(
      fixture.project.assets.assetCount * fixture.project.assets.payloadBytesPerAsset,
    );
    expect(metric('validation', 'fixture-validation-records')).toBe(
      1 +
        fixture.project.maps.count +
        fixture.project.maps.count * fixture.project.maps.objectsPerMap +
        fixture.project.assets.assetCount +
        fixture.project.behaviors.count +
        fixture.project.behaviors.totalReferences,
    );
    expect(metric('package', 'runtime-map-packages')).toBe(fixture.project.maps.count);
    expect(metric('package', 'input-assets')).toBe(fixture.project.assets.assetCount);
    expect(metric('package', 'input-behavior-modules')).toBe(fixture.project.behaviors.count);
    expect(metric('ship', 'runtime-map-packages')).toBe(fixture.project.maps.count);
  });

  it('rejects unknown fields and every noncanonical v1 fixture or budget mutation', () => {
    const contract = loadCreatorPerformanceContract();
    const cases: readonly [
      label: string,
      mutate: (fixture: Record<string, unknown>, budgets: Record<string, unknown>) => void,
    ][] = [
      ['unknown fixture root key', (fixture) => void (fixture.unknown = true)],
      [
        'unknown generator key',
        (fixture) => void (mutableRecord(fixture.generator).unknown = true),
      ],
      ['unknown project key', (fixture) => void (mutableRecord(fixture.project).unknown = true)],
      [
        'unknown maps key',
        (fixture) => void (mutableRecord(mutableRecord(fixture.project).maps).unknown = true),
      ],
      [
        'unknown assets key',
        (fixture) => void (mutableRecord(mutableRecord(fixture.project).assets).unknown = true),
      ],
      [
        'unknown behaviors key',
        (fixture) => void (mutableRecord(mutableRecord(fixture.project).behaviors).unknown = true),
      ],
      [
        'unknown validation key',
        (fixture) => void (mutableRecord(mutableRecord(fixture.project).validation).unknown = true),
      ],
      ['wrong fixture version', (fixture) => void (fixture.schemaVersion = 2)],
      [
        'malformed nested fixture value',
        (fixture) => void (mutableRecord(mutableRecord(fixture.project).assets).assetCount = 2_047),
      ],
      [
        'broken derived reference total',
        (fixture) =>
          void (mutableRecord(mutableRecord(fixture.project).behaviors).totalReferences = 8_191),
      ],
      [
        'reordered fault kinds',
        (fixture) =>
          void mutableArray(
            mutableRecord(mutableRecord(fixture.project).validation).faultKinds,
          ).reverse(),
      ],
      ['unknown budget root key', (_fixture, budgets) => void (budgets.unknown = true)],
      ['wrong budget version', (_fixture, budgets) => void (budgets.schemaVersion = 2)],
      ['wrong budget id', (_fixture, budgets) => void (budgets.id = 'other')],
      [
        'unknown policy key',
        (_fixture, budgets) => void (mutableRecord(budgets.measurementPolicy).unknown = true),
      ],
      [
        'changed policy',
        (_fixture, budgets) =>
          void (mutableRecord(budgets.measurementPolicy).ciEnforcement = 'now'),
      ],
      ['unknown flow key', (_fixture, budgets) => void (mutableFlow(budgets, 0).unknown = true)],
      ['omitted flow', (_fixture, budgets) => void mutableArray(budgets.flows).pop()],
      ['reordered flows', (_fixture, budgets) => void mutableArray(budgets.flows).reverse()],
      [
        'unknown metric key',
        (_fixture, budgets) => void (mutableMetric(budgets, 0, 0).unknown = true),
      ],
      [
        'unknown metric id',
        (_fixture, budgets) => void (mutableMetric(budgets, 0, 0).id = 'unknown-metric'),
      ],
      [
        'duplicate metric id',
        (_fixture, budgets) =>
          void (mutableMetric(budgets, 0, 1).id = mutableMetric(budgets, 0, 0).id),
      ],
      [
        'missing metric',
        (_fixture, budgets) => void mutableArray(mutableFlow(budgets, 0).metrics).pop(),
      ],
      [
        'reordered metrics',
        (_fixture, budgets) => void mutableArray(mutableFlow(budgets, 0).metrics).reverse(),
      ],
      [
        'changed metric unit',
        (_fixture, budgets) => void (mutableMetric(budgets, 0, 0).unit = 'bytes'),
      ],
      [
        'changed metric limit',
        (_fixture, budgets) => void (mutableMetric(budgets, 0, 0).limit = 'exact'),
      ],
      [
        'changed metric value',
        (_fixture, budgets) => void (mutableMetric(budgets, 0, 0).value = 63),
      ],
      [
        'empty metric rationale',
        (_fixture, budgets) => void (mutableMetric(budgets, 0, 0).rationale = ''),
      ],
    ];

    for (const [label, mutate] of cases) {
      const fixture = mutableRecord(structuredClone(contract.fixture));
      const budgets = mutableRecord(structuredClone(contract.budgets));
      mutate(fixture, budgets);
      expect(() => decodeCreatorPerformanceContract(fixture, budgets), label).toThrow(
        /Invalid creator performance contract/,
      );
    }
  });

  it('fails exact workload under-processing while keeping max metrics as ceilings', () => {
    const { budgets } = loadCreatorPerformanceContract();
    const findMetric = (flowId: string, metricId: string) => {
      const metric = budgets.flows
        .find(({ id }) => id === flowId)
        ?.metrics.find(({ id }) => id === metricId);
      expect(metric, `${flowId}.${metricId}`).toBeDefined();
      return metric!;
    };

    for (const [flowId, metricId] of [
      ['asset-library-2000', 'fixture-assets'],
      ['large-behaviors-references', 'fixture-references'],
      ['validation', 'fixture-validation-records'],
      ['validation', 'diagnostics-returned'],
      ['playtest-start', 'compiled-behavior-modules'],
      ['playtest-start', 'source-behavior-bytes'],
      ['package', 'asset-payload-input-bytes'],
    ] as const) {
      const metric = findMetric(flowId, metricId);
      expect(metric.limit, `${flowId}.${metricId}`).toBe('exact');
      expect(creatorPerformanceMetricPasses(metric, metric.value)).toBe(true);
      expect(creatorPerformanceMetricPasses(metric, metric.value - 1)).toBe(false);
    }

    const outputCeiling = findMetric('package', 'package-files');
    expect(outputCeiling.limit).toBe('max');
    expect(creatorPerformanceMetricPasses(outputCeiling, outputCeiling.value - 1)).toBe(true);
    expect(creatorPerformanceMetricPasses(outputCeiling, outputCeiling.value + 1)).toBe(false);
    expect(creatorPerformanceMetricPasses(outputCeiling, Number.NaN)).toBe(false);
  });

  it('requires all 64 validation diagnostics and rejects a whole-flow no-op receipt', () => {
    const validation = loadCreatorPerformanceContract().budgets.flows.find(
      ({ id }) => id === 'validation',
    );
    expect(validation).toBeDefined();
    const diagnostics = validation!.metrics.find(({ id }) => id === 'diagnostics-returned');
    const inspected = validation!.metrics.find(({ id }) => id === 'records-inspected');
    expect(diagnostics).toMatchObject({ limit: 'exact', value: 64 });
    expect(inspected).toMatchObject({ limit: 'max', value: 16_000 });

    expect(creatorPerformanceMetricPasses(diagnostics!, 0)).toBe(false);
    expect(creatorPerformanceMetricPasses(diagnostics!, 63)).toBe(false);
    expect(creatorPerformanceMetricPasses(diagnostics!, 64)).toBe(true);
    expect(creatorPerformanceMetricPasses(diagnostics!, 65)).toBe(false);
    expect(creatorPerformanceMetricPasses(inspected!, 16_001)).toBe(false);

    const conformingReceipt = Object.fromEntries(
      validation!.metrics.map((metric) => [metric.id, metric.limit === 'exact' ? metric.value : 0]),
    );
    expect(creatorPerformanceFlowPasses(validation!, conformingReceipt)).toBe(true);

    const noOpReceipt = {
      ...conformingReceipt,
      'diagnostics-returned': 0,
      'records-inspected': 0,
    };
    expect(creatorPerformanceFlowPasses(validation!, noOpReceipt)).toBe(false);
    expect(
      creatorPerformanceFlowPasses(validation!, {
        ...conformingReceipt,
        unexpected: 1,
      }),
    ).toBe(false);
    const missingResultReceipt = { ...conformingReceipt };
    delete missingResultReceipt['diagnostics-returned'];
    expect(creatorPerformanceFlowPasses(validation!, missingResultReceipt)).toBe(false);
  });

  it('pins every flow metric id, unit, limit, and value as immutable v1 semantics', () => {
    const contract = loadCreatorPerformanceContract();
    const expectRejectedMutation = (
      flowIndex: number,
      metricIndex: number,
      field: 'id' | 'unit' | 'limit' | 'value',
      value: unknown,
    ) => {
      const budgets = mutableRecord(structuredClone(contract.budgets));
      mutableMetric(budgets, flowIndex, metricIndex)[field] = value;
      expect(() => decodeCreatorPerformanceContract(contract.fixture, budgets)).toThrow(
        /Invalid creator performance contract/,
      );
    };

    contract.budgets.flows.forEach((flow, flowIndex) => {
      flow.metrics.forEach((metric, metricIndex) => {
        expectRejectedMutation(flowIndex, metricIndex, 'id', `${metric.id}-changed`);
        expectRejectedMutation(
          flowIndex,
          metricIndex,
          'unit',
          metric.unit === 'count' ? 'bytes' : 'count',
        );
        expectRejectedMutation(
          flowIndex,
          metricIndex,
          'limit',
          metric.limit === 'exact' ? 'max' : 'exact',
        );
        expectRejectedMutation(flowIndex, metricIndex, 'value', metric.value + 1);
      });

      const missingBudget = mutableRecord(structuredClone(contract.budgets));
      mutableArray(mutableFlow(missingBudget, flowIndex).metrics).pop();
      expect(() => decodeCreatorPerformanceContract(contract.fixture, missingBudget)).toThrow(
        /Invalid creator performance contract/,
      );

      const duplicateBudget = mutableRecord(structuredClone(contract.budgets));
      const metrics = mutableArray(mutableFlow(duplicateBudget, flowIndex).metrics);
      mutableRecord(metrics[1]).id = mutableRecord(metrics[0]).id;
      expect(() => decodeCreatorPerformanceContract(contract.fixture, duplicateBudget)).toThrow(
        /Invalid creator performance contract/,
      );
    });
  });
});

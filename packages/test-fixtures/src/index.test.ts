import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FIXTURE_CATEGORIES,
  CREATOR_PERFORMANCE_FLOW_IDS,
  decodeCreatorPerformanceContract,
  fixtureExists,
  getFixturePath,
  getSampleAssetPackPath,
  listFixtures,
  loadCreatorPerformanceContract,
  SAMPLE_ASSET_PACK_DIR,
} from './index.js';

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
    expect(budgets.measurementPolicy.ciEnforcement).toContain(
      'i-enforce-stable-count-size-budget-3518',
    );
    expect(budgets.measurementPolicy.nativeTimingCalibration).toContain(
      'i-enforce-stable-count-size-budget-3518',
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

    expect(fixture.project.assets.assetCount).toBeGreaterThanOrEqual(
      metric('asset-library-2000', 'fixture-assets'),
    );
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
    expect(metric('package', 'runtime-map-packages')).toBe(fixture.project.maps.count);
    expect(metric('ship', 'runtime-map-packages')).toBe(fixture.project.maps.count);
  });

  it('rejects unsupported fixture versions and unstable budget units at the JSON boundary', () => {
    const contract = loadCreatorPerformanceContract();

    expect(() =>
      decodeCreatorPerformanceContract({ ...contract.fixture, schemaVersion: 2 }, contract.budgets),
    ).toThrow(/fixture\.schemaVersion/);

    const [firstFlow, ...remainingFlows] = contract.budgets.flows;
    const [firstMetric, ...remainingMetrics] = firstFlow!.metrics;
    expect(() =>
      decodeCreatorPerformanceContract(contract.fixture, {
        ...contract.budgets,
        flows: [
          {
            ...firstFlow,
            metrics: [{ ...firstMetric, unit: 'milliseconds' }, ...remainingMetrics],
          },
          ...remainingFlows,
        ],
      }),
    ).toThrow(/metrics\[0\]\.unit/);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  assertCreatorPerformanceReceipt,
  runCreatorPerformanceGate,
} from './creator-performance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgets = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'packages/test-fixtures/fixtures/performance/creator-v1/budgets.json'),
    'utf8',
  ),
);

describe('creator performance release gate', () => {
  let receipt: Awaited<ReturnType<typeof runCreatorPerformanceGate>>;

  beforeAll(async () => {
    receipt = await runCreatorPerformanceGate();
  }, 60_000);

  it('materializes and measures the complete v1 corpus at all named owners', () => {
    expect(receipt.fixtureId).toBe('creator-performance-v1');
    expect(receipt.flows.map(({ id }) => id)).toEqual(
      budgets.flows.map(({ id }: { id: string }) => id),
    );
    expect(receipt.flows).toHaveLength(9);
    expect(receipt.flows.reduce((sum, entry) => sum + entry.metrics.length, 0)).toBe(42);
    expect(() => assertCreatorPerformanceReceipt(budgets, receipt)).not.toThrow();
  });

  it('fails closed on missing, extra, duplicate, or non-finite receipt data', () => {
    const missingFlow = structuredClone(receipt);
    missingFlow.flows.pop();
    expect(() => assertCreatorPerformanceReceipt(budgets, missingFlow)).toThrow(
      /missing or extra flows/,
    );

    const extraFlow = structuredClone(receipt);
    extraFlow.flows.push(structuredClone(extraFlow.flows[0]!));
    expect(() => assertCreatorPerformanceReceipt(budgets, extraFlow)).toThrow(
      /missing or extra flows/,
    );

    const duplicateFlow = structuredClone(receipt);
    duplicateFlow.flows[1]!.id = duplicateFlow.flows[0]!.id;
    expect(() => assertCreatorPerformanceReceipt(budgets, duplicateFlow)).toThrow(
      /duplicate flows/,
    );

    const missingMetric = structuredClone(receipt);
    missingMetric.flows[0]!.metrics.pop();
    expect(() => assertCreatorPerformanceReceipt(budgets, missingMetric)).toThrow(
      /missing or extra metrics/,
    );

    const extraMetric = structuredClone(receipt);
    extraMetric.flows[0]!.metrics.push({ id: 'unexpected', observed: 0 });
    expect(() => assertCreatorPerformanceReceipt(budgets, extraMetric)).toThrow(
      /missing or extra metrics/,
    );

    const duplicateMetric = structuredClone(receipt);
    duplicateMetric.flows[0]!.metrics[1]!.id = duplicateMetric.flows[0]!.metrics[0]!.id;
    expect(() => assertCreatorPerformanceReceipt(budgets, duplicateMetric)).toThrow(
      /duplicate metrics/,
    );

    const notFinite = structuredClone(receipt);
    notFinite.flows[0]!.metrics[0]!.observed = Number.NaN;
    expect(() => assertCreatorPerformanceReceipt(budgets, notFinite)).toThrow(/safe integer/);

    const fractional = structuredClone(receipt);
    fractional.flows[0]!.metrics[0]!.observed = 0.5;
    expect(() => assertCreatorPerformanceReceipt(budgets, fractional)).toThrow(/safe integer/);
  });

  it('rejects exact under/over-processing and max-budget overages', () => {
    const exactUnder = structuredClone(receipt);
    const exactMetric = exactUnder.flows
      .find(({ id }) => id === 'asset-library-2000')!
      .metrics.find(({ id }) => id === 'fixture-assets')!;
    exactMetric.observed -= 1;
    expect(() => assertCreatorPerformanceReceipt(budgets, exactUnder)).toThrow(
      /asset-library-2000.fixture-assets/,
    );

    const exactOver = structuredClone(receipt);
    exactOver.flows
      .find(({ id }) => id === 'asset-library-2000')!
      .metrics.find(({ id }) => id === 'fixture-assets')!.observed += 1;
    expect(() => assertCreatorPerformanceReceipt(budgets, exactOver)).toThrow(
      /asset-library-2000.fixture-assets/,
    );

    const maxOver = structuredClone(receipt);
    maxOver.flows
      .find(({ id }) => id === 'package')!
      .metrics.find(({ id }) => id === 'package-files')!.observed = 3_001;
    expect(() => assertCreatorPerformanceReceipt(budgets, maxOver)).toThrow(
      /package.package-files/,
    );
  });
});

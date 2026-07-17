import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const contractRoot = path.join(repoRoot, 'packages/test-fixtures/fixtures/performance/creator-v1');

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));

export const loadCreatorPerformanceContract = async () => {
  const fixture = await readJson(path.join(contractRoot, 'fixture.json'));
  const budgets = await readJson(path.join(contractRoot, 'budgets.json'));
  if (
    fixture.id !== budgets.fixtureId ||
    fixture.schemaVersion !== 1 ||
    budgets.schemaVersion !== 1
  ) {
    throw new Error('creator performance contract identity/version mismatch');
  }
  if (budgets.measurementPolicy?.ciEnforcement !== 'required-release-gate:creator-performance') {
    throw new Error('creator performance CI policy is not owned by the required release gate');
  }
  return { fixture, budgets };
};

const assertExactObjectKeys = (value, keys, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`creator performance receipt ${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`creator performance receipt ${label} has unknown or missing keys`);
  }
};

/** Closed receipt validation. Metrics are accepted only from their exact contract owner. */
export const assertCreatorPerformanceReceipt = (budgets, receipt) => {
  assertExactObjectKeys(
    receipt,
    ['schemaVersion', 'fixtureId', 'budgetId', 'environment', 'flows'],
    'root',
  );
  assertExactObjectKeys(receipt.environment, ['kind', 'platform', 'arch', 'node'], 'environment');
  if (
    receipt.environment.kind !== 'deterministic-ci' ||
    typeof receipt.environment.platform !== 'string' ||
    receipt.environment.platform.length === 0 ||
    typeof receipt.environment.arch !== 'string' ||
    receipt.environment.arch.length === 0 ||
    typeof receipt.environment.node !== 'string' ||
    receipt.environment.node.length === 0
  ) {
    throw new Error('creator performance receipt environment mismatch');
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.fixtureId !== budgets.fixtureId ||
    receipt.budgetId !== budgets.id
  ) {
    throw new Error('creator performance receipt identity mismatch');
  }
  if (!Array.isArray(receipt.flows) || receipt.flows.length !== budgets.flows.length) {
    throw new Error('creator performance receipt has missing or extra flows');
  }
  const receiptFlowIds = receipt.flows.map(({ id }) => id);
  if (new Set(receiptFlowIds).size !== receiptFlowIds.length) {
    throw new Error('creator performance receipt has duplicate flows');
  }
  for (let flowIndex = 0; flowIndex < budgets.flows.length; flowIndex += 1) {
    const budgetFlow = budgets.flows[flowIndex];
    const receiptFlow = receipt.flows[flowIndex];
    assertExactObjectKeys(receiptFlow, ['id', 'owner', 'metrics'], `flow ${budgetFlow.id}`);
    if (receiptFlow.id !== budgetFlow.id || receiptFlow.owner !== budgetFlow.owner) {
      throw new Error(`creator performance receipt flow/owner mismatch at ${budgetFlow.id}`);
    }
    if (
      !Array.isArray(receiptFlow.metrics) ||
      receiptFlow.metrics.length !== budgetFlow.metrics.length
    ) {
      throw new Error(
        `creator performance receipt has missing or extra metrics for ${budgetFlow.id}`,
      );
    }
    const receiptMetricIds = receiptFlow.metrics.map(({ id }) => id);
    if (new Set(receiptMetricIds).size !== receiptMetricIds.length) {
      throw new Error(`creator performance receipt has duplicate metrics for ${budgetFlow.id}`);
    }
    for (let metricIndex = 0; metricIndex < budgetFlow.metrics.length; metricIndex += 1) {
      const budgetMetric = budgetFlow.metrics[metricIndex];
      const receiptMetric = receiptFlow.metrics[metricIndex];
      assertExactObjectKeys(
        receiptMetric,
        ['id', 'observed'],
        `metric ${budgetFlow.id}.${budgetMetric.id}`,
      );
      if (receiptMetric.id !== budgetMetric.id) {
        throw new Error(
          `creator performance receipt metric mismatch: ${budgetFlow.id}.${budgetMetric.id}`,
        );
      }
      if (!Number.isSafeInteger(receiptMetric.observed) || receiptMetric.observed < 0) {
        throw new Error(
          `creator performance receipt is not a non-negative safe integer: ${budgetFlow.id}.${budgetMetric.id}`,
        );
      }
      const passes =
        budgetMetric.limit === 'exact'
          ? receiptMetric.observed === budgetMetric.value
          : budgetMetric.limit === 'max'
            ? receiptMetric.observed <= budgetMetric.value
            : receiptMetric.observed >= budgetMetric.value;
      if (!passes) {
        throw new Error(
          `creator performance budget failed: ${budgetFlow.id}.${budgetMetric.id} ` +
            `${receiptMetric.observed} does not satisfy ${budgetMetric.limit} ${budgetMetric.value}`,
        );
      }
    }
  }
  return receipt;
};

export const writeCreatorPerformanceReceipt = async (filePath, receipt) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
};

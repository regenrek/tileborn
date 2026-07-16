import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(packageRoot, '..', 'fixtures');

/** Top-level fixture categories shipped with `@tileborne/test-fixtures`. */
export const FIXTURE_CATEGORIES = [
  'maps',
  'asset-packs',
  'plugins',
  'projects',
  'performance',
] as const;

export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

const normalizeRelative = (relativePath: string): string => {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.startsWith('..')) {
    throw new Error(`fixture path escapes fixtures root: ${relativePath}`);
  }
  return normalized;
};

/**
 * Resolve an absolute path to a bundled CC0 fixture.
 *
 * @param relativePath Path relative to `fixtures/`, e.g. `plugins/smoke-fixture`
 */
export const getFixturePath = (...segments: readonly string[]): string => {
  const relative = normalizeRelative(path.join(...segments));
  const absolute = path.join(fixturesRoot, relative);
  if (!absolute.startsWith(fixturesRoot)) {
    throw new Error(`fixture path escapes fixtures root: ${relativePathFromSegments(segments)}`);
  }
  return absolute;
};

const relativePathFromSegments = (segments: readonly string[]): string => path.join(...segments);

/**
 * List fixture entry names under a category directory.
 *
 * @param category One of `maps`, `asset-packs`, `plugins`, or `projects`
 */
export const listFixtures = (category: FixtureCategory): readonly string[] => {
  const directory = getFixturePath(category);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isDirectory())
    .map((entry: Dirent) => entry.name)
    .sort();
};

/** Returns true when the resolved fixture path exists on disk. */
export const fixtureExists = (...segments: readonly string[]): boolean => {
  try {
    const absolute = getFixturePath(...segments);
    return statSync(absolute).isDirectory() || statSync(absolute).isFile();
  } catch {
    return false;
  }
};

export const fixturesRootPath = (): string => fixturesRoot;

/** Bundled CC0 sample tileset used for editor first-launch seeding. */
export const SAMPLE_ASSET_PACK_ID = 'pack:550e8400-e29b-41d4-a716-446655440099' as const;

/** Relative directory under `fixtures/asset-packs/`. */
export const SAMPLE_ASSET_PACK_DIR = 'smoke-pack' as const;

/** Absolute path to the sample asset pack fixture root. */
export const getSampleAssetPackPath = (): string =>
  getFixturePath('asset-packs', SAMPLE_ASSET_PACK_DIR);

/** Stable ids consumed by the creator performance harness. */
export const CREATOR_PERFORMANCE_FLOW_IDS = [
  'startup',
  'reopen',
  'asset-library-2000',
  'large-behaviors-references',
  'validation',
  'save',
  'playtest-start',
  'package',
  'ship',
] as const;

export type CreatorPerformanceFlowId = (typeof CREATOR_PERFORMANCE_FLOW_IDS)[number];

export type CreatorPerformanceMetricUnit = 'bytes' | 'count' | 'operations';
export type CreatorPerformanceMetricLimit = 'exact' | 'max' | 'min';

export interface CreatorPerformanceFixture {
  readonly schemaVersion: 1;
  readonly id: 'creator-performance-v1';
  readonly seed: number;
  readonly generator: {
    readonly algorithm: 'tileborne-creator-performance-v1';
    readonly ordering: 'lexicographic-index';
    readonly textEncoding: 'utf8';
  };
  readonly project: {
    readonly projectManifestBytes: number;
    readonly maps: {
      readonly count: number;
      readonly widthTiles: number;
      readonly heightTiles: number;
      readonly objectsPerMap: number;
    };
    readonly assets: {
      readonly packCount: number;
      readonly groupCount: number;
      readonly assetCount: number;
      readonly payloadBytesPerAsset: number;
      readonly workingPaletteItems: number;
    };
    readonly behaviors: {
      readonly count: number;
      readonly visualCount: number;
      readonly typescriptCount: number;
      readonly referencesPerBehavior: number;
      readonly totalReferences: number;
      readonly sourceBytesPerBehavior: number;
      readonly nodesPerVisualBehavior: number;
    };
    readonly validation: {
      readonly validVariantFaults: 0;
      readonly invalidVariantFaults: number;
      readonly faultKinds: readonly string[];
    };
  };
}

export interface CreatorPerformanceBudgetMetric {
  readonly id: string;
  readonly unit: CreatorPerformanceMetricUnit;
  readonly limit: CreatorPerformanceMetricLimit;
  readonly value: number;
  readonly rationale: string;
}

export interface CreatorPerformanceBudgetFlow {
  readonly id: CreatorPerformanceFlowId;
  readonly description: string;
  readonly metrics: readonly CreatorPerformanceBudgetMetric[];
}

export interface CreatorPerformanceBudgets {
  readonly schemaVersion: 1;
  readonly id: 'creator-performance-budgets-v1';
  readonly fixtureId: CreatorPerformanceFixture['id'];
  readonly measurementPolicy: {
    readonly deterministicUnitsOnly: true;
    readonly ciEnforcement: 'deferred-to-plan-item-i-enforce-stable-count-size-budget-3518';
    readonly nativeTimingCalibration: 'deferred-to-plan-item-i-enforce-stable-count-size-budget-3518';
  };
  readonly flows: readonly CreatorPerformanceBudgetFlow[];
}

export interface CreatorPerformanceContract {
  readonly fixture: CreatorPerformanceFixture;
  readonly budgets: CreatorPerformanceBudgets;
}

export const CREATOR_PERFORMANCE_FIXTURE_DIR = 'creator-v1' as const;

const readFixtureJson = (fileName: string): unknown =>
  JSON.parse(
    readFileSync(getFixturePath('performance', CREATOR_PERFORMANCE_FIXTURE_DIR, fileName), 'utf8'),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`Invalid creator performance contract: ${label}`);
  return value;
};

const requireLiteral = <const T extends string | number | boolean>(
  value: unknown,
  literal: T,
  label: string,
): T => {
  if (value !== literal) throw new Error(`Invalid creator performance contract: ${label}`);
  return literal;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid creator performance contract: ${label}`);
  }
  return value;
};

const requireSafeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid creator performance contract: ${label}`);
  }
  return Number(value);
};

const requireStringArray = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid creator performance contract: ${label}`);
  }
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
};

const requireOneOf = <const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] => {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`Invalid creator performance contract: ${label}`);
  }
  return value;
};

const PERFORMANCE_METRIC_UNITS = ['bytes', 'count', 'operations'] as const;
const PERFORMANCE_METRIC_LIMITS = ['exact', 'max', 'min'] as const;
const DEFERRED_PERFORMANCE_ITEM =
  'deferred-to-plan-item-i-enforce-stable-count-size-budget-3518' as const;

const decodePerformanceFixture = (value: unknown): CreatorPerformanceFixture => {
  const root = requireRecord(value, 'fixture root');
  const generator = requireRecord(root.generator, 'fixture.generator');
  const project = requireRecord(root.project, 'fixture.project');
  const maps = requireRecord(project.maps, 'fixture.project.maps');
  const assets = requireRecord(project.assets, 'fixture.project.assets');
  const behaviors = requireRecord(project.behaviors, 'fixture.project.behaviors');
  const validation = requireRecord(project.validation, 'fixture.project.validation');

  return {
    schemaVersion: requireLiteral(root.schemaVersion, 1, 'fixture.schemaVersion'),
    id: requireLiteral(root.id, 'creator-performance-v1', 'fixture.id'),
    seed: requireSafeInteger(root.seed, 'fixture.seed'),
    generator: {
      algorithm: requireLiteral(
        generator.algorithm,
        'tileborne-creator-performance-v1',
        'fixture.generator.algorithm',
      ),
      ordering: requireLiteral(
        generator.ordering,
        'lexicographic-index',
        'fixture.generator.ordering',
      ),
      textEncoding: requireLiteral(
        generator.textEncoding,
        'utf8',
        'fixture.generator.textEncoding',
      ),
    },
    project: {
      projectManifestBytes: requireSafeInteger(
        project.projectManifestBytes,
        'fixture.project.projectManifestBytes',
      ),
      maps: {
        count: requireSafeInteger(maps.count, 'fixture.project.maps.count'),
        widthTiles: requireSafeInteger(maps.widthTiles, 'fixture.project.maps.widthTiles'),
        heightTiles: requireSafeInteger(maps.heightTiles, 'fixture.project.maps.heightTiles'),
        objectsPerMap: requireSafeInteger(maps.objectsPerMap, 'fixture.project.maps.objectsPerMap'),
      },
      assets: {
        packCount: requireSafeInteger(assets.packCount, 'fixture.project.assets.packCount'),
        groupCount: requireSafeInteger(assets.groupCount, 'fixture.project.assets.groupCount'),
        assetCount: requireSafeInteger(assets.assetCount, 'fixture.project.assets.assetCount'),
        payloadBytesPerAsset: requireSafeInteger(
          assets.payloadBytesPerAsset,
          'fixture.project.assets.payloadBytesPerAsset',
        ),
        workingPaletteItems: requireSafeInteger(
          assets.workingPaletteItems,
          'fixture.project.assets.workingPaletteItems',
        ),
      },
      behaviors: {
        count: requireSafeInteger(behaviors.count, 'fixture.project.behaviors.count'),
        visualCount: requireSafeInteger(
          behaviors.visualCount,
          'fixture.project.behaviors.visualCount',
        ),
        typescriptCount: requireSafeInteger(
          behaviors.typescriptCount,
          'fixture.project.behaviors.typescriptCount',
        ),
        referencesPerBehavior: requireSafeInteger(
          behaviors.referencesPerBehavior,
          'fixture.project.behaviors.referencesPerBehavior',
        ),
        totalReferences: requireSafeInteger(
          behaviors.totalReferences,
          'fixture.project.behaviors.totalReferences',
        ),
        sourceBytesPerBehavior: requireSafeInteger(
          behaviors.sourceBytesPerBehavior,
          'fixture.project.behaviors.sourceBytesPerBehavior',
        ),
        nodesPerVisualBehavior: requireSafeInteger(
          behaviors.nodesPerVisualBehavior,
          'fixture.project.behaviors.nodesPerVisualBehavior',
        ),
      },
      validation: {
        validVariantFaults: requireLiteral(
          validation.validVariantFaults,
          0,
          'fixture.project.validation.validVariantFaults',
        ),
        invalidVariantFaults: requireSafeInteger(
          validation.invalidVariantFaults,
          'fixture.project.validation.invalidVariantFaults',
        ),
        faultKinds: requireStringArray(
          validation.faultKinds,
          'fixture.project.validation.faultKinds',
        ),
      },
    },
  };
};

const decodePerformanceBudgets = (
  value: unknown,
  fixtureId: CreatorPerformanceFixture['id'],
): CreatorPerformanceBudgets => {
  const root = requireRecord(value, 'budgets root');
  const policy = requireRecord(root.measurementPolicy, 'budgets.measurementPolicy');
  if (!Array.isArray(root.flows)) {
    throw new Error('Invalid creator performance contract: budgets.flows');
  }

  const flows = root.flows.map((flowValue, flowIndex): CreatorPerformanceBudgetFlow => {
    const flow = requireRecord(flowValue, `budgets.flows[${flowIndex}]`);
    if (!Array.isArray(flow.metrics)) {
      throw new Error(`Invalid creator performance contract: budgets.flows[${flowIndex}].metrics`);
    }
    return {
      id: requireOneOf(flow.id, CREATOR_PERFORMANCE_FLOW_IDS, `budgets.flows[${flowIndex}].id`),
      description: requireString(flow.description, `budgets.flows[${flowIndex}].description`),
      metrics: flow.metrics.map((metricValue, metricIndex): CreatorPerformanceBudgetMetric => {
        const label = `budgets.flows[${flowIndex}].metrics[${metricIndex}]`;
        const metric = requireRecord(metricValue, label);
        return {
          id: requireString(metric.id, `${label}.id`),
          unit: requireOneOf(metric.unit, PERFORMANCE_METRIC_UNITS, `${label}.unit`),
          limit: requireOneOf(metric.limit, PERFORMANCE_METRIC_LIMITS, `${label}.limit`),
          value: requireSafeInteger(metric.value, `${label}.value`),
          rationale: requireString(metric.rationale, `${label}.rationale`),
        };
      }),
    };
  });

  return {
    schemaVersion: requireLiteral(root.schemaVersion, 1, 'budgets.schemaVersion'),
    id: requireLiteral(root.id, 'creator-performance-budgets-v1', 'budgets.id'),
    fixtureId: requireLiteral(root.fixtureId, fixtureId, 'budgets.fixtureId'),
    measurementPolicy: {
      deterministicUnitsOnly: requireLiteral(
        policy.deterministicUnitsOnly,
        true,
        'budgets.measurementPolicy.deterministicUnitsOnly',
      ),
      ciEnforcement: requireLiteral(
        policy.ciEnforcement,
        DEFERRED_PERFORMANCE_ITEM,
        'budgets.measurementPolicy.ciEnforcement',
      ),
      nativeTimingCalibration: requireLiteral(
        policy.nativeTimingCalibration,
        DEFERRED_PERFORMANCE_ITEM,
        'budgets.measurementPolicy.nativeTimingCalibration',
      ),
    },
    flows,
  };
};

/** Decode one fixture/budget pair exactly once at its JSON boundary. */
export const decodeCreatorPerformanceContract = (
  fixtureValue: unknown,
  budgetValue: unknown,
): CreatorPerformanceContract => {
  const fixture = decodePerformanceFixture(fixtureValue);
  const budgets = decodePerformanceBudgets(budgetValue, fixture.id);
  const flowIds = budgets.flows.map(({ id }) => id);
  if (
    flowIds.length !== CREATOR_PERFORMANCE_FLOW_IDS.length ||
    flowIds.some((id, index) => id !== CREATOR_PERFORMANCE_FLOW_IDS[index])
  ) {
    throw new Error('Invalid creator performance contract: budgets.flows coverage/order');
  }
  for (const flow of budgets.flows) {
    const metricIds = flow.metrics.map(({ id }) => id);
    if (metricIds.length === 0 || new Set(metricIds).size !== metricIds.length) {
      throw new Error(`Invalid creator performance contract: ${flow.id} metric ids`);
    }
  }
  if (
    fixture.project.assets.assetCount < 2_000 ||
    fixture.project.assets.workingPaletteItems !== fixture.project.assets.assetCount ||
    fixture.project.behaviors.visualCount + fixture.project.behaviors.typescriptCount !==
      fixture.project.behaviors.count ||
    fixture.project.behaviors.totalReferences !==
      fixture.project.behaviors.count * fixture.project.behaviors.referencesPerBehavior ||
    new Set(fixture.project.validation.faultKinds).size !==
      fixture.project.validation.faultKinds.length
  ) {
    throw new Error('Invalid creator performance contract: fixture derived invariants');
  }
  return { fixture, budgets };
};

/**
 * Load the committed large-project recipe and its deterministic budget contract.
 * The recipe is compact by design; benchmark owners materialize records from its
 * seed/counts instead of committing thousands of repetitive files.
 */
export const loadCreatorPerformanceContract = (): CreatorPerformanceContract =>
  decodeCreatorPerformanceContract(
    readFixtureJson('fixture.json'),
    readFixtureJson('budgets.json'),
  );

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

const requireExactKeys = (
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void => {
  const actualKeys = Object.keys(record).sort();
  const canonicalKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== canonicalKeys.length ||
    actualKeys.some((key, index) => key !== canonicalKeys[index])
  ) {
    throw new Error(`Invalid creator performance contract: ${label} keys`);
  }
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

const DEFERRED_PERFORMANCE_ITEM =
  'deferred-to-plan-item-i-enforce-stable-count-size-budget-3518' as const;

type CanonicalMetricSpec = Readonly<{
  id: string;
  unit: CreatorPerformanceMetricUnit;
  limit: CreatorPerformanceMetricLimit;
  value: number;
}>;

const CANONICAL_CREATOR_PERFORMANCE_FLOWS = [
  {
    id: 'startup',
    description: 'Cold editor startup before a project is opened.',
    metrics: [
      { id: 'project-records-eagerly-decoded', unit: 'count', limit: 'max', value: 64 },
      { id: 'asset-records-eagerly-decoded', unit: 'count', limit: 'exact', value: 0 },
      { id: 'behavior-bodies-eagerly-decoded', unit: 'count', limit: 'exact', value: 0 },
    ],
  },
  {
    id: 'reopen',
    description: 'Reopen creator-performance-v1 and render its initial editor shell.',
    metrics: [
      { id: 'project-manifest-input-bytes', unit: 'bytes', limit: 'exact', value: 32_768 },
      { id: 'project-manifest-decodes', unit: 'operations', limit: 'exact', value: 1 },
      { id: 'initial-asset-page-records', unit: 'count', limit: 'max', value: 64 },
      { id: 'initial-behavior-bodies', unit: 'count', limit: 'max', value: 1 },
      { id: 'recovery-snapshot-reads', unit: 'operations', limit: 'max', value: 1 },
    ],
  },
  {
    id: 'asset-library-2000',
    description: 'Browse and scroll the 2,048-asset library and working palette.',
    metrics: [
      { id: 'fixture-assets', unit: 'count', limit: 'exact', value: 2_048 },
      { id: 'asset-page-records', unit: 'count', limit: 'max', value: 64 },
      { id: 'preview-references-per-request', unit: 'count', limit: 'max', value: 64 },
      { id: 'preview-references-per-group-summary', unit: 'count', limit: 'max', value: 8 },
      {
        id: 'full-corpus-preview-requests-before-scroll',
        unit: 'operations',
        limit: 'exact',
        value: 0,
      },
    ],
  },
  {
    id: 'large-behaviors-references',
    description: 'Open, search, and resolve the large behavior/reference corpus.',
    metrics: [
      { id: 'fixture-behaviors', unit: 'count', limit: 'exact', value: 512 },
      { id: 'fixture-references', unit: 'count', limit: 'exact', value: 8_192 },
      { id: 'reference-search-page-records', unit: 'count', limit: 'max', value: 32 },
      { id: 'reference-resolution-batch-records', unit: 'count', limit: 'max', value: 64 },
      { id: 'behavior-bodies-opened-by-list', unit: 'count', limit: 'exact', value: 0 },
    ],
  },
  {
    id: 'validation',
    description: 'Validate the valid corpus and its deterministic 64-fault variant.',
    metrics: [
      { id: 'fixture-validation-records', unit: 'count', limit: 'exact', value: 14_857 },
      { id: 'full-project-validation-passes', unit: 'operations', limit: 'exact', value: 1 },
      { id: 'invalid-variant-faults', unit: 'count', limit: 'exact', value: 64 },
      { id: 'diagnostics-returned', unit: 'count', limit: 'exact', value: 64 },
      { id: 'records-inspected', unit: 'count', limit: 'max', value: 16_000 },
    ],
  },
  {
    id: 'save',
    description: 'Persist one changed map and its project revision atomically.',
    metrics: [
      { id: 'changed-resources', unit: 'count', limit: 'exact', value: 1 },
      { id: 'content-files-rewritten', unit: 'count', limit: 'max', value: 3 },
      { id: 'journal-phase-transitions', unit: 'operations', limit: 'exact', value: 4 },
      { id: 'full-project-directory-copies', unit: 'operations', limit: 'exact', value: 0 },
    ],
  },
  {
    id: 'playtest-start',
    description: 'Compile the selected map and start a local playtest session.',
    metrics: [
      { id: 'selected-map-packages', unit: 'count', limit: 'exact', value: 1 },
      { id: 'compiled-behavior-modules', unit: 'count', limit: 'exact', value: 512 },
      { id: 'source-behavior-bytes', unit: 'bytes', limit: 'exact', value: 2_097_152 },
      { id: 'session-start-transitions', unit: 'operations', limit: 'exact', value: 3 },
    ],
  },
  {
    id: 'package',
    description: 'Assemble all eight fixture maps into verified runtime map packages.',
    metrics: [
      { id: 'runtime-map-packages', unit: 'count', limit: 'exact', value: 8 },
      { id: 'input-assets', unit: 'count', limit: 'exact', value: 2_048 },
      { id: 'input-behavior-modules', unit: 'count', limit: 'exact', value: 512 },
      { id: 'asset-payload-input-bytes', unit: 'bytes', limit: 'exact', value: 8_388_608 },
      { id: 'package-files', unit: 'count', limit: 'max', value: 3_000 },
      { id: 'full-input-traversals', unit: 'operations', limit: 'max', value: 2 },
    ],
  },
  {
    id: 'ship',
    description: 'Promote the packaged corpus into one verified local Ship artifact.',
    metrics: [
      { id: 'runtime-map-packages', unit: 'count', limit: 'exact', value: 8 },
      { id: 'artifact-files', unit: 'count', limit: 'max', value: 3_072 },
      { id: 'artifact-bytes', unit: 'bytes', limit: 'max', value: 67_108_864 },
      { id: 'artifact-promotions', unit: 'operations', limit: 'exact', value: 1 },
      {
        id: 'post-promotion-integrity-traversals',
        unit: 'operations',
        limit: 'exact',
        value: 1,
      },
    ],
  },
] as const satisfies readonly {
  readonly id: CreatorPerformanceFlowId;
  readonly description: string;
  readonly metrics: readonly CanonicalMetricSpec[];
}[];

const decodePerformanceFixture = (value: unknown): CreatorPerformanceFixture => {
  const root = requireRecord(value, 'fixture root');
  requireExactKeys(root, ['schemaVersion', 'id', 'seed', 'generator', 'project'], 'fixture root');
  const generator = requireRecord(root.generator, 'fixture.generator');
  requireExactKeys(generator, ['algorithm', 'ordering', 'textEncoding'], 'fixture.generator');
  const project = requireRecord(root.project, 'fixture.project');
  requireExactKeys(
    project,
    ['projectManifestBytes', 'maps', 'assets', 'behaviors', 'validation'],
    'fixture.project',
  );
  const maps = requireRecord(project.maps, 'fixture.project.maps');
  requireExactKeys(
    maps,
    ['count', 'widthTiles', 'heightTiles', 'objectsPerMap'],
    'fixture.project.maps',
  );
  const assets = requireRecord(project.assets, 'fixture.project.assets');
  requireExactKeys(
    assets,
    ['packCount', 'groupCount', 'assetCount', 'payloadBytesPerAsset', 'workingPaletteItems'],
    'fixture.project.assets',
  );
  const behaviors = requireRecord(project.behaviors, 'fixture.project.behaviors');
  requireExactKeys(
    behaviors,
    [
      'count',
      'visualCount',
      'typescriptCount',
      'referencesPerBehavior',
      'totalReferences',
      'sourceBytesPerBehavior',
      'nodesPerVisualBehavior',
    ],
    'fixture.project.behaviors',
  );
  const validation = requireRecord(project.validation, 'fixture.project.validation');
  requireExactKeys(
    validation,
    ['validVariantFaults', 'invalidVariantFaults', 'faultKinds'],
    'fixture.project.validation',
  );
  if (!Array.isArray(validation.faultKinds) || validation.faultKinds.length !== 4) {
    throw new Error('Invalid creator performance contract: fixture.project.validation.faultKinds');
  }

  return {
    schemaVersion: requireLiteral(root.schemaVersion, 1, 'fixture.schemaVersion'),
    id: requireLiteral(root.id, 'creator-performance-v1', 'fixture.id'),
    seed: requireLiteral(root.seed, 20_260_716, 'fixture.seed'),
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
      projectManifestBytes: requireLiteral(
        project.projectManifestBytes,
        32_768,
        'fixture.project.projectManifestBytes',
      ),
      maps: {
        count: requireLiteral(maps.count, 8, 'fixture.project.maps.count'),
        widthTiles: requireLiteral(maps.widthTiles, 256, 'fixture.project.maps.widthTiles'),
        heightTiles: requireLiteral(maps.heightTiles, 256, 'fixture.project.maps.heightTiles'),
        objectsPerMap: requireLiteral(
          maps.objectsPerMap,
          512,
          'fixture.project.maps.objectsPerMap',
        ),
      },
      assets: {
        packCount: requireLiteral(assets.packCount, 4, 'fixture.project.assets.packCount'),
        groupCount: requireLiteral(assets.groupCount, 256, 'fixture.project.assets.groupCount'),
        assetCount: requireLiteral(assets.assetCount, 2_048, 'fixture.project.assets.assetCount'),
        payloadBytesPerAsset: requireLiteral(
          assets.payloadBytesPerAsset,
          4_096,
          'fixture.project.assets.payloadBytesPerAsset',
        ),
        workingPaletteItems: requireLiteral(
          assets.workingPaletteItems,
          2_048,
          'fixture.project.assets.workingPaletteItems',
        ),
      },
      behaviors: {
        count: requireLiteral(behaviors.count, 512, 'fixture.project.behaviors.count'),
        visualCount: requireLiteral(
          behaviors.visualCount,
          256,
          'fixture.project.behaviors.visualCount',
        ),
        typescriptCount: requireLiteral(
          behaviors.typescriptCount,
          256,
          'fixture.project.behaviors.typescriptCount',
        ),
        referencesPerBehavior: requireLiteral(
          behaviors.referencesPerBehavior,
          16,
          'fixture.project.behaviors.referencesPerBehavior',
        ),
        totalReferences: requireLiteral(
          behaviors.totalReferences,
          8_192,
          'fixture.project.behaviors.totalReferences',
        ),
        sourceBytesPerBehavior: requireLiteral(
          behaviors.sourceBytesPerBehavior,
          4_096,
          'fixture.project.behaviors.sourceBytesPerBehavior',
        ),
        nodesPerVisualBehavior: requireLiteral(
          behaviors.nodesPerVisualBehavior,
          32,
          'fixture.project.behaviors.nodesPerVisualBehavior',
        ),
      },
      validation: {
        validVariantFaults: requireLiteral(
          validation.validVariantFaults,
          0,
          'fixture.project.validation.validVariantFaults',
        ),
        invalidVariantFaults: requireLiteral(
          validation.invalidVariantFaults,
          64,
          'fixture.project.validation.invalidVariantFaults',
        ),
        faultKinds: [
          requireLiteral(
            validation.faultKinds[0],
            'missing-asset',
            'fixture.project.validation.faultKinds[0]',
          ),
          requireLiteral(
            validation.faultKinds[1],
            'missing-behavior',
            'fixture.project.validation.faultKinds[1]',
          ),
          requireLiteral(
            validation.faultKinds[2],
            'missing-entity',
            'fixture.project.validation.faultKinds[2]',
          ),
          requireLiteral(
            validation.faultKinds[3],
            'missing-map',
            'fixture.project.validation.faultKinds[3]',
          ),
        ],
      },
    },
  };
};

const decodePerformanceBudgets = (
  value: unknown,
  fixtureId: CreatorPerformanceFixture['id'],
): CreatorPerformanceBudgets => {
  const root = requireRecord(value, 'budgets root');
  requireExactKeys(
    root,
    ['schemaVersion', 'id', 'fixtureId', 'measurementPolicy', 'flows'],
    'budgets root',
  );
  const policy = requireRecord(root.measurementPolicy, 'budgets.measurementPolicy');
  requireExactKeys(
    policy,
    ['deterministicUnitsOnly', 'ciEnforcement', 'nativeTimingCalibration'],
    'budgets.measurementPolicy',
  );
  if (
    !Array.isArray(root.flows) ||
    root.flows.length !== CANONICAL_CREATOR_PERFORMANCE_FLOWS.length
  ) {
    throw new Error('Invalid creator performance contract: budgets.flows');
  }

  const flows = root.flows.map((flowValue, flowIndex): CreatorPerformanceBudgetFlow => {
    const label = `budgets.flows[${flowIndex}]`;
    const canonicalFlow = CANONICAL_CREATOR_PERFORMANCE_FLOWS[flowIndex];
    if (canonicalFlow === undefined) {
      throw new Error(`Invalid creator performance contract: ${label}`);
    }
    const flow = requireRecord(flowValue, label);
    requireExactKeys(flow, ['id', 'description', 'metrics'], label);
    if (!Array.isArray(flow.metrics) || flow.metrics.length !== canonicalFlow.metrics.length) {
      throw new Error(`Invalid creator performance contract: ${label}.metrics`);
    }
    return {
      id: requireLiteral(flow.id, canonicalFlow.id, `${label}.id`),
      description: requireLiteral(
        flow.description,
        canonicalFlow.description,
        `${label}.description`,
      ),
      metrics: flow.metrics.map((metricValue, metricIndex): CreatorPerformanceBudgetMetric => {
        const metricLabel = `${label}.metrics[${metricIndex}]`;
        const canonicalMetric = canonicalFlow.metrics[metricIndex];
        if (canonicalMetric === undefined) {
          throw new Error(`Invalid creator performance contract: ${metricLabel}`);
        }
        const metric = requireRecord(metricValue, metricLabel);
        requireExactKeys(metric, ['id', 'unit', 'limit', 'value', 'rationale'], metricLabel);
        return {
          id: requireLiteral(metric.id, canonicalMetric.id, `${metricLabel}.id`),
          unit: requireLiteral(metric.unit, canonicalMetric.unit, `${metricLabel}.unit`),
          limit: requireLiteral(metric.limit, canonicalMetric.limit, `${metricLabel}.limit`),
          value: requireLiteral(metric.value, canonicalMetric.value, `${metricLabel}.value`),
          rationale: requireString(metric.rationale, `${metricLabel}.rationale`),
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

/** Pure comparison used by downstream harnesses after they collect one stable metric. */
export const creatorPerformanceMetricPasses = (
  metric: CreatorPerformanceBudgetMetric,
  observedValue: number,
): boolean => {
  if (!Number.isSafeInteger(observedValue) || observedValue < 0) return false;
  switch (metric.limit) {
    case 'exact':
      return observedValue === metric.value;
    case 'max':
      return observedValue <= metric.value;
    case 'min':
      return observedValue >= metric.value;
  }
};

/**
 * Compare a complete flow receipt. Missing and unknown metrics fail closed so a
 * harness cannot satisfy the contract by reporting only convenient counters.
 */
export const creatorPerformanceFlowPasses = (
  flow: CreatorPerformanceBudgetFlow,
  observed: Readonly<Record<string, number>>,
): boolean => {
  const expectedIds = flow.metrics.map(({ id }) => id).sort();
  const observedIds = Object.keys(observed).sort();
  if (
    expectedIds.length !== observedIds.length ||
    expectedIds.some((id, index) => id !== observedIds[index])
  ) {
    return false;
  }
  return flow.metrics.every((metric) =>
    creatorPerformanceMetricPasses(metric, observed[metric.id] ?? Number.NaN),
  );
};

/** Decode one fixture/budget pair exactly once at its JSON boundary. */
export const decodeCreatorPerformanceContract = (
  fixtureValue: unknown,
  budgetValue: unknown,
): CreatorPerformanceContract => {
  const fixture = decodePerformanceFixture(fixtureValue);
  const budgets = decodePerformanceBudgets(budgetValue, fixture.id);
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

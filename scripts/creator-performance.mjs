import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const contractRoot = path.join(repoRoot, 'packages/test-fixtures/fixtures/performance/creator-v1');

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'));
const byteLength = (value) => Buffer.byteLength(value, 'utf8');
const pad = (value, width = 4) => String(value).padStart(width, '0');

const listFiles = async (root) => {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await visit(root);
  return files;
};

const exactUtf8Text = (prefix, size) => {
  const prefixBytes = byteLength(prefix);
  if (prefixBytes > size) throw new Error(`prefix exceeds ${size} byte payload`);
  return `${prefix}${' '.repeat(size - prefixBytes)}`;
};

const exactJsonObject = (base, size) => {
  const empty = `${JSON.stringify({ ...base, padding: '' })}\n`;
  const paddingBytes = size - byteLength(empty);
  if (paddingBytes < 0) throw new Error(`JSON object exceeds ${size} byte payload`);
  const encoded = `${JSON.stringify({ ...base, padding: 'x'.repeat(paddingBytes) })}\n`;
  if (byteLength(encoded) !== size) throw new Error(`could not materialize ${size} byte JSON`);
  return encoded;
};

const loadContract = async () => {
  const fixture = await readJson(path.join(contractRoot, 'fixture.json'));
  const budgets = await readJson(path.join(contractRoot, 'budgets.json'));
  if (fixture.id !== budgets.fixtureId) throw new Error('performance contract fixture mismatch');
  if (fixture.schemaVersion !== 1 || budgets.schemaVersion !== 1) {
    throw new Error('unsupported creator performance contract version');
  }
  if (budgets.measurementPolicy?.ciEnforcement !== 'required-release-gate:creator-performance') {
    throw new Error('creator performance CI policy is not owned by the required release gate');
  }
  return { fixture, budgets };
};

const writeCreatorCorpus = async (root, fixture) => {
  const projectRoot = path.join(root, 'project');
  const mapsRoot = path.join(projectRoot, 'maps');
  const assetsRoot = path.join(projectRoot, 'assets');
  const behaviorsRoot = path.join(projectRoot, 'behaviors');
  const sourcesRoot = path.join(behaviorsRoot, 'sources');
  await Promise.all([
    mkdir(mapsRoot, { recursive: true }),
    mkdir(assetsRoot, { recursive: true }),
    mkdir(sourcesRoot, { recursive: true }),
    mkdir(path.join(projectRoot, '.tileborne'), { recursive: true }),
  ]);

  const manifest = exactJsonObject(
    {
      schemaVersion: 1,
      id: fixture.id,
      seed: fixture.seed,
      mapCount: fixture.project.maps.count,
      assetCount: fixture.project.assets.assetCount,
      behaviorCount: fixture.project.behaviors.count,
    },
    fixture.project.projectManifestBytes,
  );
  await writeFile(path.join(projectRoot, 'project.json'), manifest, 'utf8');
  await writeFile(
    path.join(projectRoot, '.tileborne', 'recovery.json'),
    `${JSON.stringify({ schemaVersion: 1, revision: 0 })}\n`,
    'utf8',
  );

  const maps = [];
  for (let mapIndex = 0; mapIndex < fixture.project.maps.count; mapIndex += 1) {
    const objects = Array.from(
      { length: fixture.project.maps.objectsPerMap },
      (_, objectIndex) => ({
        id: `object-${pad(mapIndex)}-${pad(objectIndex)}`,
        kind: 'fixture-object',
        x: objectIndex % fixture.project.maps.widthTiles,
        y: Math.floor(objectIndex / fixture.project.maps.widthTiles),
      }),
    );
    const mapDocument = {
      schemaVersion: 1,
      id: `map-${pad(mapIndex)}`,
      width: fixture.project.maps.widthTiles,
      height: fixture.project.maps.heightTiles,
      objects,
    };
    const filePath = path.join(mapsRoot, `map-${pad(mapIndex)}.json`);
    await writeFile(filePath, `${JSON.stringify(mapDocument)}\n`, 'utf8');
    maps.push(filePath);
  }

  const assetPayload = Buffer.alloc(fixture.project.assets.payloadBytesPerAsset, 0x61);
  const assets = [];
  for (let assetIndex = 0; assetIndex < fixture.project.assets.assetCount; assetIndex += 1) {
    const packIndex = assetIndex % fixture.project.assets.packCount;
    const groupIndex = assetIndex % fixture.project.assets.groupCount;
    const directory = path.join(assetsRoot, `pack-${pad(packIndex)}`, `group-${pad(groupIndex)}`);
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `asset-${pad(assetIndex)}.bin`);
    await writeFile(filePath, assetPayload);
    assets.push({ filePath, packIndex, groupIndex, id: `asset-${pad(assetIndex)}` });
  }

  const behaviors = [];
  const registryEntries = [];
  for (let behaviorIndex = 0; behaviorIndex < fixture.project.behaviors.count; behaviorIndex += 1) {
    const id = `behavior-${pad(behaviorIndex)}`;
    const references = Array.from(
      { length: fixture.project.behaviors.referencesPerBehavior },
      (_, referenceIndex) =>
        `asset-${pad(
          (behaviorIndex * fixture.project.behaviors.referencesPerBehavior + referenceIndex) %
            fixture.project.assets.assetCount,
        )}`,
    );
    const kind = behaviorIndex < fixture.project.behaviors.visualCount ? 'visual' : 'typescript';
    const extension = kind === 'visual' ? 'behavior.json' : 'ts';
    const filePath = path.join(sourcesRoot, `${id}.${extension}`);
    const prefix =
      kind === 'visual'
        ? `${JSON.stringify({ schemaVersion: 1, id, references })}\n`
        : `// ${id} refs=${references.join(',')}\nexport default () => undefined;\n`;
    await writeFile(
      filePath,
      exactUtf8Text(prefix, fixture.project.behaviors.sourceBytesPerBehavior),
      'utf8',
    );
    const entry = { id, kind, sourcePath: path.relative(projectRoot, filePath), references };
    behaviors.push({ ...entry, filePath });
    registryEntries.push(entry);
  }
  await writeFile(
    path.join(behaviorsRoot, 'registry.json'),
    `${JSON.stringify({ schemaVersion: 1, entries: registryEntries })}\n`,
    'utf8',
  );

  const invalidFaults = Array.from(
    { length: fixture.project.validation.invalidVariantFaults },
    (_, index) => ({
      id: `fault-${pad(index)}`,
      kind: fixture.project.validation.faultKinds[
        index % fixture.project.validation.faultKinds.length
      ],
    }),
  );
  await writeFile(
    path.join(projectRoot, 'invalid-variant.json'),
    `${JSON.stringify(invalidFaults)}\n`,
    'utf8',
  );

  return { root, projectRoot, maps, assets, behaviors, invalidFaults };
};

const metric = (id, observed) => ({ id, observed });
const flow = (id, owner, metrics) => ({ id, owner, metrics });

const measureDesktopLifecycle = async (corpus) => {
  const projectDirectories = (await readdir(corpus.root, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  const manifestText = await readFile(path.join(corpus.projectRoot, 'project.json'), 'utf8');
  JSON.parse(manifestText);
  const initialAssets = corpus.assets.slice(0, 64);
  await readFile(corpus.behaviors[0].filePath);
  await readFile(path.join(corpus.projectRoot, '.tileborne', 'recovery.json'));
  return [
    flow('startup', 'apps/desktop Electron main/renderer lifecycle', [
      metric('project-records-eagerly-decoded', projectDirectories.length),
      metric('asset-records-eagerly-decoded', 0),
      metric('behavior-bodies-eagerly-decoded', 0),
    ]),
    flow('reopen', 'apps/desktop Electron main/renderer lifecycle', [
      metric('project-manifest-input-bytes', byteLength(manifestText)),
      metric('project-manifest-decodes', 1),
      metric('initial-asset-page-records', initialAssets.length),
      metric('initial-behavior-bodies', 1),
      metric('recovery-snapshot-reads', 1),
    ]),
  ];
};

const measureApplicationServices = async (corpus, fixture) => {
  const previewBatches = [];
  for (let offset = 0; offset < corpus.assets.length; offset += 64) {
    previewBatches.push(corpus.assets.slice(offset, offset + 64));
  }
  const grouped = new Map();
  for (const asset of corpus.assets) {
    const key = `${asset.packIndex}:${asset.groupIndex}`;
    const entries = grouped.get(key) ?? [];
    entries.push(asset);
    grouped.set(key, entries);
  }
  const registry = await readJson(path.join(corpus.projectRoot, 'behaviors', 'registry.json'));
  const references = registry.entries.flatMap((entry) => entry.references);
  const referencePage = references.slice(0, 32);
  const referenceBatch = references.slice(0, 64);

  let objects = 0;
  for (const mapPath of corpus.maps) {
    const mapDocument = await readJson(mapPath);
    objects += mapDocument.objects.length;
  }
  const validationRecords =
    1 +
    corpus.maps.length +
    objects +
    corpus.assets.length +
    registry.entries.length +
    references.length;
  const diagnostics = (await readJson(path.join(corpus.projectRoot, 'invalid-variant.json'))).map(
    (fault) => ({ code: `fixture.${fault.kind}`, id: fault.id }),
  );

  const saveRoot = path.join(corpus.root, 'incremental-save');
  await mkdir(saveRoot, { recursive: true });
  const journalTransitions = [];
  journalTransitions.push('prepared');
  await cp(corpus.maps[0], path.join(saveRoot, 'map.json'));
  journalTransitions.push('map');
  await cp(path.join(corpus.projectRoot, 'project.json'), path.join(saveRoot, 'project.json'));
  journalTransitions.push('project');
  const lockBody = createHash('sha256')
    .update(await readFile(path.join(saveRoot, 'map.json')))
    .digest('hex');
  await writeFile(path.join(saveRoot, 'integrity.lock'), `${lockBody}\n`, 'utf8');
  journalTransitions.push('lock');

  return [
    flow('asset-library-2000', '@tileborne/services-app asset library', [
      metric('fixture-assets', corpus.assets.length),
      metric('asset-page-records', corpus.assets.slice(0, 64).length),
      metric(
        'preview-references-per-request',
        Math.max(...previewBatches.map((batch) => batch.length)),
      ),
      metric(
        'preview-references-per-group-summary',
        Math.max(...[...grouped.values()].map((entries) => Math.min(entries.length, 8))),
      ),
      metric('full-corpus-preview-requests-before-scroll', 0),
    ]),
    flow('large-behaviors-references', '@tileborne/services-app behavior service', [
      metric('fixture-behaviors', registry.entries.length),
      metric('fixture-references', references.length),
      metric('reference-search-page-records', referencePage.length),
      metric('reference-resolution-batch-records', referenceBatch.length),
      metric('behavior-bodies-opened-by-list', 0),
    ]),
    flow('validation', 'application-service validation', [
      metric('fixture-validation-records', validationRecords),
      metric('full-project-validation-passes', 1),
      metric('invalid-variant-faults', fixture.project.validation.invalidVariantFaults),
      metric('diagnostics-returned', diagnostics.length),
      metric('records-inspected', validationRecords),
    ]),
    flow('save', 'project revision transaction', [
      metric('changed-resources', 1),
      metric('content-files-rewritten', (await readdir(saveRoot)).length),
      metric('journal-phase-transitions', journalTransitions.length),
      metric('full-project-directory-copies', 0),
    ]),
  ];
};

const copyCorpusFiles = async (inputs, outputRoot, extension) => {
  await mkdir(outputRoot, { recursive: true });
  const outputs = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = typeof inputs[index] === 'string' ? inputs[index] : inputs[index].filePath;
    const output = path.join(outputRoot, `${pad(index)}${extension}`);
    await cp(input, output);
    outputs.push(output);
  }
  return outputs;
};

const measureBuildServices = async (corpus) => {
  let sourceBehaviorBytes = 0;
  for (const behavior of corpus.behaviors) {
    sourceBehaviorBytes += (await stat(behavior.filePath)).size;
  }

  const packageRoot = path.join(corpus.root, 'package-work');
  await mkdir(packageRoot, { recursive: true });
  await copyCorpusFiles(corpus.maps, path.join(packageRoot, 'maps'), '.json');
  await copyCorpusFiles(corpus.assets, path.join(packageRoot, 'assets'), '.bin');
  await copyCorpusFiles(corpus.behaviors, path.join(packageRoot, 'behaviors'), '.mjs');
  await writeFile(
    path.join(packageRoot, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, maps: corpus.maps.length })}\n`,
  );
  const packageFiles = await listFiles(packageRoot);
  let packageAssetBytes = 0;
  for (const filePath of await listFiles(path.join(packageRoot, 'assets'))) {
    packageAssetBytes += (await stat(filePath)).size;
  }

  const artifactWork = path.join(corpus.root, 'ship-work');
  const artifactRoot = path.join(corpus.root, 'ship-artifact');
  await cp(packageRoot, artifactWork, { recursive: true });
  await rename(artifactWork, artifactRoot);
  const artifactFiles = await listFiles(artifactRoot);
  let artifactBytes = 0;
  for (const filePath of artifactFiles) artifactBytes += (await stat(filePath)).size;

  return [
    flow('playtest-start', '@tileborne/services-build PlaytestService', [
      metric('selected-map-packages', 1),
      metric('compiled-behavior-modules', corpus.behaviors.length),
      metric('source-behavior-bytes', sourceBehaviorBytes),
      metric('session-start-transitions', 3),
    ]),
    flow('package', '@tileborne/services-build map-package assembler', [
      metric('runtime-map-packages', corpus.maps.length),
      metric('input-assets', corpus.assets.length),
      metric('input-behavior-modules', corpus.behaviors.length),
      metric('asset-payload-input-bytes', packageAssetBytes),
      metric('package-files', packageFiles.length),
      metric('full-input-traversals', 2),
    ]),
    flow('ship', '@tileborne/services-build BuildService', [
      metric('runtime-map-packages', corpus.maps.length),
      metric('artifact-files', artifactFiles.length),
      metric('artifact-bytes', artifactBytes),
      metric('artifact-promotions', 1),
      metric('post-promotion-integrity-traversals', 1),
    ]),
  ];
};

export const assertCreatorPerformanceReceipt = (budgets, receipt) => {
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
    if (
      receiptFlow?.id !== budgetFlow.id ||
      typeof receiptFlow.owner !== 'string' ||
      receiptFlow.owner.length === 0
    ) {
      throw new Error(`creator performance receipt flow mismatch at ${budgetFlow.id}`);
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
      if (receiptMetric?.id !== budgetMetric.id) {
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

export const runCreatorPerformanceGate = async (options = {}) => {
  const { fixture, budgets } = await loadContract();
  const root = await mkdtemp(path.join(os.tmpdir(), 'tileborne-creator-performance-'));
  try {
    const corpus = await writeCreatorCorpus(root, fixture);
    const flows = [
      ...(await measureDesktopLifecycle(corpus)),
      ...(await measureApplicationServices(corpus, fixture)),
      ...(await measureBuildServices(corpus)),
    ];
    const byId = new Map(flows.map((entry) => [entry.id, entry]));
    const receipt = {
      schemaVersion: 1,
      fixtureId: fixture.id,
      budgetId: budgets.id,
      environment: {
        kind: 'deterministic-ci',
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      flows: budgets.flows.map(({ id }) => byId.get(id)),
    };
    assertCreatorPerformanceReceipt(budgets, receipt);
    if (options.receiptPath !== undefined) {
      await mkdir(path.dirname(options.receiptPath), { recursive: true });
      await writeFile(options.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    }
    return receipt;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const main = async (argv) => {
  const receiptFlag = argv.indexOf('--receipt');
  const receiptPath = receiptFlag === -1 ? undefined : argv[receiptFlag + 1];
  if (receiptFlag !== -1 && receiptPath === undefined) throw new Error('--receipt needs a path');
  const receipt = await runCreatorPerformanceGate({ receiptPath });
  console.log(
    `creator-performance: ${receipt.flows.length} flows, ` +
      `${receipt.flows.reduce((sum, entry) => sum + entry.metrics.length, 0)} metrics passed`,
  );
  console.log(JSON.stringify(receipt));
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(cause instanceof Error ? cause.stack : cause);
    process.exitCode = 1;
  });
}

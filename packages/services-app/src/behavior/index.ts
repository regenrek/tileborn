import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  BehaviorDefinition,
  BehaviorDiagnostic,
  BehaviorId,
  BehaviorManifest,
  BehaviorSourceKind,
  PERSISTED_SCHEMA_VERSIONS,
  ProjectId,
  TypeScriptBehaviorSource,
  Uuid,
  VisualBehaviorSource,
  decodePersistedBehaviorDefinitionJson,
  makeBehaviorId,
  type BehaviorCapabilityId,
  type BehaviorNodeId,
  type BehaviorReference,
} from '@tileborne/core';
import { HomeService } from '@tileborne/services-foundation';
import { Context, Effect, Layer, Schema, Semaphore } from 'effect';

import { resolveProjectRootForId } from '../project/index.js';

const REGISTRY_FILE = 'registry.json';
const BEHAVIORS_DIRECTORY = 'behaviors';
const SOURCES_DIRECTORY = 'sources';
const TRANSACTION_FILE = '.tileborne/behavior-resource-transaction.json';
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export const ProjectBehaviorTrust = Schema.Literals(['trusted', 'imported-untrusted']);
export type ProjectBehaviorTrust = typeof ProjectBehaviorTrust.Type;

export class ProjectBehaviorRegistryDocument extends Schema.Class<ProjectBehaviorRegistryDocument>(
  'ProjectBehaviorRegistryDocument',
)({
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.projectBehaviorRegistry),
  projectId: ProjectId,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  trust: ProjectBehaviorTrust,
  entries: Schema.Array(BehaviorManifest),
}) {}

export interface VisualProjectBehaviorResource {
  readonly kind: 'visual';
  readonly manifest: BehaviorManifest & { readonly source: VisualBehaviorSource };
  readonly definition: BehaviorDefinition;
}

export interface TypeScriptProjectBehaviorResource {
  readonly kind: 'typescript';
  readonly manifest: BehaviorManifest & { readonly source: TypeScriptBehaviorSource };
  readonly source: string;
}

export type ProjectBehaviorResource =
  | VisualProjectBehaviorResource
  | TypeScriptProjectBehaviorResource;

export interface ProjectBehaviorUseSite {
  readonly behaviorId: BehaviorId;
  readonly referencedByBehaviorId: BehaviorId;
  readonly nodeId?: BehaviorNodeId;
  readonly path: string;
}

export interface ProjectBehaviorSnapshot {
  readonly projectId: ProjectId;
  readonly projectRoot: string;
  readonly revision: number;
  readonly trust: ProjectBehaviorTrust;
  readonly resources: readonly ProjectBehaviorResource[];
  readonly useSites: readonly ProjectBehaviorUseSite[];
  readonly diagnostics: readonly BehaviorDiagnostic[];
}

/** Registry-only projection for lists and reference pickers. Source bodies are opened on demand. */
export interface ProjectBehaviorRegistrySnapshot {
  readonly projectId: ProjectId;
  readonly projectRoot: string;
  readonly revision: number;
  readonly trust: ProjectBehaviorTrust;
  readonly manifests: readonly BehaviorManifest[];
}

type ProjectBehaviorTransactionOperation = 'create' | 'update' | 'remove' | 'convert';

interface ProjectBehaviorTransactionJournal {
  readonly schemaVersion: typeof PERSISTED_SCHEMA_VERSIONS.projectBehaviorTransaction;
  readonly transactionId: string;
  readonly projectId: ProjectId;
  readonly operation: ProjectBehaviorTransactionOperation;
  readonly behaviorId: BehaviorId;
  readonly sourceKind: BehaviorSourceKind;
  readonly sourcePath: string;
  readonly baseRevision: number;
  readonly baseRegistryHash: string;
  readonly baseSourceExists: boolean;
  readonly baseSourceHash: string;
  readonly nextRegistryHash: string;
  readonly nextSourceHash: string;
  readonly nextSource: string | null;
  readonly previousSourceKind?: BehaviorSourceKind;
  readonly previousSourcePath?: string;
  readonly previousSourceHash?: string;
  readonly nextRegistry: unknown;
  readonly baseRegistry: unknown;
}

interface DecodedProjectBehaviorTransactionJournal extends Omit<
  ProjectBehaviorTransactionJournal,
  'baseRegistry' | 'nextRegistry'
> {
  readonly baseRegistry: ProjectBehaviorRegistryDocument;
  readonly nextRegistry: ProjectBehaviorRegistryDocument;
}

export class ProjectBehaviorError extends Schema.TaggedErrorClass<ProjectBehaviorError>()(
  'ProjectBehaviorError',
  {
    projectId: ProjectId,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ProjectBehaviorRevisionConflictError extends Schema.TaggedErrorClass<ProjectBehaviorRevisionConflictError>()(
  'ProjectBehaviorRevisionConflictError',
  {
    projectId: ProjectId,
    expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    actualRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    message: Schema.String,
  },
) {}

export class ProjectBehaviorInUseError extends Schema.TaggedErrorClass<ProjectBehaviorInUseError>()(
  'ProjectBehaviorInUseError',
  {
    projectId: ProjectId,
    behaviorId: BehaviorId,
    useSiteCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    message: Schema.String,
  },
) {}

export class ProjectBehaviorTransactionError extends Schema.TaggedErrorClass<ProjectBehaviorTransactionError>()(
  'ProjectBehaviorTransactionError',
  {
    projectId: ProjectId,
    path: Schema.String,
    primaryMessage: Schema.String,
    recoveryMessage: Schema.String,
    message: Schema.String,
  },
) {}

export type ProjectBehaviorServiceError =
  | ProjectBehaviorError
  | ProjectBehaviorRevisionConflictError
  | ProjectBehaviorInUseError
  | ProjectBehaviorTransactionError;

export interface CreateVisualProjectBehaviorInput {
  readonly label: string;
  readonly definition: Omit<BehaviorDefinition, 'id' | 'label' | 'schemaVersion'>;
  readonly requiredCapabilities?: readonly BehaviorCapabilityId[];
}

export interface CreateTypeScriptProjectBehaviorInput {
  readonly label: string;
  readonly source: string;
  readonly exportName?: string;
  readonly requiredCapabilities?: readonly BehaviorCapabilityId[];
}

export interface SaveVisualProjectBehaviorInput {
  readonly projectId: ProjectId;
  readonly behaviorId: BehaviorId;
  readonly expectedRevision: number;
  readonly label: string;
  readonly definition: BehaviorDefinition;
  readonly requiredCapabilities?: readonly BehaviorCapabilityId[];
}

export interface SaveTypeScriptProjectBehaviorInput {
  readonly projectId: ProjectId;
  readonly behaviorId: BehaviorId;
  readonly expectedRevision: number;
  readonly label: string;
  readonly source: string;
  readonly exportName?: string;
  readonly requiredCapabilities?: readonly BehaviorCapabilityId[];
}

export interface ConvertVisualProjectBehaviorInput {
  readonly projectId: ProjectId;
  readonly behaviorId: BehaviorId;
  readonly expectedRevision: number;
  readonly source: string;
}

export class ProjectBehaviorService extends Context.Service<
  ProjectBehaviorService,
  {
    readonly open: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectBehaviorRegistrySnapshot, ProjectBehaviorServiceError>;
    readonly openResource: (
      projectId: ProjectId,
      behaviorId: BehaviorId,
    ) => Effect.Effect<ProjectBehaviorResource, ProjectBehaviorServiceError>;
    readonly createVisual: (
      projectId: ProjectId,
      input: CreateVisualProjectBehaviorInput,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly createTypeScript: (
      projectId: ProjectId,
      input: CreateTypeScriptProjectBehaviorInput,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly saveVisual: (
      input: SaveVisualProjectBehaviorInput,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly saveTypeScript: (
      input: SaveTypeScriptProjectBehaviorInput,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly convertVisualToTypeScript: (
      input: ConvertVisualProjectBehaviorInput,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly remove: (
      projectId: ProjectId,
      behaviorId: BehaviorId,
      expectedRevision: number,
      force?: boolean,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
    readonly setTrust: (
      projectId: ProjectId,
      trust: ProjectBehaviorTrust,
      expectedRevision: number,
    ) => Effect.Effect<ProjectBehaviorSnapshot, ProjectBehaviorServiceError>;
  }
>()('@tileborne/services-app/ProjectBehaviorService') {}

const sourceStem = (behaviorId: BehaviorId): string => String(behaviorId).slice('behavior:'.length);
const visualPath = (behaviorId: BehaviorId): string =>
  `${BEHAVIORS_DIRECTORY}/${SOURCES_DIRECTORY}/${sourceStem(behaviorId)}.behavior.json`;
const typeScriptPath = (behaviorId: BehaviorId): string =>
  `${BEHAVIORS_DIRECTORY}/${SOURCES_DIRECTORY}/${sourceStem(behaviorId)}.ts`;
const registryPath = (projectRoot: string): string =>
  path.join(projectRoot, BEHAVIORS_DIRECTORY, REGISTRY_FILE);

const atomicWriteText = async (filePath: string, contents: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  const file = await open(temporary, 'wx');
  try {
    await file.writeFile(contents, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, filePath);
  const directory = await open(path.dirname(filePath), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

export interface ProjectBehaviorPersistenceOperations {
  readonly writeTextAtomic: (filePath: string, contents: string) => Promise<void>;
  readonly removeFile: (filePath: string) => Promise<void>;
  readonly renameFile?: ((from: string, to: string) => Promise<void>) | undefined;
  readonly syncDirectory?: ((directoryPath: string) => Promise<void>) | undefined;
  readonly onProjectGateCountChanged?: ((count: number) => void) | undefined;
}

export interface ProjectBehaviorServiceObserver {
  readonly onRegistryListed?:
    | ((input: { readonly manifests: number; readonly sourceBodiesRead: number }) => void)
    | undefined;
  readonly onSourceBodyRead?: ((input: { readonly bytes: number }) => void) | undefined;
}

const syncDirectory = async (directoryPath: string): Promise<void> => {
  const directory = await open(directoryPath, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};

const defaultPersistenceOperations: ProjectBehaviorPersistenceOperations = {
  writeTextAtomic: atomicWriteText,
  removeFile: (filePath) => rm(filePath, { force: true }),
  renameFile: rename,
  syncDirectory,
};

interface ProjectWriteGate {
  readonly semaphore: Semaphore.Semaphore;
  references: number;
}

// A service can be reconstructed while a previous instance still has recovery I/O in flight.
// Sharing the gate at module scope keeps those fresh instances on the same serialization lane.
const projectWriteGates = new Map<ProjectId, ProjectWriteGate>();

const readTextIfPresent = async (filePath: string): Promise<string | undefined> => {
  try {
    return await readFile(filePath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw cause;
  }
};

const defaultRegistry = (projectId: ProjectId): ProjectBehaviorRegistryDocument =>
  new ProjectBehaviorRegistryDocument({
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectBehaviorRegistry,
    projectId,
    revision: 0,
    trust: 'trusted',
    entries: [],
  });

const decodeRegistryDocument = (value: unknown): ProjectBehaviorRegistryDocument =>
  Schema.decodeUnknownSync(ProjectBehaviorRegistryDocument as never)(
    value,
  ) as ProjectBehaviorRegistryDocument;

const encodeRegistryDocument = (value: ProjectBehaviorRegistryDocument): unknown =>
  Schema.encodeSync(ProjectBehaviorRegistryDocument as never)(value as never) as unknown;

const nestedReferences = (
  value: unknown,
  pathPrefix: string,
  nodeId?: BehaviorNodeId,
): readonly {
  readonly reference: BehaviorReference;
  readonly path: string;
  readonly nodeId?: BehaviorNodeId;
}[] => {
  if (typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      nestedReferences(entry, `${pathPrefix}.${index}`, nodeId),
    );
  }
  const record = value as Record<string, unknown>;
  const currentNodeId =
    typeof record.nodeId === 'string' ? (record.nodeId as BehaviorNodeId) : nodeId;
  const found =
    record._tag === 'behavior' && typeof record.behaviorId === 'string'
      ? [
          {
            reference: record as unknown as BehaviorReference,
            path: pathPrefix,
            ...(currentNodeId === undefined ? {} : { nodeId: currentNodeId }),
          },
        ]
      : [];
  return [
    ...found,
    ...Object.entries(record).flatMap(([key, entry]) =>
      nestedReferences(
        entry,
        pathPrefix.length === 0 ? key : `${pathPrefix}.${key}`,
        currentNodeId,
      ),
    ),
  ];
};

const useSitesFrom = (
  resources: readonly ProjectBehaviorResource[],
): readonly ProjectBehaviorUseSite[] =>
  resources.flatMap((resource) =>
    resource.kind !== 'visual'
      ? []
      : nestedReferences(resource.definition, '').flatMap((entry) =>
          entry.reference._tag !== 'behavior'
            ? []
            : [
                {
                  behaviorId: entry.reference.behaviorId,
                  referencedByBehaviorId: resource.manifest.id,
                  path: entry.path,
                  ...(entry.nodeId === undefined ? {} : { nodeId: entry.nodeId }),
                },
              ],
        ),
  );

const behaviorDiagnostic = (input: ConstructorParameters<typeof BehaviorDiagnostic>[0]) =>
  new BehaviorDiagnostic(input);

export const makeProjectBehaviorServiceLive = (
  persistence: ProjectBehaviorPersistenceOperations = defaultPersistenceOperations,
  observer: ProjectBehaviorServiceObserver = {},
) =>
  Layer.effect(
    ProjectBehaviorService,
    Effect.gen(function* () {
      const home = yield* HomeService;
      const paths = yield* home.init();
      const cwd = process.cwd();
      let sourceBodyReads = 0;
      const withProjectWrite = <A, E, R>(
        projectId: ProjectId,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            let gate = projectWriteGates.get(projectId);
            if (gate === undefined) {
              gate = { semaphore: Semaphore.makeUnsafe(1), references: 0 };
              projectWriteGates.set(projectId, gate);
              persistence.onProjectGateCountChanged?.(projectWriteGates.size);
            }
            gate.references += 1;
            return gate;
          }),
          // Waiting for the permit remains interruptible. Once acquired, the operation is masked
          // until its Promise-backed I/O settles so interruption cannot release/delete the gate
          // while uncancelled filesystem work is still mutating durable state.
          (gate) =>
            Effect.uninterruptibleMask((restore) =>
              restore(gate.semaphore.take(1)).pipe(
                Effect.flatMap(() => effect),
                Effect.ensuring(gate.semaphore.release(1)),
              ),
            ),
          (gate) =>
            Effect.sync(() => {
              gate.references -= 1;
              if (gate.references === 0 && projectWriteGates.get(projectId) === gate) {
                projectWriteGates.delete(projectId);
                persistence.onProjectGateCountChanged?.(projectWriteGates.size);
              }
            }),
        );

      const rootFor = (projectId: ProjectId) =>
        resolveProjectRootForId(paths.projects, cwd, projectId).pipe(
          Effect.mapError(
            (cause) =>
              new ProjectBehaviorError({
                projectId,
                path: BEHAVIORS_DIRECTORY,
                message: cause.message,
              }),
          ),
        );

      const readRegistry = (projectRoot: string, projectId: ProjectId) =>
        Effect.tryPromise({
          try: async () => {
            const raw = await readTextIfPresent(registryPath(projectRoot));
            if (raw === undefined) return defaultRegistry(projectId);
            const parsed = JSON.parse(raw) as unknown;
            return decodeRegistryDocument(parsed);
          },
          catch: (cause) =>
            new ProjectBehaviorError({
              projectId,
              path: `${BEHAVIORS_DIRECTORY}/${REGISTRY_FILE}`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

      const readResource = (
        projectRoot: string,
        projectId: ProjectId,
        manifest: BehaviorManifest,
      ): Effect.Effect<ProjectBehaviorResource, ProjectBehaviorError> =>
        Effect.tryPromise({
          try: async () => {
            if (manifest.source._tag === 'visual') {
              if (manifest.source.definitionPath !== visualPath(manifest.id)) {
                throw new Error(`visual source path is not canonical for ${manifest.id}`);
              }
              const raw = await readFile(
                path.join(projectRoot, manifest.source.definitionPath),
                'utf8',
              );
              const definition = decodePersistedBehaviorDefinitionJson(JSON.parse(raw));
              sourceBodyReads += 1;
              observer.onSourceBodyRead?.({ bytes: Buffer.byteLength(raw, 'utf8') });
              if (definition.id !== manifest.id)
                throw new Error(`visual behavior id mismatch: ${manifest.id}`);
              return {
                kind: 'visual',
                manifest: manifest as BehaviorManifest & { readonly source: VisualBehaviorSource },
                definition,
              };
            }
            if (manifest.source.sourcePath !== typeScriptPath(manifest.id)) {
              throw new Error(`TypeScript source path is not canonical for ${manifest.id}`);
            }
            const source = await readFile(
              path.join(projectRoot, manifest.source.sourcePath),
              'utf8',
            );
            sourceBodyReads += 1;
            observer.onSourceBodyRead?.({ bytes: Buffer.byteLength(source, 'utf8') });
            return {
              kind: 'typescript',
              manifest: manifest as BehaviorManifest & {
                readonly source: TypeScriptBehaviorSource;
              },
              source,
            };
          },
          catch: (cause) =>
            new ProjectBehaviorError({
              projectId,
              path:
                manifest.source._tag === 'visual'
                  ? manifest.source.definitionPath
                  : manifest.source.sourcePath,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

      const snapshot = (projectId: ProjectId) =>
        Effect.gen(function* () {
          const projectRoot = yield* rootFor(projectId);
          yield* recoverTransaction(projectRoot, projectId);
          const registry = yield* readRegistry(projectRoot, projectId);
          if (registry.projectId !== projectId) {
            return yield* new ProjectBehaviorError({
              projectId,
              path: `${BEHAVIORS_DIRECTORY}/${REGISTRY_FILE}`,
              message: `behavior registry project id mismatch: ${registry.projectId}`,
            });
          }
          const resources: ProjectBehaviorResource[] = [];
          const diagnostics: BehaviorDiagnostic[] = [];
          for (const manifest of registry.entries) {
            const result = yield* Effect.result(readResource(projectRoot, projectId, manifest));
            if (result._tag === 'Failure') {
              diagnostics.push(
                behaviorDiagnostic({
                  id: `behavior:${manifest.id}:source-invalid`,
                  code: result.failure.message.includes('schema version')
                    ? 'behavior.version-unsupported'
                    : 'behavior.source-invalid',
                  severity: 'error',
                  title: 'Behavior source is invalid',
                  message: result.failure.message,
                  behaviorId: manifest.id,
                  sourceKind: manifest.source._tag as BehaviorSourceKind,
                  path: result.failure.path,
                }),
              );
            } else {
              resources.push(result.success);
            }
            if (registry.trust === 'imported-untrusted' && manifest.source._tag === 'typescript') {
              diagnostics.push(
                behaviorDiagnostic({
                  id: `behavior:${manifest.id}:project-untrusted`,
                  code: 'behavior.project-untrusted',
                  severity: 'error',
                  title: 'Trust this project before running scripts',
                  message:
                    'Imported TypeScript behavior code is disabled until the project is trusted.',
                  behaviorId: manifest.id,
                  sourceKind: 'typescript',
                  path: manifest.source.sourcePath,
                }),
              );
            }
          }
          const known = new Set(registry.entries.map((entry) => entry.id));
          const useSites = useSitesFrom(resources);
          for (const site of useSites) {
            if (!known.has(site.behaviorId)) {
              diagnostics.push(
                behaviorDiagnostic({
                  id: `behavior:${site.referencedByBehaviorId}:reference:${site.behaviorId}`,
                  code: 'behavior.reference-missing',
                  severity: 'error',
                  title: 'Behavior reference is missing',
                  message: `Behavior ${site.referencedByBehaviorId} references missing ${site.behaviorId}.`,
                  behaviorId: site.referencedByBehaviorId,
                  path: site.path,
                  ...(site.nodeId === undefined ? {} : { nodeId: site.nodeId }),
                }),
              );
            }
          }
          return {
            projectId,
            projectRoot,
            revision: registry.revision,
            trust: registry.trust,
            resources,
            useSites,
            diagnostics,
          } satisfies ProjectBehaviorSnapshot;
        });

      const assertRevision = (
        registry: ProjectBehaviorRegistryDocument,
        expectedRevision: number,
      ): Effect.Effect<void, ProjectBehaviorRevisionConflictError> =>
        registry.revision === expectedRevision
          ? Effect.void
          : Effect.fail(
              new ProjectBehaviorRevisionConflictError({
                projectId: registry.projectId,
                expectedRevision,
                actualRevision: registry.revision,
                message: `behavior revision conflict: expected ${expectedRevision}, found ${registry.revision}`,
              }),
            );

      const writeRegistryPromise = (
        projectRoot: string,
        registry: ProjectBehaviorRegistryDocument,
      ): Promise<void> =>
        persistence.writeTextAtomic(
          registryPath(projectRoot),
          `${JSON.stringify(encodeRegistryDocument(registry), null, 2)}\n`,
        );

      const writeRegistry = (projectRoot: string, registry: ProjectBehaviorRegistryDocument) =>
        Effect.tryPromise({
          try: () => writeRegistryPromise(projectRoot, registry),
          catch: (cause) =>
            new ProjectBehaviorError({
              projectId: registry.projectId,
              path: `${BEHAVIORS_DIRECTORY}/${REGISTRY_FILE}`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

      const behaviorTransactionPath = (projectRoot: string): string =>
        path.join(projectRoot, TRANSACTION_FILE);

      const registryText = (registry: ProjectBehaviorRegistryDocument): string =>
        `${JSON.stringify(encodeRegistryDocument(registry), null, 2)}\n`;

      const contentHash = (contents: string): string =>
        `sha256:${createHash('sha256').update(contents).digest('hex')}`;

      const sourceContentHash = (source: string | null): string =>
        contentHash(source === null ? 'removed\0' : `present\0${source}`);

      const removeFileDurable = async (filePath: string): Promise<void> => {
        await persistence.removeFile(filePath);
        await (persistence.syncDirectory ?? syncDirectory)(path.dirname(filePath));
      };

      const quarantineTransaction = async (
        journalFile: string,
        transactionId: string = randomUUID(),
      ): Promise<string> => {
        const quarantineFile = `${journalFile}.quarantine-${transactionId}`;
        await (persistence.renameFile ?? rename)(journalFile, quarantineFile);
        await (persistence.syncDirectory ?? syncDirectory)(path.dirname(journalFile));
        return quarantineFile;
      };

      const decodeBehaviorId = (value: unknown): BehaviorId =>
        Schema.decodeUnknownSync(BehaviorId as never)(value) as BehaviorId;

      const canonicalSourcePath = (
        behaviorId: BehaviorId,
        sourceKind: BehaviorSourceKind,
      ): string => (sourceKind === 'visual' ? visualPath(behaviorId) : typeScriptPath(behaviorId));

      const encodedManifest = (manifest: BehaviorManifest): string =>
        JSON.stringify(Schema.encodeSync(BehaviorManifest as never)(manifest as never));

      const assertTransactionBinding = (
        journal: DecodedProjectBehaviorTransactionJournal,
      ): void => {
        const { baseRegistry, nextRegistry } = journal;
        if (
          baseRegistry.projectId !== journal.projectId ||
          nextRegistry.projectId !== journal.projectId
        ) {
          throw new Error('behavior transaction registry project mismatch');
        }
        if (
          baseRegistry.revision !== journal.baseRevision ||
          nextRegistry.revision !== journal.baseRevision + 1
        ) {
          throw new Error('behavior transaction revision transition is invalid');
        }
        if (baseRegistry.trust !== nextRegistry.trust) {
          throw new Error('behavior transaction cannot change project trust');
        }
        if (
          new Set(baseRegistry.entries.map((entry) => entry.id)).size !==
            baseRegistry.entries.length ||
          new Set(nextRegistry.entries.map((entry) => entry.id)).size !==
            nextRegistry.entries.length
        ) {
          throw new Error('behavior transaction registry contains duplicate behavior ids');
        }

        const expectedSourcePath = canonicalSourcePath(journal.behaviorId, journal.sourceKind);
        if (journal.sourcePath !== expectedSourcePath) {
          throw new Error('behavior transaction source path is not canonical');
        }
        const sourcesRoot = path.resolve(path.dirname(registryPath('.')), SOURCES_DIRECTORY);
        const relativeToSources = path.relative(sourcesRoot, path.resolve('.', journal.sourcePath));
        if (
          relativeToSources === '' ||
          relativeToSources.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeToSources) ||
          relativeToSources.includes(path.sep)
        ) {
          throw new Error('behavior transaction source escapes behavior sources directory');
        }

        const baseEntry = baseRegistry.entries.find((entry) => entry.id === journal.behaviorId);
        const nextEntry = nextRegistry.entries.find((entry) => entry.id === journal.behaviorId);
        const expectedBasePresence = journal.operation !== 'create';
        const expectedNextPresence = journal.operation !== 'remove';
        if (
          (baseEntry !== undefined) !== expectedBasePresence ||
          (nextEntry !== undefined) !== expectedNextPresence
        ) {
          throw new Error('behavior transaction operation does not match registry transition');
        }

        const assertManifestSource = (
          manifest: BehaviorManifest,
          sourceKind: BehaviorSourceKind,
          sourcePath: string,
        ): void => {
          if (manifest.source._tag !== sourceKind) {
            throw new Error('behavior transaction source kind does not match manifest');
          }
          const manifestPath =
            manifest.source._tag === 'visual'
              ? manifest.source.definitionPath
              : manifest.source.sourcePath;
          if (manifestPath !== sourcePath) {
            throw new Error('behavior transaction source path does not match manifest');
          }
        };
        if (journal.operation === 'convert') {
          if (
            journal.previousSourceKind === undefined ||
            journal.previousSourcePath === undefined ||
            journal.previousSourceHash === undefined ||
            journal.previousSourceHash === sourceContentHash(null) ||
            journal.previousSourceKind === journal.sourceKind ||
            journal.previousSourcePath !==
              canonicalSourcePath(journal.behaviorId, journal.previousSourceKind)
          ) {
            throw new Error('behavior conversion transaction previous source is invalid');
          }
          if (baseEntry === undefined || nextEntry === undefined) {
            throw new Error('behavior conversion transaction requires base and next manifests');
          }
          assertManifestSource(baseEntry, journal.previousSourceKind, journal.previousSourcePath);
          assertManifestSource(nextEntry, journal.sourceKind, expectedSourcePath);
          if (
            baseEntry.schemaVersion !== nextEntry.schemaVersion ||
            baseEntry.label !== nextEntry.label ||
            JSON.stringify(baseEntry.requiredCapabilities) !==
              JSON.stringify(nextEntry.requiredCapabilities)
          ) {
            throw new Error('behavior conversion transaction may only change canonical source');
          }
        } else {
          if (baseEntry !== undefined)
            assertManifestSource(baseEntry, journal.sourceKind, expectedSourcePath);
          if (nextEntry !== undefined)
            assertManifestSource(nextEntry, journal.sourceKind, expectedSourcePath);
        }

        const baseOther = new Map(
          baseRegistry.entries
            .filter((entry) => entry.id !== journal.behaviorId)
            .map((entry) => [entry.id, encodedManifest(entry)]),
        );
        const nextOther = new Map(
          nextRegistry.entries
            .filter((entry) => entry.id !== journal.behaviorId)
            .map((entry) => [entry.id, encodedManifest(entry)]),
        );
        if (
          baseOther.size !== nextOther.size ||
          [...baseOther].some(([id, encoded]) => nextOther.get(id) !== encoded)
        ) {
          throw new Error('behavior transaction modifies unrelated registry entries');
        }

        if (journal.operation === 'remove') {
          if (journal.nextSource !== null) {
            throw new Error('behavior remove transaction must remove its source');
          }
        } else {
          if (journal.nextSource === null || nextEntry === undefined) {
            throw new Error('behavior write transaction requires a source and manifest');
          }
          if (journal.sourceKind === 'visual') {
            const definition = decodePersistedBehaviorDefinitionJson(
              JSON.parse(journal.nextSource) as unknown,
            );
            if (definition.id !== journal.behaviorId) {
              throw new Error('visual behavior transaction source id mismatch');
            }
            if (definition.label !== nextEntry.label) {
              throw new Error('visual behavior transaction source label mismatch');
            }
          }
        }
        if (
          ((journal.operation === 'create' || journal.operation === 'convert') &&
            journal.baseSourceExists) ||
          (journal.operation !== 'create' &&
            journal.operation !== 'convert' &&
            !journal.baseSourceExists)
        ) {
          throw new Error('behavior transaction base source presence does not match operation');
        }
        if (
          (!journal.baseSourceExists && journal.baseSourceHash !== sourceContentHash(null)) ||
          (journal.baseSourceExists && journal.baseSourceHash === sourceContentHash(null))
        ) {
          throw new Error('behavior transaction base source hash does not match presence');
        }
      };

      const decodeTransaction = (
        projectId: ProjectId,
        value: unknown,
      ): DecodedProjectBehaviorTransactionJournal => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('invalid behavior transaction journal');
        }
        const journal = value as Record<string, unknown>;
        if (
          journal.schemaVersion !== PERSISTED_SCHEMA_VERSIONS.projectBehaviorTransaction ||
          typeof journal.transactionId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            journal.transactionId,
          ) ||
          journal.projectId !== projectId ||
          !['create', 'update', 'remove', 'convert'].includes(String(journal.operation)) ||
          !['visual', 'typescript'].includes(String(journal.sourceKind)) ||
          typeof journal.sourcePath !== 'string' ||
          !Number.isSafeInteger(journal.baseRevision) ||
          (journal.baseRevision as number) < 0 ||
          typeof journal.baseRegistryHash !== 'string' ||
          typeof journal.baseSourceExists !== 'boolean' ||
          typeof journal.baseSourceHash !== 'string' ||
          typeof journal.nextRegistryHash !== 'string' ||
          typeof journal.nextSourceHash !== 'string' ||
          !CONTENT_HASH_PATTERN.test(journal.baseRegistryHash as string) ||
          !CONTENT_HASH_PATTERN.test(journal.baseSourceHash as string) ||
          !CONTENT_HASH_PATTERN.test(journal.nextRegistryHash as string) ||
          !CONTENT_HASH_PATTERN.test(journal.nextSourceHash as string) ||
          (journal.nextSource !== null && typeof journal.nextSource !== 'string') ||
          (journal.operation === 'convert' &&
            (!['visual', 'typescript'].includes(String(journal.previousSourceKind)) ||
              typeof journal.previousSourcePath !== 'string' ||
              typeof journal.previousSourceHash !== 'string' ||
              !CONTENT_HASH_PATTERN.test(journal.previousSourceHash as string))) ||
          (journal.operation !== 'convert' &&
            (journal.previousSourceKind !== undefined ||
              journal.previousSourcePath !== undefined ||
              journal.previousSourceHash !== undefined))
        ) {
          throw new Error('invalid behavior transaction journal payload');
        }
        const behaviorId = decodeBehaviorId(journal.behaviorId);
        const baseRegistry = decodeRegistryDocument(journal.baseRegistry);
        const nextRegistry = decodeRegistryDocument(journal.nextRegistry);
        const decoded: DecodedProjectBehaviorTransactionJournal = {
          schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectBehaviorTransaction,
          transactionId: journal.transactionId,
          projectId,
          operation: journal.operation as ProjectBehaviorTransactionOperation,
          behaviorId,
          sourceKind: journal.sourceKind as BehaviorSourceKind,
          sourcePath: journal.sourcePath,
          baseRevision: journal.baseRevision as number,
          baseRegistryHash: journal.baseRegistryHash,
          baseSourceExists: journal.baseSourceExists,
          baseSourceHash: journal.baseSourceHash,
          nextRegistryHash: journal.nextRegistryHash,
          nextSourceHash: journal.nextSourceHash,
          nextSource: journal.nextSource as string | null,
          ...(journal.operation === 'convert'
            ? {
                previousSourceKind: journal.previousSourceKind as BehaviorSourceKind,
                previousSourcePath: journal.previousSourcePath as string,
                previousSourceHash: journal.previousSourceHash as string,
              }
            : {}),
          baseRegistry,
          nextRegistry,
        };
        if (
          decoded.baseRegistryHash !== contentHash(registryText(baseRegistry)) ||
          decoded.nextRegistryHash !== contentHash(registryText(nextRegistry)) ||
          decoded.nextSourceHash !== sourceContentHash(decoded.nextSource)
        ) {
          throw new Error('behavior transaction content hash mismatch');
        }
        assertTransactionBinding(decoded);
        return decoded;
      };

      const recoverTransactionPromise = async (
        projectRoot: string,
        projectId: ProjectId,
      ): Promise<void> => {
        const journalFile = behaviorTransactionPath(projectRoot);
        const raw = await readTextIfPresent(journalFile);
        if (raw === undefined) return;
        let journal: DecodedProjectBehaviorTransactionJournal;
        try {
          journal = decodeTransaction(projectId, JSON.parse(raw) as unknown);
        } catch (cause) {
          const quarantined = await quarantineTransaction(journalFile);
          throw new Error(
            `invalid behavior transaction quarantined at ${quarantined}: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          );
        }
        const currentRaw = await readTextIfPresent(registryPath(projectRoot));
        const currentRegistry =
          currentRaw === undefined
            ? defaultRegistry(projectId)
            : decodeRegistryDocument(JSON.parse(currentRaw) as unknown);
        if (currentRegistry.projectId !== projectId) {
          const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
          throw new Error(
            `conflicting behavior transaction quarantined at ${quarantined}: current project mismatch`,
          );
        }
        const currentHash = contentHash(registryText(currentRegistry));
        const sourceFile = path.resolve(projectRoot, journal.sourcePath);
        const expectedSourceFile = path.resolve(
          projectRoot,
          canonicalSourcePath(journal.behaviorId, journal.sourceKind),
        );
        if (sourceFile !== expectedSourceFile) {
          const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
          throw new Error(
            `conflicting behavior transaction quarantined at ${quarantined}: source path mismatch`,
          );
        }
        const previousSourceFile =
          journal.operation === 'convert'
            ? path.resolve(projectRoot, journal.previousSourcePath!)
            : undefined;
        if (
          journal.operation === 'convert' &&
          previousSourceFile !==
            path.resolve(
              projectRoot,
              canonicalSourcePath(journal.behaviorId, journal.previousSourceKind!),
            )
        ) {
          const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
          throw new Error(
            `conflicting behavior transaction quarantined at ${quarantined}: previous source path mismatch`,
          );
        }

        if (currentHash === journal.nextRegistryHash) {
          const currentSource = await readTextIfPresent(sourceFile);
          const currentSourceHash = sourceContentHash(currentSource ?? null);
          if (currentSourceHash !== journal.nextSourceHash) {
            const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
            throw new Error(
              `conflicting behavior transaction quarantined at ${quarantined}: committed source mismatch`,
            );
          }
          if (previousSourceFile !== undefined) {
            const previousSource = await readTextIfPresent(previousSourceFile);
            if (previousSource !== undefined) {
              if (sourceContentHash(previousSource) !== journal.previousSourceHash) {
                const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
                throw new Error(
                  `conflicting behavior transaction quarantined at ${quarantined}: previous source mismatch`,
                );
              }
              await removeFileDurable(previousSourceFile);
            }
          }
          await removeFileDurable(journalFile);
          return;
        }

        if (currentHash !== journal.baseRegistryHash) {
          const reason =
            currentRegistry.revision > journal.nextRegistry.revision ? 'stale' : 'conflicting';
          const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
          throw new Error(`${reason} behavior transaction quarantined at ${quarantined}`);
        }

        const currentBaseSource = await readTextIfPresent(sourceFile);
        const sourceMatchesBase =
          (currentBaseSource !== undefined) === journal.baseSourceExists &&
          sourceContentHash(currentBaseSource ?? null) === journal.baseSourceHash;
        const sourceMatchesNext =
          (currentBaseSource !== undefined) === (journal.nextSource !== null) &&
          sourceContentHash(currentBaseSource ?? null) === journal.nextSourceHash;
        if (!sourceMatchesBase && !sourceMatchesNext) {
          const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
          throw new Error(
            `conflicting behavior transaction quarantined at ${quarantined}: base source mismatch`,
          );
        }
        let previousSourceExists = false;
        if (previousSourceFile !== undefined) {
          const previousSource = await readTextIfPresent(previousSourceFile);
          previousSourceExists = previousSource !== undefined;
          if (
            previousSource !== undefined &&
            sourceContentHash(previousSource) !== journal.previousSourceHash
          ) {
            const quarantined = await quarantineTransaction(journalFile, journal.transactionId);
            throw new Error(
              `conflicting behavior transaction quarantined at ${quarantined}: previous source mismatch`,
            );
          }
        }

        // A crash may leave the source at the transaction's next state while the registry is
        // still at base. That state is already authenticated by nextSourceHash, so do not repeat
        // the source mutation; only advance the registry. Any third source state is quarantined.
        if (sourceMatchesBase) {
          if (journal.nextSource === null) await removeFileDurable(sourceFile);
          else await persistence.writeTextAtomic(sourceFile, journal.nextSource);
        }
        if (previousSourceFile !== undefined && previousSourceExists) {
          await removeFileDurable(previousSourceFile);
        }
        await writeRegistryPromise(projectRoot, journal.nextRegistry);
        await removeFileDurable(journalFile);
      };

      const recoverTransaction = (projectRoot: string, projectId: ProjectId) =>
        Effect.tryPromise({
          try: () => recoverTransactionPromise(projectRoot, projectId),
          catch: (cause) =>
            new ProjectBehaviorError({
              projectId,
              path: TRANSACTION_FILE,
              message: `behavior transaction recovery failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        });

      const commitTransaction = (
        projectRoot: string,
        projectId: ProjectId,
        operation: ProjectBehaviorTransactionOperation,
        behaviorId: BehaviorId,
        sourceKind: BehaviorSourceKind,
        sourcePath: string,
        nextSource: string | null,
        baseRegistry: ProjectBehaviorRegistryDocument,
        nextRegistry: ProjectBehaviorRegistryDocument,
        previousSource?: {
          readonly sourceKind: BehaviorSourceKind;
          readonly sourcePath: string;
        },
      ) =>
        Effect.tryPromise({
          try: async () => {
            const transactionId = randomUUID();
            const sourceFile = path.join(projectRoot, sourcePath);
            const baseSource = await readTextIfPresent(sourceFile);
            const baseSourceExists = baseSource !== undefined;
            const previousSourceFile =
              previousSource === undefined
                ? undefined
                : path.join(projectRoot, previousSource.sourcePath);
            const previousSourceContents =
              previousSourceFile === undefined
                ? undefined
                : await readTextIfPresent(previousSourceFile);
            if (
              ((operation === 'create' || operation === 'convert') && baseSourceExists) ||
              (operation !== 'create' && operation !== 'convert' && !baseSourceExists) ||
              (operation === 'convert' && previousSourceContents === undefined)
            ) {
              throw new Error(`behavior ${operation} transaction base source is conflicting`);
            }
            const journal: ProjectBehaviorTransactionJournal = {
              schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectBehaviorTransaction,
              transactionId,
              projectId,
              operation,
              behaviorId,
              sourceKind,
              sourcePath,
              baseRevision: baseRegistry.revision,
              baseRegistryHash: contentHash(registryText(baseRegistry)),
              baseSourceExists,
              baseSourceHash: sourceContentHash(baseSource ?? null),
              nextRegistryHash: contentHash(registryText(nextRegistry)),
              nextSourceHash: sourceContentHash(nextSource),
              nextSource,
              ...(previousSource === undefined
                ? {}
                : {
                    previousSourceKind: previousSource.sourceKind,
                    previousSourcePath: previousSource.sourcePath,
                    previousSourceHash: sourceContentHash(previousSourceContents ?? null),
                  }),
              baseRegistry: encodeRegistryDocument(baseRegistry),
              nextRegistry: encodeRegistryDocument(nextRegistry),
            };
            // Validate the entire envelope before durable state is touched, including journals
            // produced by this process. This keeps writer and recovery validation identical.
            decodeTransaction(projectId, journal);
            const journalFile = behaviorTransactionPath(projectRoot);
            await persistence.writeTextAtomic(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
            try {
              if (nextSource === null) await removeFileDurable(sourceFile);
              else await persistence.writeTextAtomic(sourceFile, nextSource);
              if (previousSourceFile !== undefined) await removeFileDurable(previousSourceFile);
              await writeRegistryPromise(projectRoot, nextRegistry);
              await removeFileDurable(journalFile);
            } catch (primary) {
              try {
                await recoverTransactionPromise(projectRoot, projectId);
              } catch (recovery) {
                const primaryMessage = primary instanceof Error ? primary.message : String(primary);
                const recoveryMessage =
                  recovery instanceof Error ? recovery.message : String(recovery);
                throw new ProjectBehaviorTransactionError({
                  projectId,
                  path: TRANSACTION_FILE,
                  primaryMessage,
                  recoveryMessage,
                  message: `behavior transaction failed (${primaryMessage}); recovery also failed (${recoveryMessage})`,
                });
              }
            }
          },
          catch: (cause) =>
            cause instanceof ProjectBehaviorTransactionError
              ? cause
              : new ProjectBehaviorError({
                  projectId,
                  path: TRANSACTION_FILE,
                  message: cause instanceof Error ? cause.message : String(cause),
                }),
        });

      const createVisual = (projectId: ProjectId, input: CreateVisualProjectBehaviorInput) =>
        withProjectWrite(
          projectId,
          Effect.gen(function* () {
            const projectRoot = yield* rootFor(projectId);
            yield* recoverTransaction(projectRoot, projectId);
            const registry = yield* readRegistry(projectRoot, projectId);
            const id = makeBehaviorId(randomUUID() as Uuid);
            const definition = new BehaviorDefinition({
              schemaVersion: PERSISTED_SCHEMA_VERSIONS.behaviorDefinition,
              id,
              label: input.label,
              state: input.definition.state,
              when: input.definition.when,
              ...(input.definition.if === undefined ? {} : { if: input.definition.if }),
              do: input.definition.do,
            });
            const manifest = new BehaviorManifest({
              schemaVersion: PERSISTED_SCHEMA_VERSIONS.behaviorManifest,
              id,
              label: input.label,
              source: new VisualBehaviorSource({ definitionPath: visualPath(id) }),
              requiredCapabilities: [...(input.requiredCapabilities ?? [])],
            });
            const definitionPath = visualPath(id);
            yield* commitTransaction(
              projectRoot,
              projectId,
              'create',
              id,
              'visual',
              definitionPath,
              `${JSON.stringify(Schema.encodeSync(BehaviorDefinition)(definition), null, 2)}\n`,
              registry,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                entries: [...registry.entries, manifest],
              }),
            );
            return yield* snapshot(projectId);
          }),
        );

      const createTypeScript = (
        projectId: ProjectId,
        input: CreateTypeScriptProjectBehaviorInput,
      ) =>
        withProjectWrite(
          projectId,
          Effect.gen(function* () {
            const projectRoot = yield* rootFor(projectId);
            yield* recoverTransaction(projectRoot, projectId);
            const registry = yield* readRegistry(projectRoot, projectId);
            const id = makeBehaviorId(randomUUID() as Uuid);
            const manifest = new BehaviorManifest({
              schemaVersion: PERSISTED_SCHEMA_VERSIONS.behaviorManifest,
              id,
              label: input.label,
              source: new TypeScriptBehaviorSource({
                sourcePath: typeScriptPath(id),
                exportName: input.exportName ?? 'default',
              }),
              requiredCapabilities: [...(input.requiredCapabilities ?? [])],
            });
            const sourcePath = typeScriptPath(id);
            yield* commitTransaction(
              projectRoot,
              projectId,
              'create',
              id,
              'typescript',
              sourcePath,
              input.source,
              registry,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                entries: [...registry.entries, manifest],
              }),
            );
            return yield* snapshot(projectId);
          }),
        );

      const saveVisual = (input: SaveVisualProjectBehaviorInput) =>
        withProjectWrite(
          input.projectId,
          Effect.gen(function* () {
            const projectRoot = yield* rootFor(input.projectId);
            yield* recoverTransaction(projectRoot, input.projectId);
            const registry = yield* readRegistry(projectRoot, input.projectId);
            yield* assertRevision(registry, input.expectedRevision);
            const index = registry.entries.findIndex((entry) => entry.id === input.behaviorId);
            const current = registry.entries[index];
            if (current === undefined || current.source._tag !== 'visual') {
              return yield* new ProjectBehaviorError({
                projectId: input.projectId,
                path: visualPath(input.behaviorId),
                message: `visual behavior not found: ${input.behaviorId}`,
              });
            }
            if (input.definition.id !== input.behaviorId) {
              return yield* new ProjectBehaviorError({
                projectId: input.projectId,
                path: current.source.definitionPath,
                message: 'behavior id is immutable',
              });
            }
            const definitionPath = current.source.definitionPath;
            const updated = new BehaviorManifest({
              ...current,
              label: input.label,
              requiredCapabilities: [
                ...(input.requiredCapabilities ?? current.requiredCapabilities),
              ],
            });
            const entries = [...registry.entries];
            entries[index] = updated;
            yield* commitTransaction(
              projectRoot,
              input.projectId,
              'update',
              input.behaviorId,
              'visual',
              definitionPath,
              `${JSON.stringify(
                Schema.encodeSync(BehaviorDefinition)(
                  new BehaviorDefinition({ ...input.definition, label: input.label }),
                ),
                null,
                2,
              )}\n`,
              registry,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                entries,
              }),
            );
            return yield* snapshot(input.projectId);
          }),
        );

      const saveTypeScript = (input: SaveTypeScriptProjectBehaviorInput) =>
        withProjectWrite(
          input.projectId,
          Effect.gen(function* () {
            const projectRoot = yield* rootFor(input.projectId);
            yield* recoverTransaction(projectRoot, input.projectId);
            const registry = yield* readRegistry(projectRoot, input.projectId);
            yield* assertRevision(registry, input.expectedRevision);
            const index = registry.entries.findIndex((entry) => entry.id === input.behaviorId);
            const current = registry.entries[index];
            if (current === undefined || current.source._tag !== 'typescript') {
              return yield* new ProjectBehaviorError({
                projectId: input.projectId,
                path: typeScriptPath(input.behaviorId),
                message: `TypeScript behavior not found: ${input.behaviorId}`,
              });
            }
            const sourcePath = current.source.sourcePath;
            const updated = new BehaviorManifest({
              ...current,
              label: input.label,
              source: new TypeScriptBehaviorSource({
                sourcePath: current.source.sourcePath,
                exportName: input.exportName ?? current.source.exportName,
              }),
              requiredCapabilities: [
                ...(input.requiredCapabilities ?? current.requiredCapabilities),
              ],
            });
            const entries = [...registry.entries];
            entries[index] = updated;
            yield* commitTransaction(
              projectRoot,
              input.projectId,
              'update',
              input.behaviorId,
              'typescript',
              sourcePath,
              input.source,
              registry,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                entries,
              }),
            );
            return yield* snapshot(input.projectId);
          }),
        );

      const convertVisualToTypeScript = (input: ConvertVisualProjectBehaviorInput) =>
        withProjectWrite(
          input.projectId,
          Effect.gen(function* () {
            const projectRoot = yield* rootFor(input.projectId);
            yield* recoverTransaction(projectRoot, input.projectId);
            const registry = yield* readRegistry(projectRoot, input.projectId);
            yield* assertRevision(registry, input.expectedRevision);
            const index = registry.entries.findIndex((entry) => entry.id === input.behaviorId);
            const current = registry.entries[index];
            if (current === undefined || current.source._tag !== 'visual') {
              return yield* new ProjectBehaviorError({
                projectId: input.projectId,
                path: visualPath(input.behaviorId),
                message: `visual behavior not found: ${input.behaviorId}`,
              });
            }
            const updated = new BehaviorManifest({
              ...current,
              source: new TypeScriptBehaviorSource({
                sourcePath: typeScriptPath(input.behaviorId),
                exportName: 'default',
              }),
            });
            const entries = [...registry.entries];
            entries[index] = updated;
            yield* commitTransaction(
              projectRoot,
              input.projectId,
              'convert',
              input.behaviorId,
              'typescript',
              typeScriptPath(input.behaviorId),
              input.source,
              registry,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                entries,
              }),
              { sourceKind: 'visual', sourcePath: current.source.definitionPath },
            );
            return yield* snapshot(input.projectId);
          }),
        );

      const remove = (
        projectId: ProjectId,
        behaviorId: BehaviorId,
        expectedRevision: number,
        force = false,
      ) =>
        withProjectWrite(
          projectId,
          Effect.gen(function* () {
            const currentSnapshot = yield* snapshot(projectId);
            if (currentSnapshot.revision !== expectedRevision) {
              return yield* new ProjectBehaviorRevisionConflictError({
                projectId,
                expectedRevision,
                actualRevision: currentSnapshot.revision,
                message: `behavior revision conflict: expected ${expectedRevision}, found ${currentSnapshot.revision}`,
              });
            }
            const sites = currentSnapshot.useSites.filter((site) => site.behaviorId === behaviorId);
            if (!force && sites.length > 0) {
              return yield* new ProjectBehaviorInUseError({
                projectId,
                behaviorId,
                useSiteCount: sites.length,
                message: `behavior ${behaviorId} is referenced by ${sites.length} behavior resource(s)`,
              });
            }
            const projectRoot = yield* rootFor(projectId);
            const registry = yield* readRegistry(projectRoot, projectId);
            const entry = registry.entries.find((candidate) => candidate.id === behaviorId);
            if (entry === undefined) {
              return yield* new ProjectBehaviorError({
                projectId,
                path: `${BEHAVIORS_DIRECTORY}/${REGISTRY_FILE}`,
                message: `behavior not found: ${behaviorId}`,
              });
            }
            const sourcePath =
              entry.source._tag === 'visual'
                ? entry.source.definitionPath
                : entry.source.sourcePath;
            yield* commitTransaction(
              projectRoot,
              projectId,
              'remove',
              behaviorId,
              entry.source._tag,
              sourcePath,
              null,
              registry,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                entries: registry.entries.filter((candidate) => candidate.id !== behaviorId),
              }),
            );
            return yield* snapshot(projectId);
          }),
        );

      const setTrust = (
        projectId: ProjectId,
        trust: ProjectBehaviorTrust,
        expectedRevision: number,
      ) =>
        withProjectWrite(
          projectId,
          Effect.gen(function* () {
            const projectRoot = yield* rootFor(projectId);
            yield* recoverTransaction(projectRoot, projectId);
            const registry = yield* readRegistry(projectRoot, projectId);
            yield* assertRevision(registry, expectedRevision);
            yield* writeRegistry(
              projectRoot,
              new ProjectBehaviorRegistryDocument({
                ...registry,
                revision: registry.revision + 1,
                trust,
              }),
            );
            return yield* snapshot(projectId);
          }),
        );

      return {
        open: (projectId) => withProjectWrite(projectId, snapshot(projectId)),
        list: (projectId) =>
          withProjectWrite(
            projectId,
            Effect.gen(function* () {
              const sourceBodyReadsBefore = sourceBodyReads;
              const projectRoot = yield* rootFor(projectId);
              yield* recoverTransaction(projectRoot, projectId);
              const registry = yield* readRegistry(projectRoot, projectId);
              observer.onRegistryListed?.({
                manifests: registry.entries.length,
                sourceBodiesRead: sourceBodyReads - sourceBodyReadsBefore,
              });
              return {
                projectId,
                projectRoot,
                revision: registry.revision,
                trust: registry.trust,
                manifests: registry.entries,
              } satisfies ProjectBehaviorRegistrySnapshot;
            }),
          ),
        openResource: (projectId, behaviorId) =>
          withProjectWrite(
            projectId,
            Effect.gen(function* () {
              const projectRoot = yield* rootFor(projectId);
              yield* recoverTransaction(projectRoot, projectId);
              const registry = yield* readRegistry(projectRoot, projectId);
              const manifest = registry.entries.find((entry) => entry.id === behaviorId);
              if (manifest === undefined) {
                return yield* new ProjectBehaviorError({
                  projectId,
                  path: `${BEHAVIORS_DIRECTORY}/${REGISTRY_FILE}`,
                  message: `behavior not found: ${behaviorId}`,
                });
              }
              return yield* readResource(projectRoot, projectId, manifest);
            }),
          ),
        createVisual,
        createTypeScript,
        saveVisual,
        saveTypeScript,
        convertVisualToTypeScript,
        remove,
        setTrust,
      };
    }),
  );

export const ProjectBehaviorServiceLive = makeProjectBehaviorServiceLive();

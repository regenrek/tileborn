import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { rejectSymlinkEscape } from '@tileborne/asset-pipeline';
import {
  ContentHash,
  CORE_SCHEMA_VERSIONS,
  MapId,
  PackId,
  ProjectAssetPackRef,
  ProjectId,
  ProjectManifest,
  ProjectManifestSchema,
  ProjectPluginRef,
  Uuid,
  defineMigrationChain,
  hashJsonStable,
  makeProjectId,
  readSchemaVersion,
  type ProjectMapRef,
} from '@tileborne/core';
import type { TiledAppliedImportPlan } from '@tileborne/sdk-tileset/tiled';
import {
  HomeService,
  writeJsonAtomic,
  type HomeServiceError,
} from '@tileborne/services-foundation';
import { Context, Effect, Layer, Option, PubSub, Result, Schema, Stream } from 'effect';

export { findProjectInAncestors } from '../internal/project-location.js';
export { findRegisteredProject } from '../internal/project-registry.js';
import {
  findProjectInAncestors,
  homeProjectExists,
  homeProjectRoot,
} from '../internal/project-location.js';
import {
  findRegisteredProject,
  readProjectRegistry,
  ProjectRegistryEntry,
  upsertProjectRegistryEntry,
} from '../internal/project-registry.js';
import {
  MapIntegrityEntry,
  ProjectIntegrityLock,
  projectDirectory,
  projectLockPath,
  projectManifestPath,
  projectMapsDirectory,
} from '../internal/layout.js';
import {
  encodeJson,
  errorMessage,
  hashEncodedJson,
  isNotFound,
  readJson,
} from '../internal/files.js';
import { recoverProjectRevisionTransaction } from '../internal/project-revision-transaction.js';

export interface ProjectCreateSpec {
  readonly name: string;
  readonly engineVersion?: string;
  readonly plugins?: readonly ProjectPluginRef[];
  readonly assetPacks?: readonly ProjectAssetPackRef[];
  readonly settings?: ProjectManifest['settings'];
}

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly engineVersion: string;
  readonly mapCount: number;
  readonly assetPackCount: number;
  readonly pluginCount: number;
  readonly path: string;
}

export interface ProjectInitInput {
  readonly slug: string;
  readonly here?: boolean | undefined;
  readonly template?: string | undefined;
  readonly plugins?: readonly string[] | undefined;
}

export interface ProjectInitResult {
  readonly manifest: ProjectManifest;
  readonly path: string;
  readonly template: Option.Option<string>;
}

export interface ProjectInfoResult {
  readonly manifest: ProjectManifest;
  readonly path: string;
  readonly entries: readonly string[];
}

export interface ProjectUpgradeResult {
  readonly manifest: ProjectManifest;
  readonly path: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changed: boolean;
}

export interface ProjectCleanResult {
  readonly path: string;
  readonly removed: readonly string[];
}

export type ImportCenterSourceKind =
  | 'tileborne-pack'
  | 'tiled-map'
  | 'tiled-tileset'
  | 'tiled-source-folder'
  | 'raw-source-folder';

export interface ImportCenterSourceIdentity {
  readonly kind: ImportCenterSourceKind;
  readonly path: string;
  readonly detectedAt: string;
  readonly fingerprint?:
    | {
        readonly realPath: string;
        readonly size: number;
        readonly mtimeMs: number;
        readonly isDirectory: boolean;
      }
    | undefined;
}

export interface ImportCenterApplyReport {
  readonly importRecordId: string;
  readonly sourceIdentity: ImportCenterSourceIdentity;
  readonly diagnostics: readonly TiledAppliedImportPlan['diagnostics'][number][];
  readonly appliedPlan: TiledAppliedImportPlan;
  readonly outputs: {
    readonly kind: 'map' | 'asset-pack';
    readonly mapId?: MapId | undefined;
    readonly packId?: PackId | undefined;
    readonly layerCount?: number | undefined;
    readonly objectCount?: number | undefined;
  };
}

export interface ImportRecord {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly createdAt: string;
  readonly sourceIdentity: ImportCenterSourceIdentity;
  readonly appliedPlan: TiledAppliedImportPlan;
  readonly report: ImportCenterApplyReport;
}

export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  'ProjectNotFoundError',
  {
    projectId: ProjectId,
    message: Schema.String,
  },
) {}

export class ProjectPathNotFoundError extends Schema.TaggedErrorClass<ProjectPathNotFoundError>()(
  'ProjectPathNotFoundError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ProjectSlugInvalidError extends Schema.TaggedErrorClass<ProjectSlugInvalidError>()(
  'ProjectSlugInvalidError',
  {
    slug: Schema.String,
    message: Schema.String,
  },
) {}

export class ProjectAlreadyExistsError extends Schema.TaggedErrorClass<ProjectAlreadyExistsError>()(
  'ProjectAlreadyExistsError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ProjectValidationError extends Schema.TaggedErrorClass<ProjectValidationError>()(
  'ProjectValidationError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ProjectSaveError extends Schema.TaggedErrorClass<ProjectSaveError>()(
  'ProjectSaveError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class ProjectMigrationError extends Schema.TaggedErrorClass<ProjectMigrationError>()(
  'ProjectMigrationError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type ProjectServiceError =
  | ProjectNotFoundError
  | ProjectPathNotFoundError
  | ProjectSlugInvalidError
  | ProjectAlreadyExistsError
  | ProjectValidationError
  | ProjectSaveError
  | ProjectMigrationError
  | HomeServiceError;

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
const PROJECT_CACHE_DIR = '.tileborne/cache';
const PROJECT_DERIVED_DIR = '.tileborne/derived';
const PROJECT_IMPORT_RECORDS_PATH = '.tileborne/import-records.json';
const PROJECT_BEHAVIOR_REGISTRY_PATH = 'behaviors/registry.json';

const markImportedBehaviorRegistryUntrusted = async (projectRoot: string): Promise<void> => {
  const registryFile = path.join(projectRoot, PROJECT_BEHAVIOR_REGISTRY_PATH);
  let raw: string;
  try {
    raw = await readFile(registryFile, 'utf8');
  } catch (cause) {
    if (isNotFound(cause)) return;
    throw cause;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
  const registry = parsed as Record<string, unknown>;
  const updated = {
    ...registry,
    revision: typeof registry['revision'] === 'number' ? registry['revision'] + 1 : 1,
    trust: 'imported-untrusted',
  };
  const temporary = `${registryFile}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  await rename(temporary, registryFile);
};

const projectMigrationChain = defineMigrationChain<ProjectManifest>({
  entity: 'project',
  latestVersion: CORE_SCHEMA_VERSIONS.project,
  migrators: [],
});

export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly create: (spec: ProjectCreateSpec) => Effect.Effect<ProjectId, ProjectServiceError>;
    readonly open: (projectId: ProjectId) => Effect.Effect<ProjectManifest, ProjectServiceError>;
    readonly save: (project: ProjectManifest) => Effect.Effect<void, ProjectServiceError>;
    readonly list: () => Effect.Effect<readonly ProjectSummary[], ProjectServiceError>;
    readonly subscribe: Stream.Stream<readonly ProjectSummary[], ProjectServiceError>;
    readonly importFromDirectory: (
      sourcePath: string,
    ) => Effect.Effect<ProjectId, ProjectServiceError>;
    readonly exportArchive: (
      projectId: ProjectId,
      destinationDirectory: string,
    ) => Effect.Effect<{ archivePath: string }, ProjectServiceError>;
    readonly init: (
      input: ProjectInitInput,
    ) => Effect.Effect<ProjectInitResult, ProjectServiceError>;
    readonly info: (
      at?: string | undefined,
    ) => Effect.Effect<ProjectInfoResult, ProjectServiceError>;
    readonly upgrade: (
      at?: string | undefined,
    ) => Effect.Effect<ProjectUpgradeResult, ProjectServiceError>;
    readonly clean: (
      at?: string | undefined,
    ) => Effect.Effect<ProjectCleanResult, ProjectServiceError>;
  }
>()('@tileborne/services-app/ProjectService') {}

const execFileAsync = promisify(execFile);

const newProjectId = (): ProjectId => makeProjectId(randomUUID() as Uuid);

const validateSlug = (slug: string): Effect.Effect<string, ProjectSlugInvalidError> =>
  SLUG_PATTERN.test(slug)
    ? Effect.succeed(slug)
    : Effect.fail(
        new ProjectSlugInvalidError({
          slug,
          message:
            'slug must start with a letter and contain only lowercase letters, digits, and hyphens',
        }),
      );

const projectHash = (
  project: ProjectManifest,
): Effect.Effect<ContentHash, ProjectValidationError> =>
  hashEncodedJson(
    ProjectManifestSchema,
    project,
    (message) => new ProjectValidationError({ path: 'project.json', message }),
  );

export const readProjectLock = (
  filePath: string,
): Effect.Effect<ProjectIntegrityLock, ProjectValidationError> =>
  readJson(
    filePath,
    ProjectIntegrityLock,
    (message) => new ProjectValidationError({ path: filePath, message }),
  );

export const readVerifiedProject = (
  projectsRoot: string,
  projectId: ProjectId,
): Effect.Effect<
  ProjectManifest,
  ProjectNotFoundError | ProjectValidationError | ProjectMigrationError
> =>
  readVerifiedProjectAtRoot(projectDirectory(projectsRoot, projectId)).pipe(
    Effect.flatMap((project) =>
      project.id === projectId
        ? Effect.succeed(project)
        : Effect.fail(
            new ProjectValidationError({
              path: projectManifestPath(projectDirectory(projectsRoot, projectId)),
              message: `project id mismatch: expected ${projectId} got ${project.id}`,
            }),
          ),
    ),
  );

export const readVerifiedProjectAtRoot = (
  projectRoot: string,
): Effect.Effect<
  ProjectManifest,
  ProjectNotFoundError | ProjectValidationError | ProjectMigrationError
> =>
  Effect.gen(function* () {
    const manifestFile = projectManifestPath(projectRoot);
    yield* Effect.tryPromise({
      try: () => recoverProjectRevisionTransaction(projectRoot),
      catch: (cause) =>
        new ProjectValidationError({
          path: manifestFile,
          message: `failed to recover project revision transaction: ${errorMessage(cause)}`,
        }),
    });
    const project = yield* readManifestAtRoot(projectRoot).pipe(
      Effect.mapError((error) =>
        error._tag === 'ProjectPathNotFoundError'
          ? new ProjectNotFoundError({
              // Sentinel id for "no project at this root": must be a VALID
              // v4-shaped uuid or the error class itself fails to construct.
              projectId: makeProjectId('00000000-0000-4000-8000-000000000000' as Uuid),
              message: error.message,
            })
          : error,
      ),
    );
    const lock = yield* readProjectLock(projectLockPath(projectRoot));
    const actual = yield* projectHash(project);
    if (lock.projectHash !== actual) {
      yield* new ProjectValidationError({
        path: manifestFile,
        message: `project integrity mismatch: expected ${lock.projectHash} got ${actual}`,
      });
    }
    return project;
  });

export const resolveProjectRootForId = (
  projectsRoot: string,
  cwd: string,
  projectId: ProjectId,
): Effect.Effect<string, ProjectNotFoundError> =>
  Effect.gen(function* () {
    if (yield* Effect.promise(() => homeProjectExists(projectsRoot, projectId))) {
      return homeProjectRoot(projectsRoot, projectId);
    }
    const discovered = yield* Effect.promise(() => findProjectInAncestors(cwd, projectId));
    if (discovered) {
      return discovered.root;
    }
    const registered = yield* findRegisteredProject(projectsRoot, projectId);
    if (registered) {
      return registered.path;
    }
    return yield* Effect.fail(
      new ProjectNotFoundError({ projectId, message: `project not found: ${projectId}` }),
    );
  });

export const writeProjectWithLock = (
  projectDir: string,
  project: ProjectManifest,
  maps: readonly MapIntegrityEntry[],
): Effect.Effect<void, ProjectSaveError | ProjectValidationError> =>
  Effect.gen(function* () {
    const encodedProject = yield* encodeJson(
      ProjectManifestSchema,
      project,
      (message) => new ProjectSaveError({ path: projectManifestPath(projectDir), message }),
    );
    yield* writeJsonAtomic(projectManifestPath(projectDir), encodedProject).pipe(
      Effect.mapError(
        (error) => new ProjectSaveError({ path: error.path, message: error.message }),
      ),
    );
    const lock = new ProjectIntegrityLock({
      schemaVersion: 1,
      projectHash: yield* projectHash(project),
      maps: [...maps],
    });
    const encodedLock = yield* encodeJson(
      ProjectIntegrityLock,
      lock,
      (message) => new ProjectSaveError({ path: projectLockPath(projectDir), message }),
    );
    yield* writeJsonAtomic(projectLockPath(projectDir), encodedLock).pipe(
      Effect.mapError(
        (error) => new ProjectSaveError({ path: error.path, message: error.message }),
      ),
    );
  });

export const writeProjectPreservingMapLocks = (
  projectsRoot: string,
  project: ProjectManifest,
): Effect.Effect<void, ProjectSaveError | ProjectValidationError> =>
  Effect.gen(function* () {
    const projectDir = projectDirectory(projectsRoot, project.id);
    const lock = yield* readProjectLock(projectLockPath(projectDir)).pipe(
      Effect.catchTag('ProjectValidationError', () =>
        Effect.succeed(
          new ProjectIntegrityLock({ schemaVersion: 1, projectHash: hashJsonStable({}), maps: [] }),
        ),
      ),
    );
    yield* writeProjectWithLock(projectDir, project, lock.maps);
  });

export const updateProjectMaps = (
  project: ProjectManifest,
  maps: readonly ProjectMapRef[],
): ProjectManifest =>
  new ProjectManifest({
    id: project.id,
    name: project.name,
    schemaVersion: 1,
    engineVersion: project.engineVersion,
    plugins: [...project.plugins],
    assetPacks: [...project.assetPacks],
    maps: [...maps],
    ...(project.settings === undefined ? {} : { settings: project.settings }),
  });

const importRecordsPath = (projectDir: string): string =>
  path.join(projectDir, PROJECT_IMPORT_RECORDS_PATH);

export const appendProjectImportRecord = (
  projectDir: string,
  record: ImportRecord,
): Effect.Effect<void, ProjectSaveError> =>
  Effect.gen(function* () {
    const filePath = importRecordsPath(projectDir);
    const existing = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(filePath, 'utf8');
        } catch (cause) {
          if (isNotFound(cause)) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) => new ProjectSaveError({ path: filePath, message: errorMessage(cause) }),
    });
    const current =
      existing === undefined
        ? { schemaVersion: 1, records: [] as ImportRecord[] }
        : yield* Effect.try({
            try: () =>
              JSON.parse(existing) as {
                readonly schemaVersion: 1;
                readonly records: readonly ImportRecord[];
              },
            catch: (cause) =>
              new ProjectSaveError({ path: filePath, message: errorMessage(cause) }),
          });
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(filePath), { recursive: true }),
      catch: (cause) => new ProjectSaveError({ path: filePath, message: errorMessage(cause) }),
    });
    yield* writeJsonAtomic(filePath, {
      schemaVersion: 1,
      records: [...current.records.filter((entry) => entry.id !== record.id), record],
    }).pipe(
      Effect.mapError(
        (error) => new ProjectSaveError({ path: error.path, message: error.message }),
      ),
    );
  });

const summaryFromProject = (projectDir: string, project: ProjectManifest): ProjectSummary => ({
  id: project.id,
  name: project.name,
  engineVersion: project.engineVersion,
  mapCount: project.maps.length,
  assetPackCount: project.assetPacks.length,
  pluginCount: project.plugins.length,
  path: projectDir,
});

const listVerifiedProjects = (
  projectsRoot: string,
): Effect.Effect<readonly ProjectSummary[], ProjectServiceError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(projectsRoot, { withFileTypes: true });
        } catch (cause) {
          if (isNotFound(cause)) {
            return [];
          }
          throw cause;
        }
      },
      catch: (cause) =>
        new ProjectValidationError({ path: projectsRoot, message: errorMessage(cause) }),
    });
    const summaries: ProjectSummary[] = [];
    const seen = new Set<ProjectId>();
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const projectDir = path.join(projectsRoot, entry.name);
      const hasManifest = yield* Effect.promise(async () => {
        try {
          await access(projectManifestPath(projectDir));
          return true;
        } catch {
          return false;
        }
      });
      if (!hasManifest) {
        continue;
      }
      const project = yield* readVerifiedProjectAtRoot(projectDir);
      if (seen.has(project.id)) {
        continue;
      }
      seen.add(project.id);
      summaries.push(summaryFromProject(projectDir, project));
    }
    const registry = yield* readProjectRegistry(projectsRoot);
    for (const registered of registry.projects) {
      if (seen.has(registered.id)) {
        continue;
      }
      const project = yield* readVerifiedProjectAtRoot(registered.path);
      seen.add(project.id);
      summaries.push(summaryFromProject(registered.path, project));
    }
    return summaries.sort((left, right) => left.name.localeCompare(right.name));
  });

const resolveProjectRoot = (at: string | undefined, cwd: string): string =>
  path.resolve(at && at.length > 0 ? at : cwd);

const readManifestAtRoot = (
  projectRoot: string,
): Effect.Effect<
  ProjectManifest,
  ProjectPathNotFoundError | ProjectValidationError | ProjectMigrationError
> =>
  Effect.gen(function* () {
    const manifestFile = projectManifestPath(projectRoot);
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(manifestFile, 'utf8');
        } catch (cause) {
          if (isNotFound(cause)) {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) =>
        new ProjectValidationError({
          path: manifestFile,
          message: errorMessage(cause),
        }),
    });
    if (raw === undefined) {
      yield* new ProjectPathNotFoundError({
        path: projectRoot,
        message: 'project.json not found',
      });
    }
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw as string),
      catch: (cause) =>
        new ProjectValidationError({
          path: manifestFile,
          message: errorMessage(cause),
        }),
    });
    const fromVersion = readSchemaVersion(parsed) ?? 0;
    const migrated = projectMigrationChain.migrateToLatest(parsed, fromVersion);
    return yield* Result.match(migrated, {
      onFailure: (message) =>
        Effect.fail(
          new ProjectMigrationError({
            path: manifestFile,
            message,
          }),
        ),
      onSuccess: (value) =>
        Effect.try({
          try: () => Schema.decodeUnknownSync(ProjectManifestSchema)(value),
          catch: (cause) =>
            new ProjectValidationError({
              path: manifestFile,
              message: errorMessage(cause),
            }),
        }),
    });
  });

const ensureCliProjectLayout = (projectRoot: string): Effect.Effect<void, ProjectSaveError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(projectMapsDirectory(projectRoot), { recursive: true }),
      catch: (cause) => new ProjectSaveError({ path: projectRoot, message: errorMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(path.join(projectRoot, PROJECT_CACHE_DIR), { recursive: true }),
      catch: (cause) =>
        new ProjectSaveError({
          path: path.join(projectRoot, PROJECT_CACHE_DIR),
          message: errorMessage(cause),
        }),
    });
  });

export const ProjectServiceLive = Layer.effect(
  ProjectService,
  Effect.gen(function* () {
    const home = yield* HomeService;
    const paths = yield* home.init();
    const trigger = yield* PubSub.unbounded<void>();
    const cwd = process.cwd();

    const create = Effect.fn('ProjectService.create')(function* (spec: ProjectCreateSpec) {
      const projectId = newProjectId();
      const project = new ProjectManifest({
        id: projectId,
        name: spec.name,
        schemaVersion: 1,
        engineVersion: spec.engineVersion ?? '0.1.0',
        plugins: [...(spec.plugins ?? [])],
        assetPacks: [...(spec.assetPacks ?? [])],
        maps: [],
        ...(spec.settings === undefined ? {} : { settings: spec.settings }),
      });
      const staging = path.join(paths.projects, `.staging-${projectId}-${randomUUID()}`);
      const target = projectDirectory(paths.projects, projectId);
      yield* Effect.tryPromise({
        try: () => mkdir(staging, { recursive: true }),
        catch: (cause) => new ProjectSaveError({ path: staging, message: errorMessage(cause) }),
      });
      yield* writeProjectWithLock(staging, project, []);
      yield* Effect.tryPromise({
        try: () => rename(staging, target),
        catch: (cause) => new ProjectSaveError({ path: target, message: errorMessage(cause) }),
      });
      yield* PubSub.publish(trigger, void 0);
      return projectId;
    });

    const open = Effect.fn('ProjectService.open')(function* (projectId: ProjectId) {
      // Resolve the actual root first (home dir, cwd ancestors, registry):
      // projects created with `project init <slug>` or `--here` do NOT live at
      // the id-named home directory `readVerifiedProject` assumes.
      const root = yield* resolveProjectRootForId(paths.projects, cwd, projectId);
      const project = yield* readVerifiedProjectAtRoot(root);
      if (project.id !== projectId) {
        return yield* Effect.fail(
          new ProjectValidationError({
            path: projectManifestPath(root),
            message: `project id mismatch: expected ${projectId} got ${project.id}`,
          }),
        );
      }
      return project;
    });

    const save = Effect.fn('ProjectService.save')(function* (project: ProjectManifest) {
      yield* writeProjectPreservingMapLocks(paths.projects, project);
      yield* PubSub.publish(trigger, void 0);
    });

    const list = Effect.fn('ProjectService.list')(function* () {
      return yield* listVerifiedProjects(paths.projects);
    });

    const importFromDirectory = Effect.fn('ProjectService.importFromDirectory')(function* (
      sourcePath: string,
    ) {
      const resolved = path.resolve(sourcePath);
      const project = yield* readVerifiedProjectAtRoot(resolved).pipe(
        Effect.mapError((error) =>
          error._tag === 'ProjectNotFoundError'
            ? new ProjectPathNotFoundError({
                path: resolved,
                message: 'project.json not found in selected folder',
              })
            : error,
        ),
      );
      const target = projectDirectory(paths.projects, project.id);
      const alreadyRegistered = yield* Effect.promise(() =>
        homeProjectExists(paths.projects, project.id),
      );
      if (!alreadyRegistered) {
        yield* Effect.tryPromise({
          try: async () => {
            await cp(resolved, target, { recursive: true, force: false });
            await markImportedBehaviorRegistryUntrusted(target);
          },
          catch: (cause) => new ProjectSaveError({ path: target, message: errorMessage(cause) }),
        });
        yield* PubSub.publish(trigger, void 0);
      }
      return project.id;
    });

    const exportArchive = Effect.fn('ProjectService.exportArchive')(function* (
      projectId: ProjectId,
      destinationDirectory: string,
    ) {
      const project = yield* readVerifiedProject(paths.projects, projectId);
      const projectDir = projectDirectory(paths.projects, projectId);
      const safeName =
        project.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
      const archivePath = path.join(
        path.resolve(destinationDirectory),
        `${safeName}-${projectId}.tar.gz`,
      );
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(archivePath), { recursive: true }),
        catch: (cause) => new ProjectSaveError({ path: archivePath, message: errorMessage(cause) }),
      });
      yield* Effect.tryPromise({
        try: () =>
          execFileAsync('tar', ['-czf', archivePath, '-C', projectDir, '.'], {
            maxBuffer: 32 * 1024 * 1024,
          }),
        catch: (cause) => new ProjectSaveError({ path: archivePath, message: errorMessage(cause) }),
      });
      return { archivePath };
    });

    const init = Effect.fn('ProjectService.init')(function* (input: ProjectInitInput) {
      const isExplicitPath =
        path.isAbsolute(input.slug) || input.slug.includes('/') || input.slug.includes('\\');
      const slug = yield* validateSlug(
        isExplicitPath ? path.basename(path.resolve(cwd, input.slug)) : input.slug,
      );
      const projectRoot = input.here
        ? path.resolve(cwd)
        : isExplicitPath
          ? path.resolve(cwd, input.slug)
          : path.join(paths.projects, slug);
      const projectName = isExplicitPath ? path.basename(projectRoot) : slug;
      const manifestFile = projectManifestPath(projectRoot);

      const existing = yield* Effect.tryPromise({
        try: async () => {
          try {
            await readFile(manifestFile, 'utf8');
            return true;
          } catch (cause) {
            if (isNotFound(cause)) {
              return false;
            }
            throw cause;
          }
        },
        catch: (cause) =>
          new ProjectValidationError({ path: manifestFile, message: errorMessage(cause) }),
      });
      if (existing) {
        yield* new ProjectAlreadyExistsError({
          path: projectRoot,
          message: `project already exists at ${projectRoot}`,
        });
      }

      if (!input.here) {
        yield* Effect.tryPromise({
          try: () => mkdir(projectRoot, { recursive: true }),
          catch: (cause) =>
            new ProjectSaveError({ path: projectRoot, message: errorMessage(cause) }),
        });
        if (!isExplicitPath) {
          yield* Effect.tryPromise({
            try: () => rejectSymlinkEscape(paths.projects, slug),
            catch: (cause) =>
              new ProjectSaveError({ path: projectRoot, message: errorMessage(cause) }),
          });
        }
      }

      yield* ensureCliProjectLayout(projectRoot);
      const manifest = new ProjectManifest({
        id: newProjectId(),
        name: projectName,
        schemaVersion: 1,
        engineVersion: '0.1.0',
        plugins: (input.plugins ?? []).map(
          (pluginId) =>
            new ProjectPluginRef({ id: pluginId as ProjectPluginRef['id'], version: '*' }),
        ),
        assetPacks: [],
        maps: [],
      });
      yield* writeProjectWithLock(projectRoot, manifest, []);
      yield* upsertProjectRegistryEntry(
        paths.projects,
        new ProjectRegistryEntry({
          id: manifest.id,
          name: manifest.name,
          path: projectRoot,
        }),
      );
      return {
        manifest,
        path: projectRoot,
        template: input.template ? Option.some(input.template) : Option.none(),
      };
    });

    const info = Effect.fn('ProjectService.info')(function* (at?: string | undefined) {
      const projectRoot = resolveProjectRoot(at, cwd);
      const manifest = yield* readManifestAtRoot(projectRoot);
      const entries = yield* Effect.tryPromise({
        try: () => readdir(projectRoot),
        catch: (cause) =>
          new ProjectValidationError({ path: projectRoot, message: errorMessage(cause) }),
      });
      return { manifest, path: projectRoot, entries };
    });

    const upgrade = Effect.fn('ProjectService.upgrade')(function* (at?: string | undefined) {
      const projectRoot = resolveProjectRoot(at, cwd);
      const manifestFile = projectManifestPath(projectRoot);
      const raw = yield* Effect.tryPromise({
        try: () => readFile(manifestFile, 'utf8'),
        catch: (cause) =>
          new ProjectPathNotFoundError({
            path: projectRoot,
            message: errorMessage(cause),
          }),
      });
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: (cause) =>
          new ProjectValidationError({ path: manifestFile, message: errorMessage(cause) }),
      });
      const fromVersion = readSchemaVersion(parsed) ?? 0;
      const migrated = projectMigrationChain.migrateToLatest(parsed, fromVersion);
      const manifest = yield* Result.match(migrated, {
        onFailure: (message) =>
          Effect.fail(new ProjectMigrationError({ path: manifestFile, message })),
        onSuccess: (value) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(ProjectManifestSchema)(value),
            catch: (cause) =>
              new ProjectValidationError({ path: manifestFile, message: errorMessage(cause) }),
          }),
      });
      const changed = fromVersion !== CORE_SCHEMA_VERSIONS.project;
      if (changed) {
        const lock = yield* readProjectLock(projectLockPath(projectRoot)).pipe(
          Effect.catchTag('ProjectValidationError', () =>
            Effect.succeed(
              new ProjectIntegrityLock({
                schemaVersion: 1,
                projectHash: hashJsonStable({}),
                maps: [],
              }),
            ),
          ),
        );
        yield* writeProjectWithLock(projectRoot, manifest, lock.maps);
      }
      return {
        manifest,
        path: projectRoot,
        fromVersion,
        toVersion: CORE_SCHEMA_VERSIONS.project,
        changed,
      };
    });

    const clean = Effect.fn('ProjectService.clean')(function* (at?: string | undefined) {
      const projectRoot = resolveProjectRoot(at, cwd);
      yield* readManifestAtRoot(projectRoot);
      const targets = [
        path.join(projectRoot, PROJECT_CACHE_DIR),
        path.join(projectRoot, PROJECT_DERIVED_DIR),
      ];
      const removed: string[] = [];
      yield* Effect.forEach(
        targets,
        (target) =>
          Effect.tryPromise({
            try: async () => {
              try {
                await rm(target, { recursive: true, force: true });
                removed.push(path.relative(projectRoot, target));
              } catch (cause) {
                if (!isNotFound(cause)) {
                  throw cause;
                }
              }
            },
            catch: (cause) => new ProjectSaveError({ path: target, message: errorMessage(cause) }),
          }),
        { discard: true },
      );
      yield* ensureCliProjectLayout(projectRoot);
      return { path: projectRoot, removed };
    });

    return {
      create,
      open,
      save,
      list,
      subscribe: Stream.concat(
        Stream.fromEffect(listVerifiedProjects(paths.projects)),
        Stream.fromPubSub(trigger).pipe(
          Stream.mapEffect(() => listVerifiedProjects(paths.projects)),
        ),
      ),
      importFromDirectory,
      exportArchive,
      init,
      info,
      upgrade,
      clean,
    };
  }),
);

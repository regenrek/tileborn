import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PERSISTED_SCHEMA_VERSIONS, ProjectId } from '@tileborne/core';
import { writeJsonAtomic } from '@tileborne/services-foundation';
import { Effect, Schema } from 'effect';

import { isNotFound } from './files.js';

const PROJECT_REGISTRY_FILE = 'registry.json';

export class ProjectRegistryEntry extends Schema.Class<ProjectRegistryEntry>(
  'ProjectRegistryEntry',
)({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
}) {}

export class ProjectRegistry extends Schema.Class<ProjectRegistry>('ProjectRegistry')({
  schemaVersion: Schema.Literal(PERSISTED_SCHEMA_VERSIONS.projectRegistry),
  projects: Schema.Array(ProjectRegistryEntry),
}) {}

const emptyRegistry = (): ProjectRegistry =>
  new ProjectRegistry({
    schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRegistry,
    projects: [],
  });

export const projectRegistryPath = (projectsRoot: string): string =>
  path.join(projectsRoot, PROJECT_REGISTRY_FILE);

const decodeRegistry = (raw: string): ProjectRegistry => {
  try {
    return Schema.decodeUnknownSync(ProjectRegistry)(JSON.parse(raw) as unknown);
  } catch {
    return emptyRegistry();
  }
};

export const readProjectRegistry = (projectsRoot: string): Effect.Effect<ProjectRegistry> =>
  Effect.promise(async () => {
    const filePath = projectRegistryPath(projectsRoot);
    try {
      const raw = await readFile(filePath, 'utf8');
      return decodeRegistry(raw);
    } catch (cause) {
      if (isNotFound(cause)) {
        return emptyRegistry();
      }
      return emptyRegistry();
    }
  });

export const upsertProjectRegistryEntry = (
  projectsRoot: string,
  entry: ProjectRegistryEntry,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const registry = yield* readProjectRegistry(projectsRoot);
    const next = registry.projects.filter(
      (candidate) => candidate.id !== entry.id && candidate.path !== entry.path,
    );
    const updated = new ProjectRegistry({
      schemaVersion: PERSISTED_SCHEMA_VERSIONS.projectRegistry,
      projects: [...next, entry],
    });
    const encoded = Schema.encodeSync(ProjectRegistry)(updated);
    yield* writeJsonAtomic(projectRegistryPath(projectsRoot), encoded).pipe(
      Effect.catch(() => Effect.void),
    );
  });

export const findRegisteredProject = (
  projectsRoot: string,
  slugOrId: string,
): Effect.Effect<ProjectRegistryEntry | undefined> =>
  Effect.gen(function* () {
    const registry = yield* readProjectRegistry(projectsRoot);
    return registry.projects.find((entry) => entry.name === slugOrId || entry.id === slugOrId);
  });

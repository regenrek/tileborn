import {
  PROJECT_GAME_SHELL_DOCUMENT_SETTINGS_KEY,
  applyGameShellAuthoringCommand,
  buildRuntimeGameShellProjection,
  decodeProjectGameShellDocument,
  defaultProjectGameShellState,
  gameShellStateFromDocument,
  gameShellStateFromDefaults,
  projectGameShellDocumentFromState,
  projectGameShellDocumentWithOverrides,
  resolveProjectGameShellDocument,
  type GameShellAuthoringCommand,
  type GameShellDefaultsDefinition,
  type RuntimeGameShellProjectionOptions,
  type ProjectGameShellDocument,
  type RuntimeGameShellProjection,
} from '@tileborne/runtime';
import { ProjectAssetPackRef, type JsonValue, type ProjectId } from '@tileborne/core';
import { Context, Effect, Layer } from 'effect';

import { ProjectService, type ProjectServiceError } from '../project/index.js';

const encodeDocument = (document: ProjectGameShellDocument): JsonValue =>
  JSON.parse(JSON.stringify(document)) as JsonValue;

const emptyDocument = (
  defaults?: GameShellDefaultsDefinition | undefined,
): ProjectGameShellDocument =>
  projectGameShellDocumentFromState(
    defaults === undefined ? defaultProjectGameShellState() : gameShellStateFromDefaults(defaults),
  );

export interface ProjectGameShellOpenOptions {
  readonly defaults?: GameShellDefaultsDefinition | undefined;
}

export interface ProjectGameShellProjectionOptions extends ProjectGameShellOpenOptions {
  readonly projection?: RuntimeGameShellProjectionOptions | undefined;
}

const collectShellPackRefs = (document: ProjectGameShellDocument): readonly ProjectAssetPackRef[] =>
  document.assets.map(
    (asset) =>
      new ProjectAssetPackRef({
        id: asset.packId,
        version: asset.packVersion,
      }),
  );

const attachShellPackRefs = (
  existing: readonly ProjectAssetPackRef[],
  document: ProjectGameShellDocument,
): readonly ProjectAssetPackRef[] => {
  const byKey = new Map(existing.map((ref) => [`${ref.id}@${ref.version}`, ref] as const));
  for (const ref of collectShellPackRefs(document)) {
    byKey.set(`${ref.id}@${ref.version}`, ref);
  }
  return [...byKey.values()];
};

export class ProjectGameShellService extends Context.Service<
  ProjectGameShellService,
  {
    readonly open: (
      projectId: ProjectId,
      options?: ProjectGameShellOpenOptions | undefined,
    ) => Effect.Effect<ProjectGameShellDocument, ProjectServiceError>;
    readonly save: (
      projectId: ProjectId,
      document: ProjectGameShellDocument,
    ) => Effect.Effect<ProjectGameShellDocument, ProjectServiceError>;
    readonly apply: (
      projectId: ProjectId,
      command: GameShellAuthoringCommand,
      options?: ProjectGameShellOpenOptions | undefined,
    ) => Effect.Effect<
      {
        readonly document: ProjectGameShellDocument;
        readonly projection: RuntimeGameShellProjection;
      },
      ProjectServiceError
    >;
    readonly project: (
      projectId: ProjectId,
      options?: ProjectGameShellProjectionOptions | undefined,
    ) => Effect.Effect<RuntimeGameShellProjection, ProjectServiceError>;
  }
>()('@tileborne/services-app/ProjectGameShellService') {}

export const ProjectGameShellServiceLive = Layer.effect(
  ProjectGameShellService,
  Effect.gen(function* () {
    const projects = yield* ProjectService;

    const open = Effect.fn('ProjectGameShellService.open')(function* (
      projectId: ProjectId,
      options: ProjectGameShellOpenOptions = {},
    ) {
      const project = yield* projects.open(projectId);
      const document = decodeProjectGameShellDocument(
        project.settings?.[PROJECT_GAME_SHELL_DOCUMENT_SETTINGS_KEY],
      );
      return resolveProjectGameShellDocument(
        document ?? emptyDocument(options.defaults),
        options.defaults,
      );
    });

    const save = Effect.fn('ProjectGameShellService.save')(function* (
      projectId: ProjectId,
      document: ProjectGameShellDocument,
    ) {
      const project = yield* projects.open(projectId);
      yield* projects.save({
        ...project,
        assetPacks: attachShellPackRefs(project.assetPacks, document),
        settings: {
          ...(project.settings ?? {}),
          [PROJECT_GAME_SHELL_DOCUMENT_SETTINGS_KEY]: encodeDocument(document),
        },
      });
      return document;
    });

    const project = Effect.fn('ProjectGameShellService.project')(function* (
      projectId: ProjectId,
      options: ProjectGameShellProjectionOptions = {},
    ) {
      const document = yield* open(projectId, options);
      return buildRuntimeGameShellProjection(
        gameShellStateFromDocument(document),
        options.projection,
      );
    });

    const apply = Effect.fn('ProjectGameShellService.apply')(function* (
      projectId: ProjectId,
      command: GameShellAuthoringCommand,
      options: ProjectGameShellOpenOptions = {},
    ) {
      const document = yield* open(projectId, options);
      const existingOverrides = document.projectOverrides ?? [];
      const nextOverrides =
        command.type === 'apply-plugin-defaults' ? [] : [...existingOverrides, command];
      const base =
        command.type === 'apply-plugin-defaults'
          ? gameShellStateFromDefaults({ ...options.defaults, pluginId: command.pluginId })
          : gameShellStateFromDocument(document);
      const state =
        command.type === 'apply-plugin-defaults'
          ? base
          : applyGameShellAuthoringCommand(base, command);
      const saved = yield* save(
        projectId,
        projectGameShellDocumentWithOverrides(state, nextOverrides),
      );
      return {
        document: saved,
        projection: buildRuntimeGameShellProjection(state),
      };
    });

    return { open, save, apply, project };
  }),
);

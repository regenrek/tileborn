import {
  PROJECT_AUDIO_DOCUMENT_SETTINGS_KEY,
  applyAudioAuthoringCommand,
  audioAuthoringStateFromDocument,
  buildRuntimeAudioProjectionFromAuthoring,
  createAudioAuthoringState,
  decodeProjectAudioDocument,
  defaultRuntimeAudioSettings,
  projectAudioDocumentFromState,
  type AudioAuthoringCommand,
  type ProjectAudioDocument,
  type RuntimeAudioProjection,
  type RuntimeAudioSourceResolver,
} from '@tileborne/runtime';
import { ProjectAssetPackRef, type JsonValue, type ProjectId } from '@tileborne/core';
import { Context, Effect, Layer } from 'effect';

import { ProjectService, type ProjectServiceError } from '../project/index.js';

const encodeDocument = (document: ProjectAudioDocument): JsonValue =>
  JSON.parse(JSON.stringify(document)) as JsonValue;

const emptyDocument = (): ProjectAudioDocument =>
  projectAudioDocumentFromState(
    createAudioAuthoringState({ settings: defaultRuntimeAudioSettings() }),
  );

const collectAudioPackRefs = (document: ProjectAudioDocument): readonly ProjectAssetPackRef[] =>
  document.assets.flatMap((asset) =>
    asset.source.packId === undefined || asset.source.packVersion === undefined
      ? []
      : [
          new ProjectAssetPackRef({
            id: asset.source.packId,
            version: asset.source.packVersion,
          }),
        ],
  );

const attachAudioPackRefs = (
  existing: readonly ProjectAssetPackRef[],
  document: ProjectAudioDocument,
): readonly ProjectAssetPackRef[] => {
  const byKey = new Map(existing.map((ref) => [`${ref.id}@${ref.version}`, ref] as const));
  for (const ref of collectAudioPackRefs(document)) {
    byKey.set(`${ref.id}@${ref.version}`, ref);
  }
  return [...byKey.values()];
};

export class ProjectAudioService extends Context.Service<
  ProjectAudioService,
  {
    readonly open: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectAudioDocument, ProjectServiceError>;
    readonly save: (
      projectId: ProjectId,
      document: ProjectAudioDocument,
    ) => Effect.Effect<ProjectAudioDocument, ProjectServiceError>;
    readonly apply: (
      projectId: ProjectId,
      command: AudioAuthoringCommand,
    ) => Effect.Effect<
      {
        readonly document: ProjectAudioDocument;
        readonly projection: RuntimeAudioProjection;
      },
      ProjectServiceError
    >;
    readonly project: (
      projectId: ProjectId,
      resolver?: RuntimeAudioSourceResolver | undefined,
    ) => Effect.Effect<RuntimeAudioProjection, ProjectServiceError>;
  }
>()('@tileborne/services-app/ProjectAudioService') {}

export const ProjectAudioServiceLive = Layer.effect(
  ProjectAudioService,
  Effect.gen(function* () {
    const projects = yield* ProjectService;

    const open = Effect.fn('ProjectAudioService.open')(function* (projectId: ProjectId) {
      const project = yield* projects.open(projectId);
      return (
        decodeProjectAudioDocument(project.settings?.[PROJECT_AUDIO_DOCUMENT_SETTINGS_KEY]) ??
        emptyDocument()
      );
    });

    const save = Effect.fn('ProjectAudioService.save')(function* (
      projectId: ProjectId,
      document: ProjectAudioDocument,
    ) {
      const project = yield* projects.open(projectId);
      yield* projects.save({
        ...project,
        assetPacks: attachAudioPackRefs(project.assetPacks, document),
        settings: {
          ...(project.settings ?? {}),
          [PROJECT_AUDIO_DOCUMENT_SETTINGS_KEY]: encodeDocument(document),
        },
      });
      return document;
    });

    const project = Effect.fn('ProjectAudioService.project')(function* (
      projectId: ProjectId,
      resolver?: RuntimeAudioSourceResolver | undefined,
    ) {
      const document = yield* open(projectId);
      return buildRuntimeAudioProjectionFromAuthoring(audioAuthoringStateFromDocument(document), {
        resolveSource: resolver,
      });
    });

    const apply = Effect.fn('ProjectAudioService.apply')(function* (
      projectId: ProjectId,
      command: AudioAuthoringCommand,
    ) {
      const document = yield* open(projectId);
      const result = applyAudioAuthoringCommand(audioAuthoringStateFromDocument(document), command);
      const saved = yield* save(projectId, projectAudioDocumentFromState(result.state));
      return {
        document: saved,
        projection: buildRuntimeAudioProjectionFromAuthoring(result.state),
      };
    });

    return { open, save, apply, project };
  }),
);

import { pathToFileURL } from 'node:url';

import type {
  BehaviorDiagnostic,
  MapId,
  PlayerModelRef,
  ProjectId,
  TileborneMap,
} from '@tileborne/core';
import {
  ReadinessDiagnostic,
  ReadinessNavigationTarget,
  ReadinessReport,
  type ReadinessPurpose,
  type ReadinessSeverity,
  type ReadinessSource,
} from '@tileborne/ipc-contracts';
import { resolvePluginManifestPath, type InstalledPlugin } from '@tileborne/services-plugin';
import type { BehaviorCompileDiagnostic } from '@tileborne/services-build';
import { Option } from 'effect';

import type { VisualModelDiagnostic } from '../shared/visual-model-diagnostics.js';

export interface PluginMapValidationIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly location?: string | undefined;
}

export interface PluginMapValidationResult {
  readonly ok: boolean;
  readonly issues: readonly PluginMapValidationIssue[];
}

type PluginMapValidator = (map: TileborneMap) => PluginMapValidationResult;

const validatorCache = new Map<string, Promise<PluginMapValidator | undefined>>();

/**
 * Load the active mode's executable map validator from its declared server/editor
 * entry. Dynamic import is main-process only; the renderer receives the neutral
 * readiness report and never executes plugin code.
 */
export const loadPluginMapValidator = (
  plugin: InstalledPlugin,
  mapValidatorId: string | undefined,
): Promise<PluginMapValidator | undefined> => {
  if (mapValidatorId === undefined) {
    return Promise.resolve(undefined);
  }
  const server = Option.getOrUndefined(plugin.manifest.contributes.server);
  const validators = Option.getOrElse(server?.mapValidators ?? Option.none(), () => []);
  const contribution = validators.find(({ id }) => id === mapValidatorId);
  if (contribution === undefined) {
    return Promise.reject(
      new Error(
        `Game mode references unknown server map validator ${mapValidatorId} in plugin ${plugin.id}`,
      ),
    );
  }
  const cacheKey = `${plugin.manifestPath}:${plugin.integrity}:${contribution.id}:${contribution.entry}`;
  const cached = validatorCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const loading = (async () => {
    const entryPath = await resolvePluginManifestPath(plugin.rootPath, contribution.entry);
    const module = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
    if (typeof module.validateMap !== 'function') {
      throw new Error(
        `Map validator ${mapValidatorId} in plugin ${plugin.id} does not export validateMap`,
      );
    }
    return module.validateMap as PluginMapValidator;
  })();
  validatorCache.set(cacheKey, loading);
  return loading;
};

export interface ReadinessDiagnosticInput {
  readonly id: string;
  readonly code: string;
  readonly severity: ReadinessSeverity;
  readonly source: ReadinessSource;
  readonly title: string;
  readonly message: string;
  readonly projectId: ProjectId;
  readonly mapId?: MapId | undefined;
  readonly behaviorId?: BehaviorDiagnostic['behaviorId'] | undefined;
  readonly behaviorNodeId?: BehaviorDiagnostic['nodeId'] | undefined;
  readonly sourceKind?: BehaviorDiagnostic['sourceKind'] | undefined;
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly navigation?: ReadinessNavigationTarget | undefined;
}

export const readinessDiagnostic = (input: ReadinessDiagnosticInput): ReadinessDiagnostic =>
  new ReadinessDiagnostic(input);

export const readinessNavigation = (
  input: ConstructorParameters<typeof ReadinessNavigationTarget>[0],
): ReadinessNavigationTarget => new ReadinessNavigationTarget(input);

/** One metadata-preserving adapter from behavior diagnostics into Problems deep links. */
export const behaviorReadinessDiagnostics = (
  projectId: ProjectId,
  projectDiagnostics: readonly BehaviorDiagnostic[],
  compileDiagnostics: readonly BehaviorCompileDiagnostic[],
): readonly ReadinessDiagnostic[] => {
  const projectCodes = new Set(projectDiagnostics.map((entry) => entry.code));
  const fromProject = projectDiagnostics.map((issue) => readinessDiagnostic({
    id: issue.id,
    code: issue.code,
    severity: issue.severity,
    source: 'behavior',
    title: issue.title,
    message: issue.message,
    projectId,
    ...(issue.behaviorId === undefined ? {} : { behaviorId: issue.behaviorId }),
    ...(issue.nodeId === undefined ? {} : { behaviorNodeId: issue.nodeId }),
    ...(issue.sourceKind === undefined ? {} : { sourceKind: issue.sourceKind }),
    ...(issue.path === undefined ? {} : { path: issue.path }),
    navigation: readinessNavigation({
      kind: 'behavior',
      projectId,
      ...(issue.behaviorId === undefined ? {} : { behaviorId: issue.behaviorId }),
      ...(issue.nodeId === undefined ? {} : { behaviorNodeId: issue.nodeId }),
      ...(issue.sourceKind === undefined ? {} : { sourceKind: issue.sourceKind }),
      ...(issue.path === undefined ? {} : { path: issue.path }),
    }),
  }));
  const fromCompiler = compileDiagnostics
    .filter((issue) => !projectCodes.has(issue.code))
    .map((issue, index) => readinessDiagnostic({
      id: `project:${projectId}:behavior-compile:${issue.code}:${index}`,
      code: issue.code,
      severity: 'error',
      source: 'behavior',
      title: 'Behavior cannot compile',
      message: `${issue.message} ${issue.suggestion}`,
      projectId,
      ...(issue.behaviorId === undefined ? {} : { behaviorId: issue.behaviorId }),
      ...(issue.nodeId === undefined ? {} : { behaviorNodeId: issue.nodeId }),
      ...(issue.sourceKind === undefined ? {} : { sourceKind: issue.sourceKind }),
      path: issue.fileName,
      ...(issue.line === undefined ? {} : { line: issue.line }),
      ...(issue.column === undefined ? {} : { column: issue.column }),
      navigation: readinessNavigation({
        kind: 'behavior',
        projectId,
        ...(issue.behaviorId === undefined ? {} : { behaviorId: issue.behaviorId }),
        ...(issue.nodeId === undefined ? {} : { behaviorNodeId: issue.nodeId }),
        ...(issue.sourceKind === undefined ? {} : { sourceKind: issue.sourceKind }),
        path: issue.fileName,
        ...(issue.line === undefined ? {} : { line: issue.line }),
        ...(issue.column === undefined ? {} : { column: issue.column }),
      }),
    }));
  return [...fromProject, ...fromCompiler];
};

const SEVERITY_ORDER: Readonly<Record<ReadinessSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Deterministic ordering keeps the Problems UI and recorded evidence stable. */
export const makeReadinessReport = (
  purpose: ReadinessPurpose,
  diagnostics: readonly ReadinessDiagnostic[],
): ReadinessReport => {
  const sorted = [...diagnostics].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.id.localeCompare(right.id),
  );
  return new ReadinessReport({
    ok: !sorted.some((diagnostic) => diagnostic.severity === 'error'),
    purpose,
    diagnostics: sorted,
  });
};

export const blockingReadinessMessage = (report: ReadinessReport): string => {
  const errors = report.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const detail = errors
    .slice(0, 3)
    .map((diagnostic) => diagnostic.message)
    .join('; ');
  const suffix = errors.length > 3 ? `; and ${errors.length - 3} more` : '';
  return `Game is not ready for ${report.purpose}: ${detail}${suffix}`;
};

export const assertReadiness = (report: ReadinessReport): void => {
  if (!report.ok) {
    throw new Error(blockingReadinessMessage(report));
  }
};

export type MainExecutionEntryPoint =
  | 'builds:build'
  | 'ship:start'
  | 'playtest:start'
  | 'runtime:prepareLocalRoomArtifact';

export const mainExecutionPurpose = (entryPoint: MainExecutionEntryPoint): 'playtest' | 'build' =>
  entryPoint === 'builds:build' || entryPoint === 'ship:start' ? 'build' : 'playtest';

/** Named hard gate used by every main-process build/playtest execution boundary. */
export const assertExecutionReadiness = (
  entryPoint: MainExecutionEntryPoint,
  report: ReadinessReport,
): void => {
  const expectedPurpose = mainExecutionPurpose(entryPoint);
  if (report.purpose !== expectedPurpose) {
    throw new Error(
      `Readiness purpose mismatch for ${entryPoint}: expected ${expectedPurpose}, got ${report.purpose}`,
    );
  }
  assertReadiness(report);
};

interface PlayerModelEditorIndex {
  readonly assets?: readonly { readonly id?: unknown }[] | undefined;
  readonly placeables?:
    | readonly {
        readonly id?: unknown;
        readonly frames?: readonly { readonly assetId?: unknown }[] | undefined;
        readonly clips?:
          | readonly {
              readonly id?: unknown;
              readonly frames?: readonly { readonly assetId?: unknown }[] | undefined;
            }[]
          | undefined;
      }[]
    | undefined;
}

/** Main-process reference checks for the data needed by the runtime projector. */
export const diagnosePlayerModelReference = (
  model: PlayerModelRef,
  index: PlayerModelEditorIndex | undefined,
): readonly VisualModelDiagnostic[] => {
  const base = `playerModels.${model.id}`;
  if (index === undefined) {
    return [
      {
        severity: 'error',
        code: 'player-model.asset-missing',
        message: `${model.label} references an unavailable asset pack: ${model.ref.packId}`,
        path: `${base}.ref.packId`,
        modelId: model.id,
      },
    ];
  }
  const placeable = index.placeables?.find((entry) => String(entry.id) === model.ref.refId);
  if (placeable === undefined) {
    return [
      {
        severity: 'error',
        code: 'player-model.asset-missing',
        message: `${model.label} references a missing sprite/placeable: ${model.ref.refId}`,
        path: `${base}.ref.refId`,
        modelId: model.id,
      },
    ];
  }
  const diagnostics: VisualModelDiagnostic[] = [];
  const assetIds = new Set((index.assets ?? []).map((asset) => String(asset.id)));
  for (const [key, clipId] of Object.entries(model.clips)) {
    const clip = placeable.clips?.find((entry) => String(entry.id) === String(clipId));
    if (clip === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'player-model.clip-missing',
        message: `${model.label} references a missing ${key} clip: ${String(clipId)}`,
        path: `${base}.clips.${key}`,
        modelId: model.id,
      });
      continue;
    }
    const missingAssetId = clip.frames
      ?.map((frame) => String(frame.assetId))
      .find((id) => !assetIds.has(id));
    if (missingAssetId !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'player-model.asset-missing',
        message: `${model.label}'s ${key} clip references a missing atlas asset: ${missingAssetId}`,
        path: `${base}.clips.${key}`,
        modelId: model.id,
      });
    }
  }
  return diagnostics;
};

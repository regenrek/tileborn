import path from 'node:path';

import {
  BehaviorModuleArtifact,
  BehaviorRegistryManifest,
  RuntimeBehaviorPackage,
  type BehaviorId,
} from '@tileborne/core';
import type { ProjectBehaviorSnapshot } from '@tileborne/services-app';

import type { RuntimeMapPackageBehaviorModuleInput } from '../map-package/assemble.js';
import {
  compileTypeScriptBehavior,
  compileVisualBehavior,
  type BehaviorCompileDiagnostic,
  type BehaviorCompileResult,
  type CompiledBehaviorModule,
} from './compiler.js';

export interface ProjectBehaviorPackageResult {
  readonly ok: boolean;
  readonly diagnostics: readonly BehaviorCompileDiagnostic[];
  readonly behaviorPackage?: RuntimeBehaviorPackage;
  readonly modules?: readonly RuntimeMapPackageBehaviorModuleInput[];
}

export interface ProjectBehaviorCompilerObserver {
  readonly onPackageCompiled?:
    | ((input: { readonly sourceBytes: number; readonly modules: number }) => void)
    | undefined;
}

const diagnostic = (
  code: string,
  message: string,
  fileName: string,
  suggestion: string,
  location: Pick<BehaviorCompileDiagnostic, 'behaviorId' | 'nodeId' | 'sourceKind'> = {},
): BehaviorCompileDiagnostic => ({
  code,
  severity: 'error',
  message,
  fileName,
  suggestion,
  ...location,
});

/** Compiles one saved behavior and only its reachable TypeScript dependencies for live reload. */
export const compileProjectBehaviorModule = async (
  snapshot: ProjectBehaviorSnapshot,
  registry: BehaviorRegistryManifest,
  behaviorId: BehaviorId,
): Promise<BehaviorCompileResult> => {
  const resource = snapshot.resources.find((entry) => entry.manifest.id === behaviorId);
  if (resource === undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'TBBUILD2202',
          'The saved behavior no longer exists in the canonical project snapshot.',
          '<behavior>',
          'Reopen the behavior editor and retry the save.',
          { behaviorId },
        ),
      ],
    };
  }
  const diagnostics = snapshot.diagnostics
    .filter(
      (entry) =>
        entry.severity === 'error' &&
        (entry.behaviorId === undefined || entry.behaviorId === behaviorId),
    )
    .map((entry) =>
      diagnostic(
        entry.code,
        entry.message,
        entry.path ?? '<behavior>',
        entry.code === 'behavior.project-untrusted'
          ? 'Trust the imported project before compiling TypeScript behaviors.'
          : 'Open the behavior source and resolve this project diagnostic.',
        {
          ...(entry.behaviorId === undefined ? {} : { behaviorId: entry.behaviorId }),
          ...(entry.nodeId === undefined ? {} : { nodeId: entry.nodeId }),
          ...(entry.sourceKind === undefined ? {} : { sourceKind: entry.sourceKind }),
        },
      ),
    );
  const availableCapabilities = new Set(registry.entries.map((entry) => entry.capability));
  const sourcePath =
    resource.manifest.source._tag === 'visual'
      ? resource.manifest.source.definitionPath
      : resource.manifest.source.sourcePath;
  for (const capability of resource.manifest.requiredCapabilities) {
    if (!availableCapabilities.has(capability)) {
      diagnostics.push(
        diagnostic(
          'TBBUILD2201',
          `Behavior requires unavailable capability ${capability}.`,
          sourcePath,
          'Enable the plugin that contributes this capability or remove the dependency.',
          { behaviorId, sourceKind: resource.kind },
        ),
      );
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  if (resource.kind === 'visual') {
    return compileVisualBehavior({
      definition: resource.definition,
      definitionPath: path.join(snapshot.projectRoot, resource.manifest.source.definitionPath),
      registry,
    });
  }
  const files = snapshot.resources
    .filter((entry) => entry.kind === 'typescript')
    .map((entry) => ({
      fileName: path.join(snapshot.projectRoot, entry.manifest.source.sourcePath),
      sourceText: entry.source,
    }));
  return compileTypeScriptBehavior({
    behaviorId,
    projectRoot: snapshot.projectRoot,
    entryFile: path.join(snapshot.projectRoot, resource.manifest.source.sourcePath),
    exportName: resource.manifest.source.exportName,
    files,
  });
};

/** Compiles the one canonical project snapshot into the package every host consumes. */
export const compileProjectBehaviorPackage = async (
  snapshot: ProjectBehaviorSnapshot,
  registry: BehaviorRegistryManifest,
  observer: ProjectBehaviorCompilerObserver = {},
): Promise<ProjectBehaviorPackageResult> => {
  const diagnostics: BehaviorCompileDiagnostic[] = snapshot.diagnostics
    .filter((entry) => entry.severity === 'error')
    .map((entry) =>
      diagnostic(
        entry.code,
        entry.message,
        entry.path ?? '<behavior>',
        entry.code === 'behavior.project-untrusted'
          ? 'Trust the imported project before compiling TypeScript behaviors.'
          : 'Open the behavior source and resolve this project diagnostic.',
        {
          ...(entry.behaviorId === undefined ? {} : { behaviorId: entry.behaviorId }),
          ...(entry.nodeId === undefined ? {} : { nodeId: entry.nodeId }),
          ...(entry.sourceKind === undefined ? {} : { sourceKind: entry.sourceKind }),
        },
      ),
    );
  const availableCapabilities = new Set(registry.entries.map((entry) => entry.capability));
  for (const resource of snapshot.resources) {
    for (const capability of resource.manifest.requiredCapabilities) {
      if (!availableCapabilities.has(capability)) {
        const sourcePath =
          resource.manifest.source._tag === 'visual'
            ? resource.manifest.source.definitionPath
            : resource.manifest.source.sourcePath;
        diagnostics.push(
          diagnostic(
            'TBBUILD2201',
            `Behavior requires unavailable capability ${capability}.`,
            sourcePath,
            'Enable the plugin that contributes this capability or remove the dependency.',
            {
              behaviorId: resource.manifest.id,
              sourceKind: resource.kind,
            },
          ),
        );
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const files = snapshot.resources
    .filter((resource) => resource.kind === 'typescript')
    .map((resource) => ({
      fileName: path.join(snapshot.projectRoot, resource.manifest.source.sourcePath),
      sourceText: resource.source,
    }));
  const compiled: CompiledBehaviorModule[] = [];
  for (const resource of snapshot.resources) {
    const result =
      resource.kind === 'visual'
        ? compileVisualBehavior({
            definition: resource.definition,
            definitionPath: path.join(
              snapshot.projectRoot,
              resource.manifest.source.definitionPath,
            ),
            registry,
          })
        : await compileTypeScriptBehavior({
            behaviorId: resource.manifest.id,
            projectRoot: snapshot.projectRoot,
            entryFile: path.join(snapshot.projectRoot, resource.manifest.source.sourcePath),
            exportName: resource.manifest.source.exportName,
            files,
          });
    if (result.ok) compiled.push(result.artifact);
    else diagnostics.push(...result.diagnostics);
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const encoder = new TextEncoder();
  const result = {
    ok: true,
    diagnostics: [],
    behaviorPackage: new RuntimeBehaviorPackage({
      schemaVersion: 1,
      manifests: snapshot.resources.map((resource) => resource.manifest),
      visualDefinitions: snapshot.resources.flatMap((resource) =>
        resource.kind === 'visual' ? [resource.definition] : [],
      ),
      modules: compiled.map(
        (artifact) =>
          new BehaviorModuleArtifact({
            behaviorId: artifact.behaviorId,
            sourceKind: artifact.sourceKind,
            modulePath: artifact.modulePath,
            hash: artifact.hash,
          }),
      ),
    }),
    modules: compiled.map((artifact) => ({
      path: artifact.modulePath,
      bytes: encoder.encode(artifact.code),
    })),
  };
  observer.onPackageCompiled?.({
    sourceBytes: snapshot.resources.reduce(
      (sum, resource) =>
        sum + (resource.kind === 'typescript' ? encoder.encode(resource.source).byteLength : 0),
      0,
    ),
    modules: result.modules.length,
  });
  return result;
};

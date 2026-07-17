import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type { MapId, PluginId, ProjectId } from '@tileborne/core';
import { PluginManifest } from '@tileborne/plugin-api';
import type { MapServiceError } from '@tileborne/services-app';
import type { TileborneMap } from '@tileborne/core';
import {
  resolvePluginManifestPath,
  type InstalledPlugin,
  type PluginRegistryServiceError,
} from '@tileborne/services-plugin';
import { Effect, Schema } from 'effect';
import type { PluginManifest as PluginManifestType } from '@tileborne/plugin-api';

interface EditorCommandContribution {
  readonly id: string;
  readonly kind?: string;
  readonly entry?: string;
  readonly data?: {
    readonly action?: {
      readonly channel?: string;
      readonly profile?: string;
    };
  };
}

interface ValidationIssue {
  readonly severity: string;
  readonly message: string;
}

interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

const readEditorCommands = (contributes: unknown): readonly EditorCommandContribution[] => {
  if (typeof contributes !== 'object' || contributes === null || !('editor' in contributes)) {
    return [];
  }
  const editor = contributes.editor;
  if (typeof editor !== 'object' || editor === null || !('commands' in editor)) {
    return [];
  }
  const commands = editor.commands;
  return Array.isArray(commands) ? (commands as EditorCommandContribution[]) : [];
};

const findCommandContribution = (
  contributes: unknown,
  contributionId: string,
): EditorCommandContribution | undefined =>
  readEditorCommands(contributes).find((entry) => entry.id === contributionId);

const formatValidationResult = (result: ValidationResult): string => {
  if (result.ok) {
    return 'Map validation passed.';
  }
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  const warnings = result.issues.filter((issue) => issue.severity !== 'error');
  const lines = [
    ...errors.map((issue) => `Error: ${issue.message}`),
    ...warnings.map((issue) => `Warning: ${issue.message}`),
  ];
  return lines.length > 0 ? lines.join('\n') : 'Map validation failed.';
};

const resolvePluginEntry = async (plugin: InstalledPlugin): Promise<string> => {
  const manifestRaw = await readFile(plugin.manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as {
    entry?: { server?: string; editor?: string; runtime?: string };
  };
  const entry = manifest.entry?.server ?? manifest.entry?.editor ?? manifest.entry?.runtime;
  if (!entry) {
    throw new Error(`plugin ${plugin.id} has no executable entrypoint`);
  }
  return resolvePluginManifestPath(plugin.rootPath, entry);
};

interface PluginRegistryApi {
  readonly getManifest: (
    pluginId: PluginId,
  ) => Effect.Effect<PluginManifestType, PluginRegistryServiceError>;
  readonly list: () => Effect.Effect<readonly InstalledPlugin[], PluginRegistryServiceError>;
}

interface MapServiceApi {
  readonly load: (
    projectId: ProjectId,
    mapId: MapId,
  ) => Effect.Effect<TileborneMap, MapServiceError>;
}

export const invokePluginEditorCommand =
  (deps: { readonly registry: PluginRegistryApi; readonly maps: MapServiceApi }) =>
  (input: {
    readonly pluginId: PluginId;
    readonly contributionId: string;
    readonly projectId?: ProjectId | undefined;
    readonly mapId?: MapId | undefined;
  }): Effect.Effect<{ ok: boolean; message?: string | undefined }, Error> =>
    Effect.gen(function* () {
      const manifest = yield* deps.registry
        .getManifest(input.pluginId)
        .pipe(
          Effect.mapError(
            (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          ),
        );
      const encodedManifest = Schema.encodeSync(PluginManifest)(manifest) as {
        contributes: unknown;
      };
      const contribution = findCommandContribution(
        encodedManifest.contributes,
        input.contributionId,
      );
      if (contribution === undefined) {
        return yield* Effect.fail(
          new Error(`command contribution not found: ${input.pluginId}/${input.contributionId}`),
        );
      }

      const plugins = yield* deps.registry.list();
      const plugin = plugins.find((entry) => entry.id === input.pluginId);
      if (plugin === undefined) {
        return yield* Effect.fail(new Error(`plugin not installed: ${input.pluginId}`));
      }

      const kind = contribution.kind ?? 'declarative';
      if (kind === 'declarative') {
        const channel = contribution.data?.action?.channel;
        if (channel === 'tileborne.maps.validate') {
          if (input.projectId === undefined || input.mapId === undefined) {
            return yield* Effect.fail(new Error('Open a map before running map validation.'));
          }
          const map = yield* deps.maps
            .load(input.projectId, input.mapId)
            .pipe(
              Effect.mapError(
                (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
              ),
            );
          const entry = yield* Effect.tryPromise({
            try: () => resolvePluginEntry(plugin),
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          });
          const module = yield* Effect.tryPromise({
            try: () => import(pathToFileURL(entry).href) as Promise<Record<string, unknown>>,
            catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
          });
          const validateMap = module.validateMap;
          if (typeof validateMap !== 'function') {
            return yield* Effect.fail(new Error(`plugin ${plugin.id} does not export validateMap`));
          }
          const result = validateMap(map) as ValidationResult;
          return { ok: result.ok, message: formatValidationResult(result) };
        }
        return yield* Effect.fail(
          new Error(`unsupported declarative command channel: ${channel ?? 'unknown'}`),
        );
      }

      if (contribution.entry === undefined || contribution.entry.length === 0) {
        return yield* Effect.fail(
          new Error(`executable command ${input.contributionId} is missing entry`),
        );
      }

      const entryPath = yield* Effect.tryPromise({
        try: () => resolvePluginManifestPath(plugin.rootPath, contribution.entry!),
        catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
      });
      const module = yield* Effect.tryPromise({
        try: () => import(pathToFileURL(entryPath).href) as Promise<Record<string, unknown>>,
        catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
      });
      if (
        input.projectId !== undefined &&
        input.mapId !== undefined &&
        typeof module.validateMap === 'function'
      ) {
        const map = yield* deps.maps
          .load(input.projectId, input.mapId)
          .pipe(
            Effect.mapError(
              (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
            ),
          );
        const result = module.validateMap(map) as ValidationResult;
        return { ok: result.ok, message: formatValidationResult(result) };
      }
      const defaultHandler = module.default;
      if (typeof defaultHandler === 'function') {
        yield* Effect.tryPromise({
          try: () =>
            Promise.resolve(
              (defaultHandler as (ctx: { pluginId: PluginId; contributionId: string }) => unknown)({
                pluginId: input.pluginId,
                contributionId: input.contributionId,
              }),
            ),
          catch: (cause) => new Error(cause instanceof Error ? cause.message : String(cause)),
        });
        return { ok: true, message: 'Command completed.' };
      }

      return yield* Effect.fail(
        new Error(`executable command ${input.contributionId} has no invokable handler`),
      );
    });

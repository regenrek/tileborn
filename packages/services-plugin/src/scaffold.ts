import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PluginId } from '@tileborne/core';
import { PluginManifest } from '@tileborne/plugin-api';
import { writeJsonAtomic } from '@tileborne/services-foundation';
import { Effect, Schema } from 'effect';

import {
  hashPluginDirectory,
  materializePluginManifestInput,
  runCommand,
  validatePluginDirectory,
  validatePluginManifestPaths,
} from './filesystem.js';
import {
  PLUGIN_MANIFEST_FILE,
  PluginInstallError,
  PluginValidationError,
  type PluginInstallerError,
} from './model.js';

export class PluginPackResult extends Schema.Class<PluginPackResult>('PluginPackResult')({
  archivePath: Schema.String,
  manifest: PluginManifest,
  integrity: Schema.String,
}) {}

export class PluginCreateResult extends Schema.Class<PluginCreateResult>('PluginCreateResult')({
  directory: Schema.String,
  manifest: PluginManifest,
}) {}

export type PluginScaffoldError = PluginInstallerError;

const toMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const defaultContributions = {
  panels: undefined,
  tools: undefined,
  assetPacks: undefined,
  tilesetPacks: undefined,
  editor: undefined,
  runtime: undefined,
  server: undefined,
};

const manifestTemplate = (
  pluginId: PluginId,
  name: string,
  version: string,
  template: string | undefined,
): Record<string, unknown> => ({
  schemaVersion: 1,
  id: pluginId,
  name,
  version,
  displayName: name,
  description: `Tileborne plugin ${name}`,
  author: 'Tileborne',
  license: 'MIT',
  engines: { tileborne: '^0.1.0' },
  repository: undefined,
  homepage: undefined,
  entry: template === 'executable' ? { server: './entry.js' } : undefined,
  contributes: defaultContributions,
  permissions: [],
  dependsOn: [],
  migrations: undefined,
});

export const createPluginScaffold = (
  cwd: string,
  name: string,
  template: string | undefined,
): Effect.Effect<PluginCreateResult, PluginScaffoldError> =>
  Effect.gen(function* () {
    const pluginId = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(PluginId)(`@tileborne-plugins/${name}`),
      catch: (cause) => new PluginValidationError({ path: name, message: toMessage(cause) }),
    });
    const directory = path.resolve(cwd, name);
    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true }),
      catch: (cause) => new PluginInstallError({ path: directory, message: toMessage(cause) }),
    });
    const raw = materializePluginManifestInput(manifestTemplate(pluginId, name, '0.1.0', template));
    const manifest = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(PluginManifest)(raw),
      catch: (cause) => new PluginValidationError({ path: directory, message: toMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () =>
        writeFile(
          path.join(directory, PLUGIN_MANIFEST_FILE),
          `${JSON.stringify(Schema.encodeSync(PluginManifest)(manifest), null, 2)}\n`,
        ),
      catch: (cause) => new PluginInstallError({ path: directory, message: toMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () =>
        writeFile(path.join(directory, 'README.md'), `# ${name}\n\nTileborne plugin scaffold.\n`),
      catch: (cause) => new PluginInstallError({ path: directory, message: toMessage(cause) }),
    });
    if (template === 'executable') {
      yield* Effect.tryPromise({
        try: () =>
          writeFile(
            path.join(directory, 'entry.js'),
            "/** @type {import('@tileborne/plugin-api').PluginModule} */\nexport default {};\n",
          ),
        catch: (cause) => new PluginInstallError({ path: directory, message: toMessage(cause) }),
      });
    }
    return new PluginCreateResult({ directory, manifest });
  });

export const packPluginDirectory = (
  sourcePath: string,
  outPath: string,
): Effect.Effect<PluginPackResult, PluginScaffoldError> =>
  Effect.gen(function* () {
    const resolved = path.resolve(sourcePath);
    yield* Effect.tryPromise({
      try: () => validatePluginDirectory(resolved),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: resolved, message: toMessage(cause) }),
    });
    const manifestInput = yield* Effect.tryPromise({
      try: () =>
        readFile(path.join(resolved, PLUGIN_MANIFEST_FILE), 'utf8').then(
          (raw) => JSON.parse(raw) as unknown,
        ),
      catch: (cause) => new PluginValidationError({ path: resolved, message: toMessage(cause) }),
    });
    const manifest = yield* Effect.try({
      try: () =>
        Schema.decodeUnknownSync(PluginManifest)(materializePluginManifestInput(manifestInput)),
      catch: (cause) => new PluginValidationError({ path: resolved, message: toMessage(cause) }),
    });
    yield* Effect.try({
      try: () => validatePluginManifestPaths(resolved, Schema.encodeSync(PluginManifest)(manifest)),
      catch: (cause) =>
        cause instanceof PluginValidationError
          ? cause
          : new PluginValidationError({ path: resolved, message: toMessage(cause) }),
    });
    const integrity = yield* Effect.tryPromise({
      try: () => hashPluginDirectory(resolved),
      catch: (cause) => new PluginInstallError({ path: resolved, message: toMessage(cause) }),
    });
    const archivePath = path.resolve(outPath);
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(archivePath), { recursive: true }),
      catch: (cause) => new PluginInstallError({ path: archivePath, message: toMessage(cause) }),
    });
    yield* Effect.tryPromise({
      try: () =>
        runCommand('tar', ['-czf', archivePath, '-C', resolved, '.'], path.dirname(archivePath)),
      catch: (cause) => new PluginInstallError({ path: archivePath, message: toMessage(cause) }),
    });
    const archiveHash = yield* Effect.tryPromise({
      try: async () => {
        const bytes = await readFile(archivePath);
        return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      },
      catch: (cause) => new PluginInstallError({ path: archivePath, message: toMessage(cause) }),
    });
    const metadataPath = `${archivePath}.meta.json`;
    yield* writeJsonAtomic(metadataPath, {
      schemaVersion: 1,
      kind: 'plugin',
      pluginId: manifest.id,
      version: manifest.version,
      integrity,
      archiveHash,
    }).pipe(
      Effect.mapError(
        (error) => new PluginInstallError({ path: metadataPath, message: error.message }),
      ),
    );
    return new PluginPackResult({ archivePath, manifest, integrity });
  });

import { Effect, Option } from 'effect';

import { PackId } from '@tileborne/core';
import { AssetService } from '@tileborne/services-app';
import { resolveAssetImportSource } from '../../lib/asset-source.js';
import { resolveProjectId } from '../../lib/project-context.js';
import { runCliCommand } from '../../lib/run-command.js';
import { globalArgs, readStringArg, type CliRunContext } from '../shared.js';

const optionToUndefined = <A>(value: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(value);

const licenseView = (license: {
  readonly spdxId: string;
  readonly attribution: Option.Option<string>;
  readonly sourceUrl: Option.Option<string>;
  readonly notes: Option.Option<string>;
}) => ({
  spdxId: license.spdxId,
  attribution: optionToUndefined(license.attribution),
  sourceUrl: optionToUndefined(license.sourceUrl),
  notes: optionToUndefined(license.notes),
});

export const assetCommand = {
  meta: {
    name: 'asset',
    description: 'Import and manage Tileborne asset packs',
  },
  subCommands: {
    import: {
      meta: { name: 'import', description: 'Import an asset pack directory or .tbpack archive' },
      args: {
        ...globalArgs,
        source: {
          type: 'positional' as const,
          description: 'Directory or .tbpack path',
          required: true,
        },
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        const source = readStringArg(context.args, 'source');
        if (!source) {
          const { renderFailure } = await import('../../render/output.js');
          const { ExitCode } = await import('../../render/exit-codes.js');
          const { readGlobalCliArgs, renderContextFromArgs } = await import('../shared.js');
          renderFailure(
            renderContextFromArgs(readGlobalCliArgs(context.args)),
            new Error('asset import requires a source path'),
            ExitCode.Usage,
          );
          return;
        }
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const projectSlug = readStringArg(context.args, 'project');
            if (projectSlug) {
              yield* resolveProjectId(projectSlug);
            }
            const assets = yield* AssetService;
            const packId = yield* assets.importPackNow(resolveAssetImportSource(source));
            return projectSlug ? { packId, project: projectSlug } : { packId };
          }),
        );
      },
    },
    list: {
      meta: { name: 'list', description: 'List installed asset packs' },
      args: {
        ...globalArgs,
        project: {
          type: 'string' as const,
          description: 'Filter to a project slug',
          required: false,
        },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const projectSlug = readStringArg(context.args, 'project');
            const packs = projectSlug
              ? yield* assets.listProjectPacks(projectSlug)
              : yield* assets.listPacks();
            return {
              packs: packs.map((pack) => ({
                id: pack.id,
                name: pack.name,
                version: pack.version,
                assetCount: pack.assets.length,
              })),
            };
          }),
        );
      },
    },
    info: {
      meta: { name: 'info', description: 'Show asset pack metadata' },
      args: {
        ...globalArgs,
        id: { type: 'positional' as const, description: 'Asset pack id', required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const id = readStringArg(context.args, 'id') as PackId;
            const pack = yield* assets.getPack(id);
            return {
              id: pack.id,
              name: pack.name,
              version: pack.version,
              assetCount: pack.assets.length,
              license: pack.license.spdxId,
              assets: pack.assets.map((asset) => ({
                id: asset.id,
                path: asset.path,
                mime: asset.mime,
                hash: asset.hash,
              })),
            };
          }),
        );
      },
    },
    describe: {
      meta: {
        name: 'describe',
        description: 'Show asset pack capability, diagnostics, and provenance',
      },
      args: {
        ...globalArgs,
        packId: { type: 'positional' as const, description: 'Asset pack id', required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const packId = readStringArg(context.args, 'packId') as PackId;
            const described = yield* assets.describePack(packId);
            return {
              id: described.pack.id,
              name: described.pack.name,
              version: described.pack.version,
              assetCount: described.pack.assets.length,
              license: licenseView(described.pack.license),
              provenance: {
                attribution: optionToUndefined(described.pack.license.attribution),
                sourceUrl: optionToUndefined(described.pack.license.sourceUrl),
                notes: optionToUndefined(described.pack.license.notes),
              },
              capability: described.capability,
              diagnostics: described.diagnostics,
            };
          }),
        );
      },
    },
    remove: {
      meta: { name: 'remove', description: 'Remove an installed asset pack' },
      args: {
        ...globalArgs,
        packId: { type: 'positional' as const, description: 'Asset pack id', required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const assets = yield* AssetService;
            const id = readStringArg(context.args, 'packId') as PackId;
            yield* assets.removePack(id);
            return { removed: id };
          }),
        );
      },
    },
    reindex: {
      meta: { name: 'reindex', description: 'Rebuild the asset index for the active project' },
      args: {
        ...globalArgs,
        project: { type: 'string' as const, description: 'Project slug', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const assets = yield* AssetService;
            return yield* assets.reindex(readStringArg(context.args, 'project'));
          }),
        );
      },
    },
  },
};

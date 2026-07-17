import { Effect, Option } from 'effect';

import { SupportService, SupportBundleOptions } from '@tileborne/services-build';
import { AssetService } from '@tileborne/services-app';
import { PluginRegistryService } from '@tileborne/services-plugin';
import { runCliCommand } from '../../lib/run-command.js';
import { globalArgs, readStringArg, type CliRunContext } from '../shared.js';

export const supportCommand = {
  meta: { name: 'support', description: 'Collect support diagnostics' },
  subCommands: {
    bundle: {
      meta: { name: 'bundle', description: 'Create a support diagnostics tarball' },
      args: {
        ...globalArgs,
        out: { type: 'string' as const, description: 'Output .tar.gz path', required: false },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const support = yield* SupportService;
            const plugins = yield* PluginRegistryService;
            const assets = yield* AssetService;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const out =
              readStringArg(context.args, 'out') ?? `tileborne-support-${timestamp}.tar.gz`;
            const bundle = yield* support.writeBundle(
              out,
              new SupportBundleOptions({
                includeLogs: Option.some(true),
                includeConfig: Option.some(true),
                delayMs: Option.none(),
              }),
            );
            const pluginList = yield* plugins.verify();
            const assetList = yield* assets.listPacks();
            return {
              archivePath: out,
              bundleId: bundle.id,
              pluginCount: pluginList.length,
              assetPackCount: assetList.length,
              redactedFiles: bundle.redactedFiles,
            };
          }),
        );
      },
    },
  },
};

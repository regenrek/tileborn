import path from 'node:path';

import { LoggerService } from '@tileborne/services-foundation';
import { DevSymlinkPluginSource, PluginInstallerService } from '@tileborne/services-plugin';
import { Effect } from 'effect';

import { spawnTracked } from '../../lib/spawn.js';
import { cancelActiveCliWork, runCliEffect } from '../../services-layer.js';
import { renderFailure, renderInfo, setVerboseLevel } from '../../render/output.js';
import { ExitCode } from '../../render/exit-codes.js';
import {
  globalArgs,
  readGlobalCliArgs,
  readStringArg,
  renderContextFromArgs,
  type CliRunContext,
} from '../shared.js';

export const devCommand = {
  meta: { name: 'dev', description: 'Run Tileborne development workflows' },
  subCommands: {
    desktop: {
      meta: { name: 'desktop', description: 'Start the desktop app dev server' },
      args: globalArgs,
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        setVerboseLevel(args.verbose);
        await runCliEffect(
          Effect.gen(function* () {
            const logger = yield* LoggerService;
            yield* logger.info('starting desktop dev', {
              command: 'pnpm --filter @tileborne/desktop dev',
            });
          }),
        );
        const child = spawnTracked('pnpm', ['--filter', '@tileborne/desktop', 'dev']);
        const shutdown = () => {
          cancelActiveCliWork();
          child.kill('SIGINT');
          process.exit(130);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        const code = await child.exited;
        process.exit(code ?? 0);
      },
    },
    'game-host': {
      meta: {
        name: 'game-host',
        description: 'Run game serve with watch (delegates to game serve)',
      },
      args: {
        ...globalArgs,
        port: { type: 'string' as const, description: 'Port', default: '8787' },
      },
      async run(context: CliRunContext) {
        const port = readStringArg(context.args, 'port') ?? '8787';
        const child = spawnTracked(process.execPath, [
          path.resolve(import.meta.dirname, '../../../dist/main.js'),
          'game',
          'serve',
          '--port',
          port,
        ]);
        const shutdown = () => {
          cancelActiveCliWork();
          child.kill('SIGINT');
          process.exit(130);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        await child.exited;
      },
    },
    plugin: {
      meta: {
        name: 'plugin',
        description: 'Watch a plugin source directory and reinstall on change',
      },
      args: {
        ...globalArgs,
        id: {
          type: 'positional' as const,
          description: 'Plugin id or source directory',
          required: true,
        },
      },
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const source = readStringArg(context.args, 'id');
        if (!source) {
          renderFailure(ctx, new Error('plugin source path is required'), ExitCode.Usage);
          return;
        }
        const resolved = path.resolve(source);
        const { watch } = await import('node:fs');
        let running = false;
        const reinstall = async () => {
          if (running) {
            return;
          }
          running = true;
          try {
            await runCliEffect(
              Effect.gen(function* () {
                const installer = yield* PluginInstallerService;
                const logger = yield* LoggerService;
                yield* logger.info('dev plugin reinstall', { source: resolved });
                yield* installer.install(new DevSymlinkPluginSource({ linkPath: resolved }));
              }),
            );
          } finally {
            running = false;
          }
        };
        await reinstall();
        const watcher = watch(resolved, { recursive: true }, () => void reinstall());
        const shutdown = () => {
          cancelActiveCliWork();
          watcher.close();
          process.exit(130);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        renderInfo(ctx, 'watching plugin source', { path: resolved });
        await new Promise<void>(() => undefined);
      },
    },
  },
};

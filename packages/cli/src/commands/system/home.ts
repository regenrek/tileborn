import { Effect, Option } from 'effect';

import { ConfigService, HomeService } from '@tileborne/services-foundation';

import { runCliEffect } from '../../services-layer.js';
import { mapErrorToExitCode } from '../../render/errors.js';
import { renderFailure, renderSuccess, setVerboseLevel } from '../../render/output.js';
import {
  globalArgs,
  readGlobalCliArgs,
  readStringArg,
  renderContextFromArgs,
  type CliRunContext,
} from '../shared.js';

const showHome = async (ctx: ReturnType<typeof renderContextFromArgs>) => {
  const { readdir } = await import('node:fs/promises');
  const result = await runCliEffect(
    Effect.gen(function* () {
      const home = yield* HomeService;
      const paths = yield* home.init();
      const entries = yield* Effect.tryPromise({
        try: () => readdir(paths.root),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      return {
        home: process.env['TILEBORNE_HOME'] ?? paths.root,
        root: paths.root,
        entries,
        paths,
      };
    }),
  );
  renderSuccess(ctx, result);
};

export const homeCommand = {
  meta: {
    name: 'home',
    description: 'Show or configure the Tileborne home directory',
  },
  subCommands: {
    set: {
      meta: { name: 'set', description: 'Set the Tileborne home directory' },
      args: {
        ...globalArgs,
        path: {
          type: 'positional' as const,
          description: 'New home directory path',
          required: true,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        const homePath = readStringArg(context.args, 'path');
        if (!homePath) {
          renderFailure(ctx, new Error('home set requires a path argument'), 64);
          return;
        }
        try {
          const result = await runCliEffect(
            Effect.gen(function* () {
              const home = yield* HomeService;
              const config = yield* ConfigService;
              const paths = yield* home.setRoot(homePath);
              const next = yield* config.set({ homePath: Option.some(paths.root) });
              return { paths, config: next };
            }),
          );
          renderSuccess(ctx, result);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
  },
  args: globalArgs,
  async run(context: CliRunContext) {
    const global = readGlobalCliArgs(context.args);
    const ctx = renderContextFromArgs(global);
    setVerboseLevel(global.verbose);
    try {
      await showHome(ctx);
    } catch (error) {
      renderFailure(ctx, error, mapErrorToExitCode(error));
    }
  },
};

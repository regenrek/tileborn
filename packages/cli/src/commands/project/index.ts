import { Effect, Option } from 'effect';

import { ProjectService } from '@tileborne/services-app';
import { ConfigService } from '@tileborne/services-foundation';

import { runCliEffect } from '../../services-layer.js';
import { mapErrorToExitCode } from '../../render/errors.js';
import { renderFailure, renderSuccess, setVerboseLevel } from '../../render/output.js';
import {
  globalArgs,
  readBooleanArg,
  readGlobalCliArgs,
  readStringArg,
  renderContextFromArgs,
  type CliRunContext,
} from '../shared.js';

const readPluginIds = (args: Record<string, unknown>): readonly string[] => {
  const plugin = args['plugin'];
  if (typeof plugin === 'string') {
    return [plugin];
  }
  if (Array.isArray(plugin)) {
    return plugin.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
};

export const projectCommand = {
  meta: {
    name: 'project',
    description: 'Initialize and manage Tileborne projects',
  },
  subCommands: {
    init: {
      meta: { name: 'init', description: 'Create a new project' },
      args: {
        ...globalArgs,
        slug: {
          type: 'positional' as const,
          description: 'Project slug or directory',
          required: false,
        },
        here: {
          type: 'boolean' as const,
          description: 'Initialize in the current working directory',
          default: false,
        },
        template: {
          type: 'string' as const,
          description: 'Project template id',
          required: false,
        },
        plugin: {
          type: 'string' as const,
          description: 'Plugin id to declare (repeatable)',
          required: false,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        const slug = readStringArg(context.args, 'slug');
        if (!slug) {
          renderFailure(ctx, new Error('project slug is required'), 64);
          return;
        }
        try {
          const result = await runCliEffect(
            Effect.gen(function* () {
              const projects = yield* ProjectService;
              const config = yield* ConfigService;
              const created = yield* projects.init({
                slug,
                here: readBooleanArg(context.args, 'here'),
                template: readStringArg(context.args, 'template'),
                plugins: readPluginIds(context.args),
              });
              yield* config.set({ lastOpenedProject: Option.some(created.manifest.id) });
              return created;
            }),
          );
          renderSuccess(ctx, result);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
    info: {
      meta: { name: 'info', description: 'Show project metadata' },
      args: {
        ...globalArgs,
        at: {
          type: 'string' as const,
          description: 'Project directory',
          required: false,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const result = await runCliEffect(
            Effect.gen(function* () {
              const projects = yield* ProjectService;
              return yield* projects.info(readStringArg(context.args, 'at'));
            }),
          );
          renderSuccess(ctx, result);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
    upgrade: {
      meta: { name: 'upgrade', description: 'Migrate project schema to the latest version' },
      args: {
        ...globalArgs,
        at: {
          type: 'string' as const,
          description: 'Project directory',
          required: false,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const result = await runCliEffect(
            Effect.gen(function* () {
              const projects = yield* ProjectService;
              return yield* projects.upgrade(readStringArg(context.args, 'at'));
            }),
          );
          renderSuccess(ctx, result);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
    clean: {
      meta: { name: 'clean', description: 'Remove project caches and derived artifacts' },
      args: {
        ...globalArgs,
        at: {
          type: 'string' as const,
          description: 'Project directory',
          required: false,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const result = await runCliEffect(
            Effect.gen(function* () {
              const projects = yield* ProjectService;
              return yield* projects.clean(readStringArg(context.args, 'at'));
            }),
          );
          renderSuccess(ctx, result);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
  },
};

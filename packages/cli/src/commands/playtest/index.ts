import { Effect } from 'effect';

import { runHeadlessPlaytest } from '../../lib/playtest-headless.js';
import { runMultiplayerPlaytest } from '../../lib/multiplayer-playtest.js';
import { requestSignalExitCode } from '../../lib/shutdown.js';
import { resolveProjectId, readMapIdArg, readProjectSlugArg } from '../../lib/project-context.js';
import { runCliCommand } from '../../lib/run-command.js';
import { PlaytestService } from '@tileborne/services-build';
import { CliValidationError } from '../../render/errors.js';
import { mapErrorToExitCode } from '../../render/errors.js';
import { renderFailure, setVerboseLevel } from '../../render/output.js';
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

const readPortArg = (args: Record<string, unknown>, fallback: number): number => {
  const raw = readStringArg(args, 'port');
  const parsed = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliValidationError({ message: 'port must be 0 (auto) or a positive integer' });
  }
  return parsed;
};

const readPlayersArg = (args: Record<string, unknown>, fallback: number): number => {
  const raw = readStringArg(args, 'players');
  const parsed = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliValidationError({ message: 'players must be a positive integer' });
  }
  return parsed;
};

export const playtestCommand = {
  meta: { name: 'playtest', description: 'Run local playtest sessions' },
  args: {
    ...globalArgs,
    mapId: { type: 'positional' as const, description: 'Map id', required: true },
    target: { type: 'string' as const, description: 'headless|browser', default: 'headless' },
    artifact: {
      type: 'string' as const,
      description: 'Artifact output directory',
      required: false,
    },
    duration: {
      type: 'string' as const,
      description: 'Headless duration in seconds',
      default: '5',
    },
    open: {
      type: 'boolean' as const,
      description: 'Open desktop client via tileborne:// deep link',
      default: false,
    },
    multiplayer: {
      type: 'boolean' as const,
      description: 'Boot local miniflare game-host and create a room',
      default: false,
    },
    port: {
      type: 'string' as const,
      description: 'Local game-host port (0 = auto)',
      default: '8787',
    },
    players: { type: 'string' as const, description: 'Maximum players for the room', default: '4' },
    plugin: { type: 'string' as const, description: 'Plugin id (repeatable)', required: false },
    project: { type: 'string' as const, description: 'Project slug', required: false },
  },
  async run(context: CliRunContext) {
    const args = readGlobalCliArgs(context.args);
    const ctx = renderContextFromArgs(args);
    setVerboseLevel(args.verbose);

    if (readBooleanArg(context.args, 'multiplayer')) {
      requestSignalExitCode(0);
      try {
        await runMultiplayerPlaytest(ctx, {
          mapId: readMapIdArg(context.args, 'mapId'),
          projectSlug: readProjectSlugArg(context.args),
          port: readPortArg(context.args, 8787),
          players: readPlayersArg(context.args, 4),
          plugins: readPluginIds(context.args),
          open: readBooleanArg(context.args, 'open'),
        });
      } catch (error) {
        renderFailure(ctx, error, mapErrorToExitCode(error));
      }
      return;
    }

    await runCliCommand(
      context,
      Effect.gen(function* () {
        const projectId = yield* resolveProjectId(readProjectSlugArg(context.args));
        const mapId = readMapIdArg(context.args, 'mapId');
        const target = readStringArg(context.args, 'target') ?? 'headless';
        const durationSec = Number.parseFloat(readStringArg(context.args, 'duration') ?? '5');
        const plugins = readPluginIds(context.args);
        const playtest = yield* PlaytestService;
        yield* playtest.start(projectId, mapId);
        const artifactOut = readStringArg(context.args, 'artifact');
        const artifact = yield* playtest.assembleArtifact({
          projectId,
          mapId,
          plugins,
          ...(artifactOut ? { outputDirectory: artifactOut } : {}),
        });
        if (target === 'browser') {
          const url = `file://${artifact.indexPath}`;
          if (readBooleanArg(context.args, 'open')) {
            const platform = process.platform;
            const opener =
              platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
            yield* Effect.tryPromise({
              try: async () => {
                const { execFile } = await import('node:child_process');
                const { promisify } = await import('node:util');
                await promisify(execFile)(opener, [artifact.indexPath]);
              },
              catch: () => Effect.succeed(void 0),
            });
          }
          return { target, artifactPath: artifact.directory, url };
        }
        if (!Number.isFinite(durationSec) || durationSec <= 0) {
          yield* Effect.fail(
            new CliValidationError({ message: 'duration must be a positive number' }),
          );
        }
        const stats = yield* Effect.promise(() => runHeadlessPlaytest(artifact, durationSec));
        return { target, artifactPath: artifact.directory, stats };
      }),
    );
  },
};

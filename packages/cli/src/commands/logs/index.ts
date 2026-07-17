import path from 'node:path';

import { LoggerService } from '@tileborne/services-foundation';
import { Effect } from 'effect';

import { cancelActiveCliWork, runCliEffect } from '../../services-layer.js';
import { renderFailure, renderSuccess, setVerboseLevel } from '../../render/output.js';
import { ExitCode } from '../../render/exit-codes.js';
import {
  globalArgs,
  readBooleanArg,
  readGlobalCliArgs,
  readStringArg,
  renderContextFromArgs,
  type CliRunContext,
} from '../shared.js';

const parseSince = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    return 0;
  }
  const amount = Number.parseInt(match[1] ?? '0', 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const multiplier = unit ? multipliers[unit] : undefined;
  return Date.now() - amount * (multiplier ?? 1000);
};

export const logsCommand = {
  meta: { name: 'logs', description: 'Read Tileborne log files' },
  subCommands: {
    tail: {
      meta: { name: 'tail', description: 'Print log lines (optionally follow)' },
      args: {
        ...globalArgs,
        follow: { type: 'boolean' as const, description: 'Follow log file', default: false },
        since: {
          type: 'string' as const,
          description: 'Only lines since duration (e.g. 5m)',
          default: '5m',
        },
      },
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        const follow = readBooleanArg(context.args, 'follow');
        const sinceMs = parseSince(readStringArg(context.args, 'since'));
        const controller = new AbortController();
        const shutdown = () => {
          cancelActiveCliWork();
          controller.abort();
          process.exit(130);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        try {
          const lines = await runCliEffect(
            Effect.gen(function* () {
              const logger = yield* LoggerService;
              return yield* logger.tail({ sinceMs, follow, signal: controller.signal });
            }),
          );
          for await (const line of lines) {
            process.stdout.write(`${line}\n`);
          }
        } catch (error) {
          renderFailure(ctx, error, ExitCode.NoInput);
        }
      },
    },
    path: {
      meta: { name: 'path', description: 'Print the active log file path' },
      args: globalArgs,
      async run(context: CliRunContext) {
        const args = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(args);
        setVerboseLevel(args.verbose);
        try {
          const filePath = await runCliEffect(
            Effect.gen(function* () {
              const logger = yield* LoggerService;
              return yield* logger.latestLogPath();
            }),
          );
          if (!filePath) {
            renderFailure(ctx, new Error('no log file found'), ExitCode.NoInput);
            return;
          }
          renderSuccess(ctx, { path: path.resolve(filePath) });
        } catch (error) {
          renderFailure(ctx, error, ExitCode.NoInput);
        }
      },
    },
  },
};

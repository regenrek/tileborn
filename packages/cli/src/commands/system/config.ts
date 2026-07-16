import { Effect, Option } from 'effect';

import {
  ConfigService,
  type LoggerLevel,
  type TileborneConfig,
} from '@tileborne/services-foundation';

import { runCliEffect } from '../../services-layer.js';
import { CliUsageError, CliValidationError, mapErrorToExitCode } from '../../render/errors.js';
import { renderFailure, renderSuccess, setVerboseLevel } from '../../render/output.js';
import {
  globalArgs,
  readGlobalCliArgs,
  readStringArg,
  renderContextFromArgs,
  type CliRunContext,
} from '../shared.js';

const CONFIG_KEYS = ['loggerLevel', 'telemetryOptIn', 'lastOpenedProject', 'homePath'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

const isConfigKey = (key: string): key is ConfigKey =>
  (CONFIG_KEYS as readonly string[]).includes(key);

const parseConfigValue = (key: ConfigKey, raw: string): TileborneConfig[keyof TileborneConfig] => {
  switch (key) {
    case 'loggerLevel':
      if (!['trace', 'debug', 'info', 'warn', 'error', 'silent'].includes(raw)) {
        throw new CliValidationError({ message: `invalid loggerLevel: ${raw}` });
      }
      return raw as LoggerLevel;
    case 'telemetryOptIn':
      if (raw === 'true') {
        return true;
      }
      if (raw === 'false') {
        return false;
      }
      throw new CliValidationError({ message: `invalid boolean for telemetryOptIn: ${raw}` });
    case 'lastOpenedProject':
    case 'homePath':
      return raw.length === 0 ? Option.none() : Option.some(raw);
    default:
      throw new CliValidationError({ message: `unsupported config key: ${key}` });
  }
};

const patchForKey = (key: ConfigKey, value: TileborneConfig[keyof TileborneConfig]) => {
  switch (key) {
    case 'loggerLevel':
      return { loggerLevel: value as LoggerLevel };
    case 'telemetryOptIn':
      return { telemetryOptIn: value as boolean };
    case 'lastOpenedProject':
      return { lastOpenedProject: value as Option.Option<string> };
    case 'homePath':
      return { homePath: value as Option.Option<string> };
  }
};

export const configCommand = {
  meta: {
    name: 'config',
    description: 'Read or update Tileborne configuration',
  },
  subCommands: {
    get: {
      meta: { name: 'get', description: 'Get a configuration value' },
      args: {
        ...globalArgs,
        key: {
          type: 'positional' as const,
          description: 'Configuration key',
          required: true,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const keyValue = readStringArg(context.args, 'key');
          if (!keyValue || !isConfigKey(keyValue)) {
            throw new CliUsageError({ message: `unknown config key: ${keyValue ?? '<missing>'}` });
          }
          const key = keyValue;
          const value = await runCliEffect(
            Effect.gen(function* () {
              const config = yield* ConfigService;
              const current = yield* config.get;
              switch (key) {
                case 'loggerLevel':
                  return current.loggerLevel;
                case 'telemetryOptIn':
                  return current.telemetryOptIn;
                case 'lastOpenedProject':
                  return current.lastOpenedProject;
                case 'homePath':
                  return current.homePath;
              }
            }),
          );
          renderSuccess(ctx, { key, value });
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
    set: {
      meta: { name: 'set', description: 'Set a configuration value' },
      args: {
        ...globalArgs,
        key: {
          type: 'positional' as const,
          description: 'Configuration key',
          required: true,
        },
        value: {
          type: 'positional' as const,
          description: 'Configuration value',
          required: true,
        },
      },
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const keyValue = readStringArg(context.args, 'key');
          const rawValue = readStringArg(context.args, 'value');
          if (!keyValue || !isConfigKey(keyValue) || rawValue === undefined) {
            throw new CliUsageError({ message: 'config set requires <key> <value>' });
          }
          const key = keyValue;
          const parsed = parseConfigValue(key, rawValue);
          const next = await runCliEffect(
            Effect.gen(function* () {
              const config = yield* ConfigService;
              return yield* config.set(patchForKey(key, parsed));
            }),
          );
          const nextValue =
            key === 'loggerLevel'
              ? next.loggerLevel
              : key === 'telemetryOptIn'
                ? next.telemetryOptIn
                : key === 'lastOpenedProject'
                  ? next.lastOpenedProject
                  : next.homePath;
          renderSuccess(ctx, { key, value: nextValue, config: next });
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
    list: {
      meta: { name: 'list', description: 'List all configuration values' },
      args: globalArgs,
      async run(context: CliRunContext) {
        const global = readGlobalCliArgs(context.args);
        const ctx = renderContextFromArgs(global);
        setVerboseLevel(global.verbose);
        try {
          const config = await runCliEffect(
            Effect.gen(function* () {
              const svc = yield* ConfigService;
              return yield* svc.get;
            }),
          );
          renderSuccess(ctx, config);
        } catch (error) {
          renderFailure(ctx, error, mapErrorToExitCode(error));
        }
      },
    },
  },
};

import type { RenderContext } from '../render/output.js';

export interface GlobalCliArgs {
  readonly json: boolean;
  readonly verbose: boolean;
}

export const globalArgs = {
  json: {
    type: 'boolean' as const,
    description: 'Emit machine-readable JSON output',
    default: false,
  },
  verbose: {
    type: 'boolean' as const,
    description: 'Enable verbose logging',
    alias: ['v'],
    default: false,
  },
};

export const readGlobalCliArgs = (args: Record<string, unknown>): GlobalCliArgs => ({
  json: args['json'] === true,
  verbose: args['verbose'] === true,
});

export const readStringArg = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
};

export const readBooleanArg = (
  args: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean => (args[key] === true ? true : args[key] === false ? false : fallback);

export const renderContextFromArgs = (args: GlobalCliArgs): RenderContext => ({
  json: args.json,
  verbose: args.verbose,
});

export const PACKAGE_VERSION = '0.0.0';

export type CliRunContext = { args: Record<string, unknown> };

import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { scanTiledSource } from '@tileborne/sdk-tileset/tiled';
import { Effect } from 'effect';

import { runCliCommand } from '../../lib/run-command.js';
import { CliValidationError } from '../../render/errors.js';
import { globalArgs, readStringArg, type CliRunContext } from '../shared.js';

export const tiledCommand = {
  meta: { name: 'tiled', description: 'Inspect and import standard Tiled sources' },
  subCommands: {
    scan: {
      meta: { name: 'scan', description: 'Scan a Tiled TMX or TMJ source' },
      args: {
        ...globalArgs,
        file: { type: 'positional' as const, description: 'Tiled TMX or TMJ file', required: true },
      },
      async run(context: CliRunContext) {
        await runCliCommand(
          context,
          Effect.gen(function* () {
            const file = readStringArg(context.args, 'file');
            if (!file) {
              yield* Effect.fail(
                new CliValidationError({ message: 'tiled file path is required' }),
              );
            }
            const sourcePath = path.resolve(file as string);
            const result = yield* Effect.promise(() =>
              scanTiledSource({
                sourcePath,
                projectRoot: path.dirname(sourcePath),
                reader: { readFile, realpath },
              }),
            );
            const blocking = result.diagnostics.find(
              (diagnostic) => diagnostic.severity === 'error',
            );
            if (blocking !== undefined || result.scan === undefined) {
              yield* Effect.fail(
                new CliValidationError({ message: blocking?.message ?? 'Tiled scan failed' }),
              );
            }
            return result.scan;
          }),
        );
      },
    },
  },
};

import type { ParseDiagnostic, ParseResult } from '../diagnostics.js';

import { compileTiledTileset } from './compile-tileset.js';
import { normalizeTiledTilesetImageAssetPaths } from './image-paths.js';
import { validateTiledJsonTileset } from './validate.js';
import type { TiledImportOptions, TiledJsonTileset } from './types.js';

export const parseTsj = (
  raw: string,
  options: Pick<TiledImportOptions, 'packIdSeed' | 'profile'> & {
    readonly tilesetSeed: string;
    readonly projectRoot?: string | undefined;
    readonly basePath?: string | undefined;
    readonly validateImagePaths?: boolean;
  },
): ParseResult<ReturnType<typeof compileTiledTileset>['value']> & {
  readonly diagnostics: readonly ParseDiagnostic[];
} => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: '/',
          message: `Failed to parse TSJ JSON: ${(error as Error).message}`,
          severity: 'error',
          format: 'tsj',
        },
      ],
    };
  }

  const validated = validateTiledJsonTileset(json);
  if (!validated.ok) return { diagnostics: [validated.diagnostic] };
  const normalized =
    options.validateImagePaths === true
      ? normalizeTiledTilesetImageAssetPaths(
          validated.tileset,
          options.projectRoot === undefined
            ? undefined
            : {
                projectRoot: options.projectRoot,
                basePath: options.basePath ?? options.projectRoot,
                allowParentTraversalWithinRoot: options.basePath !== undefined,
              },
        )
      : { tileset: validated.tileset, diagnostics: [] };
  if (normalized.tileset === undefined) return { diagnostics: normalized.diagnostics };
  return compileTiledTileset({
    packSeed: options.packIdSeed,
    tilesetSeed: options.tilesetSeed,
    source: normalized.tileset,
    profile: options.profile,
  });
};

export const parseTsjTileset = (json: unknown): TiledJsonTileset | undefined => {
  const validated = validateTiledJsonTileset(json);
  if (!validated.ok) return undefined;
  return normalizeTiledTilesetImageAssetPaths(validated.tileset).tileset;
};

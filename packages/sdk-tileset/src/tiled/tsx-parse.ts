import type { ParseDiagnostic, ParseResult } from '../diagnostics.js';

import { compileTiledTileset } from './compile-tileset.js';
import { normalizeTiledTilesetImageAssetPaths } from './image-paths.js';
import { validateTiledJsonTileset } from './validate.js';
import { convertTiledXmlTileset, parseTiledXmlDocument, xmlTilesetRoot } from './xml-common.js';
import type { TiledImportOptions } from './types.js';

export const parseTsx = (
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
  const parsed = parseTiledXmlDocument(raw);
  if (!parsed.ok) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: '/',
          message: parsed.error,
          severity: 'error',
          format: 'tsx',
        },
      ],
    };
  }

  const root = xmlTilesetRoot(parsed.value);
  if (!root) {
    return {
      diagnostics: [
        {
          _tag: 'TiledParseError',
          path: '/',
          message: 'Tiled XML tileset is missing <tileset> root',
          severity: 'error',
          format: 'tsx',
        },
      ],
    };
  }

  const validated = validateTiledJsonTileset(convertTiledXmlTileset(root));
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

import { Asset, TileSet } from "@tileborne/core";
import type { Result } from "effect";

import type { AssetImportError } from "../errors.js";

export interface ImporterInput {
  readonly filename: string;
  readonly path?: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly [metadata: string]: unknown;
}

export type ImportedAsset = Asset | TileSet;

export interface AssetImporter {
  readonly id: string;
  readonly supports: (input: ImporterInput) => boolean;
  readonly import: (input: ImporterInput) => Result.Result<readonly ImportedAsset[], AssetImportError>;
}

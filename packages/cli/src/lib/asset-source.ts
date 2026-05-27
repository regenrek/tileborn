import path from "node:path";

import { DirectoryAssetPackSource, TarballAssetPackSource } from "@tileborne/services-app";

export const resolveAssetImportSource = (source: string): DirectoryAssetPackSource | TarballAssetPackSource => {
  const resolved = path.resolve(source);
  if (source.endsWith(".tbpack") || resolved.endsWith(".tbpack")) {
    return new TarballAssetPackSource({ path: resolved });
  }
  return new DirectoryAssetPackSource({ path: resolved });
};

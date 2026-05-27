import { Asset, hashBytes } from "@tileborne/core";
import { Result } from "effect";

import { UnsupportedImporterInputError } from "../errors.js";
import { isImageMimeType } from "../security/mime-allowlist.js";
import { validateAssetCandidate } from "../security/security.js";
import { deterministicAssetId } from "./deterministic-id.js";
import type { AssetImporter, ImporterInput } from "./importer.js";

export interface ImageImporterInput extends ImporterInput {
  readonly mime: "image/png" | "image/webp" | "image/jpeg";
}

export const imageImporter: AssetImporter = {
  id: "tileborne.image",
  supports: (input): input is ImageImporterInput => isImageMimeType(input.mime),
  import: (input) => {
    if (!imageImporter.supports(input)) {
      return Result.fail(
        new UnsupportedImporterInputError({
          importerId: imageImporter.id,
          mime: input.mime,
          message: `Unsupported image MIME: ${input.mime}`,
        }),
      );
    }

    const validated = validateAssetCandidate(input);
    if (Result.isFailure(validated)) {
      return Result.fail(validated.failure);
    }

    const hash = hashBytes(input.bytes);
    const asset = new Asset({
      id: deterministicAssetId(`${imageImporter.id}:${input.filename}:${hash}`),
      kind: "image",
      path: input.path ?? input.filename,
      properties: {
        hash,
        mime: input.mime,
        size: input.bytes.byteLength,
      },
    });

    return Result.succeed([asset]);
  },
};

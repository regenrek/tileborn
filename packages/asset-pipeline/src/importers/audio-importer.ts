import { Asset, hashBytes } from "@tileborne/core";
import { Result } from "effect";

import { UnsupportedImporterInputError } from "../errors.js";
import { isAudioMimeType } from "../security/mime-allowlist.js";
import { validateAssetCandidate } from "../security/security.js";
import { deterministicAssetId } from "./deterministic-id.js";
import type { AssetImporter, ImporterInput } from "./importer.js";

export interface AudioImporterInput extends ImporterInput {
  readonly mime: "audio/wav" | "audio/wave" | "audio/x-wav" | "audio/ogg" | "audio/mpeg";
}

export const audioImporter: AssetImporter = {
  id: "tileborne.audio",
  supports: (input): input is AudioImporterInput => isAudioMimeType(input.mime),
  import: (input) => {
    if (!audioImporter.supports(input)) {
      return Result.fail(
        new UnsupportedImporterInputError({
          importerId: audioImporter.id,
          mime: input.mime,
          message: `Unsupported audio MIME: ${input.mime}`,
        }),
      );
    }

    const validated = validateAssetCandidate(input);
    if (Result.isFailure(validated)) {
      return Result.fail(validated.failure);
    }

    const hash = hashBytes(input.bytes);
    const asset = new Asset({
      id: deterministicAssetId(`${audioImporter.id}:${input.filename}:${hash}`),
      kind: "audio",
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

import { Result } from "effect";

import {
  AssetExtensionMismatchError,
  AssetMagicByteMismatchError,
  AssetMimeRejectedError,
  AssetTooLargeError,
  type AssetSecurityError,
} from "../errors.js";
import { extensionOf, isAllowedExtensionForMime } from "./extension-allowlist.js";
import {
  type AllowedMimeType,
  isAllowedMimeType,
  requiresMagicByteCheck,
} from "./mime-allowlist.js";
import { hasExpectedMagicBytes } from "./magic-bytes.js";
import { MAX_ASSET_BYTES } from "./size-limits.js";

export interface AssetCandidateInput {
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly filename: string;
}

export interface ValidatedAssetCandidate extends AssetCandidateInput {
  readonly mime: AllowedMimeType;
  readonly extension: string;
  readonly size: number;
}

export const validateAssetCandidate = (
  input: AssetCandidateInput,
): Result.Result<ValidatedAssetCandidate, AssetSecurityError> => {
  if (!isAllowedMimeType(input.mime)) {
    return Result.fail(
      new AssetMimeRejectedError({
        mime: input.mime,
        message: `MIME type is not allowed: ${input.mime}`,
      }),
    );
  }

  const extension = extensionOf(input.filename);
  if (!isAllowedExtensionForMime(input.filename, input.mime)) {
    return Result.fail(
      new AssetExtensionMismatchError({
        filename: input.filename,
        mime: input.mime,
        extension,
        message: `Extension ${extension || "<none>"} is not allowed for ${input.mime}`,
      }),
    );
  }

  if (input.bytes.byteLength > MAX_ASSET_BYTES) {
    return Result.fail(
      new AssetTooLargeError({
        size: input.bytes.byteLength,
        maxSize: MAX_ASSET_BYTES,
        scope: "asset",
        message: `Asset exceeds ${MAX_ASSET_BYTES} bytes`,
      }),
    );
  }

  if (requiresMagicByteCheck(input.mime) && !hasExpectedMagicBytes(input.mime, input.bytes)) {
    return Result.fail(
      new AssetMagicByteMismatchError({
        mime: input.mime,
        message: `Bytes do not match ${input.mime} signature`,
      }),
    );
  }

  return Result.succeed({
    ...input,
    mime: input.mime,
    extension,
    size: input.bytes.byteLength,
  });
};

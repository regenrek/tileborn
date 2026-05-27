import type { ParseDiagnostic, ParseResult } from "../diagnostics.js";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_TYPE = Uint8Array.from([0x49, 0x48, 0x44, 0x52]); // "IHDR"
const IHDR_DATA_LENGTH = 13;
const MIN_PNG_BYTE_LENGTH = PNG_SIGNATURE.length + 4 + 4 + IHDR_DATA_LENGTH + 4;

export type PngImageInfo = {
  readonly width: number;
  readonly height: number;
};

const readUint32Be = (buffer: Uint8Array, offset: number): number =>
  ((buffer[offset]! << 24) |
    (buffer[offset + 1]! << 16) |
    (buffer[offset + 2]! << 8) |
    buffer[offset + 3]!) >>>
  0;

const bytesEqual = (left: Uint8Array, right: Uint8Array, offset = 0): boolean => {
  for (let index = 0; index < right.length; index += 1) {
    if (left[offset + index] !== right[index]) return false;
  }
  return true;
};

/** Build a minimal valid PNG buffer with the given pixel dimensions (IHDR only). */
export const createPngBuffer = (width: number, height: number): Uint8Array => {
  const chunk = new Uint8Array(4 + 4 + IHDR_DATA_LENGTH + 4);
  chunk[3] = IHDR_DATA_LENGTH;
  chunk[4] = 0x49;
  chunk[5] = 0x48;
  chunk[6] = 0x44;
  chunk[7] = 0x52;
  chunk[8] = (width >>> 24) & 0xff;
  chunk[9] = (width >>> 16) & 0xff;
  chunk[10] = (width >>> 8) & 0xff;
  chunk[11] = width & 0xff;
  chunk[12] = (height >>> 24) & 0xff;
  chunk[13] = (height >>> 16) & 0xff;
  chunk[14] = (height >>> 8) & 0xff;
  chunk[15] = height & 0xff;
  chunk[16] = 8;
  chunk[17] = 6;
  chunk[18] = 0;
  chunk[19] = 0;
  chunk[20] = 0;
  return Uint8Array.from([...PNG_SIGNATURE, ...chunk]);
};

/** Read PNG width and height from the IHDR chunk in a buffer. */
export const readPngDimensions = (buffer: Uint8Array): ParseResult<PngImageInfo> => {
  if (buffer.byteLength < MIN_PNG_BYTE_LENGTH) {
    return {
      diagnostics: [
        {
          _tag: "InvalidPngImage",
          path: "/atlas/png",
          message: "PNG buffer is too short to contain an IHDR chunk",
          severity: "error",
        },
      ],
    };
  }

  if (!bytesEqual(buffer, PNG_SIGNATURE)) {
    return {
      diagnostics: [
        {
          _tag: "InvalidPngImage",
          path: "/atlas/png",
          message: "PNG signature is invalid",
          severity: "error",
        },
      ],
    };
  }

  const chunkOffset = PNG_SIGNATURE.length;
  const chunkLength = readUint32Be(buffer, chunkOffset);
  const chunkTypeOffset = chunkOffset + 4;

  if (chunkLength !== IHDR_DATA_LENGTH || !bytesEqual(buffer, IHDR_TYPE, chunkTypeOffset)) {
    return {
      diagnostics: [
        {
          _tag: "InvalidPngImage",
          path: "/atlas/png",
          message: "First PNG chunk must be IHDR",
          severity: "error",
        },
      ],
    };
  }

  const dataOffset = chunkTypeOffset + 4;
  const width = readUint32Be(buffer, dataOffset);
  const height = readUint32Be(buffer, dataOffset + 4);

  if (width <= 0 || height <= 0) {
    return {
      diagnostics: [
        {
          _tag: "InvalidPngImage",
          path: "/atlas/png",
          message: "PNG IHDR dimensions must be positive",
          severity: "error",
          width,
          height,
        },
      ],
    };
  }

  return {
    value: { width, height },
    diagnostics: [],
  };
};

export type { ParseDiagnostic };

import type { ParseDiagnostic } from '../diagnostics.js';

export type DecodeTileLayerDataInput = {
  readonly layerName: string;
  readonly width: number;
  readonly height: number;
  readonly data?: readonly number[];
  readonly encoding?: string;
  readonly compression?: string;
  readonly text?: string;
};

export type DecodeTileLayerDataResult = {
  readonly data: readonly number[];
  readonly diagnostics: readonly ParseDiagnostic[];
};

const parseCsv = (value: string): readonly number[] =>
  value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parsed = Number(entry);
      if (!Number.isFinite(parsed)) throw new Error(`Invalid CSV gid: ${entry}`);
      return parsed >>> 0;
    });

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
};

const uint32LeArray = (bytes: Uint8Array): readonly number[] => {
  if (bytes.byteLength % 4 !== 0)
    throw new Error('Base64 tile data byte length must be divisible by 4');
  const out: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    out.push(
      ((bytes[offset] ?? 0) |
        ((bytes[offset + 1] ?? 0) << 8) |
        ((bytes[offset + 2] ?? 0) << 16) |
        ((bytes[offset + 3] ?? 0) << 24)) >>>
        0,
    );
  }
  return out;
};

const unsupportedCompression = (layerName: string, compression: string): ParseDiagnostic => ({
  _tag: 'TiledUnsupportedCompression',
  path: `/layers/${layerName}/data`,
  message: `Layer uses unsupported compression "${compression}"`,
  severity: 'warning',
  layerName,
  compression,
});

/** Decode Tiled tile layer data from CSV, raw arrays, or base64 (sync; no zlib). */
export const decodeTileLayerDataSync = (
  input: DecodeTileLayerDataInput,
): DecodeTileLayerDataResult => {
  const diagnostics: ParseDiagnostic[] = [];

  if (input.compression && input.compression !== 'none') {
    diagnostics.push(unsupportedCompression(input.layerName, input.compression));
    return { data: input.data ?? [], diagnostics };
  }

  if (input.data && input.data.length > 0) {
    return { data: input.data.map((entry) => entry >>> 0), diagnostics };
  }

  if (input.encoding === 'base64') {
    if (!input.text) throw new Error(`Layer "${input.layerName}" is missing base64 data`);
    return { data: uint32LeArray(base64ToBytes(input.text)), diagnostics };
  }

  if (input.encoding === 'csv' || input.text) {
    if (!input.text) throw new Error(`Layer "${input.layerName}" is missing CSV data`);
    return { data: parseCsv(input.text), diagnostics };
  }

  return { data: input.data ?? [], diagnostics };
};

/** Decode Tiled tile layer data including zlib/gzip base64 when supported. */
export const decodeTileLayerDataAsync = async (
  input: DecodeTileLayerDataInput,
): Promise<DecodeTileLayerDataResult> => {
  if (!input.compression || input.compression === 'none') {
    return decodeTileLayerDataSync(input);
  }

  if (input.compression === 'zstd') {
    return {
      data: [],
      diagnostics: [unsupportedCompression(input.layerName, input.compression)],
    };
  }

  if (input.encoding !== 'base64' || !input.text) {
    return {
      data: [],
      diagnostics: [unsupportedCompression(input.layerName, input.compression)],
    };
  }

  const format =
    input.compression === 'gzip' ? 'gzip' : input.compression === 'zlib' ? 'deflate' : undefined;
  if (!format || typeof DecompressionStream !== 'function') {
    return {
      data: [],
      diagnostics: [unsupportedCompression(input.layerName, input.compression)],
    };
  }

  const expectedCells = input.width * input.height;
  const maxBytes = expectedCells * 4;
  const compressed = base64ToBytes(input.text);
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Layer "${input.layerName}" decompressed data exceeds expected size`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const decompressed = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    decompressed.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { data: uint32LeArray(decompressed), diagnostics: [] };
};

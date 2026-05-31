import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { nativeImage, type NativeImage } from 'electron';

import { THUMBNAIL_BOX_PX, computeThumbnailResize } from './asset-protocol-url.js';

/**
 * Precomputes small fixed-box thumbnails on the main process (the only place
 * `nativeImage` exists) and disk-caches them as PNG. Generation is a one-time
 * cost per (pack, crop): once cached, requests are served straight off disk.
 *
 * Why throttling matters: a real working palette can reference dozens of large
 * source atlases. Decoding/compositing all of them at full resolution wedged
 * the app. Here every distinct source image is decoded at most once (small
 * LRU), crops are tiny, and concurrent decode/encode work is capped so a burst
 * of first-time requests never blocks the main thread for long.
 *
 * Follow-up: if first-generation decode of very large atlases is still too
 * heavy on the main thread, move the decode+crop into a `utilityProcess` with
 * `sharp`. Not needed yet — the LRU + concurrency cap keep it bounded.
 */

const GENERATION_CONCURRENCY = 3;
const SOURCE_DECODE_LRU_LIMIT = 6;

const sourceDecodeCache = new Map<string, NativeImage>();
const inFlight = new Map<string, Promise<Buffer>>();

let activeGenerations = 0;
const waiters: Array<() => void> = [];

const acquireSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeGenerations < GENERATION_CONCURRENCY) {
      activeGenerations += 1;
      resolve();
      return;
    }
    waiters.push(() => {
      activeGenerations += 1;
      resolve();
    });
  });

const releaseSlot = (): void => {
  activeGenerations -= 1;
  const next = waiters.shift();
  if (next !== undefined) {
    next();
  }
};

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const isNotFound = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && (cause as NodeJS.ErrnoException).code === 'ENOENT';

const loadSource = async (sourceFilePath: string): Promise<NativeImage> => {
  const cached = sourceDecodeCache.get(sourceFilePath);
  if (cached !== undefined) {
    // Refresh LRU recency.
    sourceDecodeCache.delete(sourceFilePath);
    sourceDecodeCache.set(sourceFilePath, cached);
    return cached;
  }
  const bytes = await readFile(sourceFilePath);
  const image = nativeImage.createFromBuffer(bytes);
  sourceDecodeCache.set(sourceFilePath, image);
  while (sourceDecodeCache.size > SOURCE_DECODE_LRU_LIMIT) {
    const oldest = sourceDecodeCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    sourceDecodeCache.delete(oldest);
  }
  return image;
};

export interface EnsureThumbnailInput {
  readonly sourceFilePath: string;
  readonly cacheFilePath: string;
  readonly geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

const generateThumbnail = async (input: EnsureThumbnailInput): Promise<Buffer> => {
  try {
    return await readFile(input.cacheFilePath);
  } catch (cause) {
    if (!isNotFound(cause)) {
      throw cause;
    }
  }

  await acquireSlot();
  try {
    // Yield once so a burst of first-time requests interleaves with other main
    // thread work instead of decoding back-to-back synchronously.
    await yieldToEventLoop();
    const source = await loadSource(input.sourceFilePath);
    const size = source.getSize();
    const plan = computeThumbnailResize(size, input.geometry, THUMBNAIL_BOX_PX);
    let image = source.crop(plan.crop);
    if (plan.resize !== undefined) {
      image = image.resize({ ...plan.resize, quality: 'good' });
    }
    const png = image.toPNG();
    await mkdir(path.dirname(input.cacheFilePath), { recursive: true });
    const tempPath = `${input.cacheFilePath}.${process.pid}.tmp`;
    await writeFile(tempPath, png);
    await rename(tempPath, input.cacheFilePath);
    return png;
  } finally {
    releaseSlot();
  }
};

/**
 * Returns the PNG bytes for a crop, generating + caching on first request and
 * reading from disk thereafter. Concurrent requests for the same cache file
 * share a single in-flight generation.
 */
export const ensureThumbnail = (input: EnsureThumbnailInput): Promise<Buffer> => {
  const existing = inFlight.get(input.cacheFilePath);
  if (existing !== undefined) {
    return existing;
  }
  const pending = generateThumbnail(input).finally(() => {
    inFlight.delete(input.cacheFilePath);
  });
  inFlight.set(input.cacheFilePath, pending);
  return pending;
};

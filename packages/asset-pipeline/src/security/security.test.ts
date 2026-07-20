import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  AssetExtensionMismatchError,
  AssetMagicByteMismatchError,
  AssetMimeRejectedError,
  AssetTooLargeError,
} from '../errors.js';
import { extensionOf, isAllowedExtensionForMime } from './extension-allowlist.js';
import { isAllowedMimeType } from './mime-allowlist.js';
import {
  hasExpectedMagicBytes,
  isJpeg,
  isOgg,
  isPng,
  isWav,
  isWebp,
  isWoff2,
} from './magic-bytes.js';
import { MAX_ASSET_BYTES } from './size-limits.js';
import {
  AssetPathSecurityError,
  assertWithinRoot,
  rejectPathTraversal,
  rejectSymlinkEscape,
} from './path-security.js';
import { validateAssetCandidate } from './security.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
const wav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);
const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]);

describe('asset security allowlists', () => {
  it('accepts known MIME types and matching extensions', () => {
    expect(isAllowedMimeType('image/png')).toBe(true);
    expect(isAllowedMimeType('audio/ogg')).toBe(true);
    expect(isAllowedMimeType('font/woff2')).toBe(true);
    expect(isAllowedExtensionForMime('tiles/terrain.png', 'image/png')).toBe(true);
    expect(isAllowedExtensionForMime('fonts/menu.woff2', 'font/woff2')).toBe(true);
    expect(extensionOf('terrain.PNG')).toBe('.png');
  });

  it('rejects mismatched MIME and extension pairs', () => {
    const result = validateAssetCandidate({
      mime: 'image/png',
      filename: 'terrain.jpg',
      bytes: png,
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(AssetExtensionMismatchError);
    }
  });

  it('rejects unknown MIME types', () => {
    const result = validateAssetCandidate({
      mime: 'application/x-msdownload',
      filename: 'bad.exe',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(AssetMimeRejectedError);
    }
  });

  it('enforces per-asset size limits', () => {
    const result = validateAssetCandidate({
      mime: 'text/plain',
      filename: 'huge.txt',
      bytes: new Uint8Array(MAX_ASSET_BYTES + 1),
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(AssetTooLargeError);
    }
  });
});

describe('magic byte checks', () => {
  it('accepts common image and audio signatures', () => {
    expect(isPng(png)).toBe(true);
    expect(isWebp(webp)).toBe(true);
    expect(isJpeg(jpeg)).toBe(true);
    expect(isOgg(ogg)).toBe(true);
    expect(isWav(wav)).toBe(true);
    expect(isWoff2(woff2)).toBe(true);
  });

  it('rejects truncated or wrong signatures', () => {
    expect(isPng(png.slice(0, 4))).toBe(false);
    expect(isWebp(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0x00, 0xff]))).toBe(false);
    expect(isWoff2(new Uint8Array([0x00, 0x4f, 0x46, 0x32]))).toBe(false);
    expect(hasExpectedMagicBytes('audio/ogg', wav)).toBe(false);
    expect(hasExpectedMagicBytes('font/woff2', new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it('combines MIME, extension, size, and magic checks', () => {
    const ok = validateAssetCandidate({
      mime: 'image/png',
      filename: 'terrain.png',
      bytes: png,
    });
    expect(Result.isSuccess(ok)).toBe(true);

    const bad = validateAssetCandidate({
      mime: 'image/png',
      filename: 'terrain.png',
      bytes: jpeg,
    });
    expect(Result.isFailure(bad)).toBe(true);
    if (Result.isFailure(bad)) {
      expect(bad.failure).toBeInstanceOf(AssetMagicByteMismatchError);
    }
  });

  it('allows woff2 fonts with the fixed signature', () => {
    const result = validateAssetCandidate({
      mime: 'font/woff2',
      filename: 'fonts/menu.woff2',
      bytes: woff2,
    });

    expect(Result.isSuccess(result)).toBe(true);
  });

  it('rejects arbitrary bytes with a woff2 extension', () => {
    const result = validateAssetCandidate({
      mime: 'font/woff2',
      filename: 'fonts/menu.woff2',
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(AssetMagicByteMismatchError);
    }
  });
});

describe('path security primitives', () => {
  it('accepts candidates inside the declared root', () => {
    expect(assertWithinRoot('/tmp/assets', 'tiles/grass.png')).toBe('/tmp/assets/tiles/grass.png');
  });

  it('rejects traversal and absolute candidate paths', () => {
    expect(() => rejectPathTraversal('/tmp/assets', '../escape.png')).toThrow(
      AssetPathSecurityError,
    );
    expect(() => rejectPathTraversal('/tmp/assets', '/etc/passwd')).toThrow(AssetPathSecurityError);
  });

  it('rejects symlinks that resolve outside the root', async () => {
    const rootPath = await import('node:fs/promises').then(async (fs) => {
      const os = await import('node:os');
      const path = await import('node:path');
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-path-'));
      await fs.writeFile(path.join(root, 'inside.txt'), 'ok');
      await fs.symlink(os.tmpdir(), path.join(root, 'escape'));
      return root;
    });

    await expect(rejectSymlinkEscape(rootPath, 'inside.txt')).resolves.toContain('inside.txt');
    await expect(rejectSymlinkEscape(rootPath, 'escape')).rejects.toBeInstanceOf(
      AssetPathSecurityError,
    );
  });
});

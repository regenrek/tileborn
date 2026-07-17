import { afterEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';

import { pixiTextureFromBytes } from './pixi-texture-from-bytes.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('pixiTextureFromBytes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('decodes bytes via createImageBitmap and builds a texture from the bitmap', async () => {
    const bitmap = { width: 32, height: 32 } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn(async () => bitmap);
    const createObjectURL = vi.fn(() => 'blob:should-not-be-used');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL);
    const fromSpy = vi.spyOn(Texture, 'from').mockReturnValue(Texture.WHITE);

    const texture = await pixiTextureFromBytes({ bytes: PNG_BYTES, mime: 'image/png' });

    // The decoded ImageBitmap is URL-independent, so the deferred GPU upload can
    // never race a revoked object URL: no object URL is minted at all.
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(fromSpy).toHaveBeenCalledWith(bitmap);
    expect(texture).toBe(Texture.WHITE);
  });

  it('passes the asset bytes + mime through to the decoded blob', async () => {
    let decodedBlob: Blob | undefined;
    const createImageBitmapMock = vi.fn(async (blob: Blob) => {
      decodedBlob = blob;
      return { width: 1, height: 1 } as unknown as ImageBitmap;
    });
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.spyOn(Texture, 'from').mockReturnValue(Texture.WHITE);

    await pixiTextureFromBytes({ bytes: PNG_BYTES, mime: 'image/png' });

    expect(decodedBlob?.type).toBe('image/png');
    expect(decodedBlob?.size).toBe(PNG_BYTES.byteLength);
  });
});

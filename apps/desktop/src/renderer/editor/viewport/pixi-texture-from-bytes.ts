import { Texture } from 'pixi.js';

/**
 * Build a Pixi `Texture` directly from a loaded asset's bytes by decoding
 * through an `HTMLImageElement`.
 *
 * Why this exists:
 *   The default `PixiRendererAdapter.textureFromAsset` calls `Assets.load(url)`
 *   with a blob URL. Pixi v8 autodetects parsers by URL extension, and blob
 *   URLs (`blob:http://…/uuid`) carry no extension, so the autodetect step
 *   bails with "could not be loaded as we don't know how to parse it" and the
 *   editor viewport falls back to `tileColor(index)` solid rectangles.
 *
 *   For our pack atlases we already know the MIME type (`image/png` etc.) on
 *   the `LoadedAsset`, so we can sidestep the URL-extension-based detection
 *   entirely by piping the bytes through `HTMLImageElement` and feeding the
 *   decoded image directly into a Pixi `Texture`. This matches what
 *   `loadTextures` would have done internally.
 *
 *   This factory is supplied to `new PixiRendererAdapter({ textureFactory })`
 *   from `map-editor-viewport.tsx`; the upstream runtime adapter and its
 *   default code path are unchanged. See
 *   `.refs/v0.1.x-paint-bug/diag/diag.md` for the live evidence.
 */
export const pixiTextureFromBytes = async (asset: {
  readonly bytes: Uint8Array;
  readonly mime: string;
}): Promise<Texture> => {
  const body = asset.bytes.buffer.slice(
    asset.bytes.byteOffset,
    asset.bytes.byteOffset + asset.bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([body], { type: asset.mime });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error(`failed to decode ${asset.mime} image from blob`));
      image.src = url;
    });
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
      } catch {
        // decode() can reject if not supported; ignore — onload already fired.
      }
    }
    return Texture.from(image);
  } finally {
    URL.revokeObjectURL(url);
  }
};

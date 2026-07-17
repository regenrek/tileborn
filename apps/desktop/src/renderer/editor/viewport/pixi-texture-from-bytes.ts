import { Texture } from 'pixi.js';

/**
 * Build a Pixi `Texture` directly from a loaded asset's bytes.
 *
 * Why this exists:
 *   The default `PixiRendererAdapter.textureFromAsset` calls `Assets.load(url)`
 *   with a blob URL. Pixi v8 autodetects parsers by URL extension, and blob
 *   URLs (`blob:http://…/uuid`) carry no extension, so the autodetect step
 *   bails with "could not be loaded as we don't know how to parse it" and the
 *   editor viewport falls back to the missing-texture diagnostic.
 *
 *   For our pack atlases we already know the MIME type (`image/png` etc.) on
 *   the `LoadedAsset`, so we decode the bytes ourselves and feed a decoded
 *   image source straight into a Pixi `Texture`.
 *
 * Why `createImageBitmap` (not an `<img>` + object URL):
 *   `Texture.from(source)` is synchronous and only *registers* the source —
 *   Pixi v8 defers the actual GPU upload (`texImage2D`) to the first render.
 *   The previous implementation created a blob object URL, loaded it into an
 *   `HTMLImageElement`, and then revoked the URL in a `finally` block *before*
 *   returning. Because the upload is deferred, the source was uploaded from an
 *   image whose backing object URL had already been revoked, producing a
 *   transparent (blank) atlas texture — the editor + playtest viewports then
 *   rendered terrain as a dark grid with no visible tiles.
 *
 *   `createImageBitmap` returns a fully-decoded, URL-independent `ImageBitmap`.
 *   No object URL is involved, so there is nothing to revoke and the deferred
 *   GPU upload always reads valid pixels. See `.refs/v0.1.x-paint-bug/diag/diag.md`.
 *
 *   This factory is supplied to `new PixiRendererAdapter({ textureFactory })`
 *   from the editor + playtest viewports; the upstream runtime adapter and its
 *   default code path are unchanged.
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

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return Texture.from(bitmap);
  }

  // Fallback for environments without `createImageBitmap` (older test runners).
  // The object URL is intentionally NOT revoked synchronously: revoking it
  // before Pixi's deferred GPU upload reads the image is exactly what blanked
  // the atlas textures. Defer revocation to a later macrotask so the source has
  // a chance to upload first.
  const url = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`failed to decode ${asset.mime} image from blob`));
    image.src = url;
  });
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch {
      // decode() can reject if not supported; ignore — onload already fired.
    }
  }
  const texture = Texture.from(image);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return texture;
};

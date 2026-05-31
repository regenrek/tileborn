/**
 * Builds a URL for the custom `tileborne-asset` protocol registered in the main
 * process (see apps/desktop/src/main/asset-library/asset-protocol.ts). The
 * renderer loads these via `<img src>` / `fetch`, so the bytes are streamed and
 * decoded off the main thread instead of being shipped as base64 data URLs over
 * IPC.
 *
 * `id` and `path` are URI-encoded so pack ids containing `:` and asset paths
 * containing slashes or spaces survive standard URL parsing. An optional
 * integrity hash is appended as `v` to bust the browser cache when a pack is
 * reinstalled with new content.
 */
export const ASSET_PROTOCOL_SCHEME = 'tileborne-asset';

export const assetProtocolUrl = (
  packId: string,
  assetPath: string,
  integrityHash?: string | undefined,
): string => {
  const params = new URLSearchParams({ id: packId, path: assetPath });
  if (integrityHash !== undefined && integrityHash.length > 0) {
    params.set('v', integrityHash);
  }
  return `${ASSET_PROTOCOL_SCHEME}://pack?${params.toString()}`;
};

export interface AssetThumbnailGeometry {
  /** Source atlas image path relative to the pack root. */
  readonly assetPath: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * URL for a precomputed small thumbnail of a single tile/object crop. The main
 * process generates (once) and disk-caches a fixed-box PNG for the crop and
 * streams it here, so the renderer never decodes/CSS-crops full-resolution
 * atlases. `id`/`path` are URI-encoded; the crop rect rides as `x/y/w/h`. The
 * optional integrity hash is a browser cache-buster (`v`); the handler derives
 * the authoritative hash for the on-disk cache regardless.
 */
export const assetThumbnailUrl = (
  packId: string,
  geometry: AssetThumbnailGeometry,
  integrityHash?: string | undefined,
): string => {
  const params = new URLSearchParams({
    id: packId,
    path: geometry.assetPath,
    x: String(Math.round(geometry.x)),
    y: String(Math.round(geometry.y)),
    w: String(Math.round(geometry.width)),
    h: String(Math.round(geometry.height)),
  });
  if (integrityHash !== undefined && integrityHash.length > 0) {
    params.set('v', integrityHash);
  }
  return `${ASSET_PROTOCOL_SCHEME}://thumb?${params.toString()}`;
};

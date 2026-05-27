import type { AssetId } from "@tileborne/core";

import type { FrameLookupResult } from "./types.js";

export type PixiFrameRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PixiAnchor = {
  readonly x: number;
  readonly y: number;
};

/** Pixi-adjacent texture metadata without importing Pixi. */
export type PixiTextureDescriptor = {
  readonly imageAssetId: AssetId;
  readonly frame: PixiFrameRect;
  readonly rotate?: number;
  readonly anchor?: PixiAnchor;
};

/** Map a renderer-neutral frame lookup into Pixi texture frame coordinates. */
export const toPixiDescriptor = (frameResult: FrameLookupResult): PixiTextureDescriptor => ({
  imageAssetId: frameResult.imageAssetId,
  frame: {
    x: frameResult.uv.x,
    y: frameResult.uv.y,
    width: frameResult.uv.w,
    height: frameResult.uv.h,
  },
});

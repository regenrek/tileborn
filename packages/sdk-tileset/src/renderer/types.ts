import type { AssetId } from "@tileborne/core";

import type { AnimationId } from "../schemas/ids.js";
import type { UVRect } from "../schemas/uv-rect.js";

/** Renderer-neutral frame lookup for one tile id. */
export type FrameLookupResult = {
  readonly imageAssetId: AssetId;
  readonly uv: UVRect;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly flipD?: boolean;
  readonly animationId?: AnimationId;
  readonly sourceAssetPaths: ReadonlyArray<string>;
};

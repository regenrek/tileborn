export type RenderableAssetId = string;

/** Atlas sub-rectangle (pixels) for one animation frame. */
export interface RenderableAnimationFrameUv {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One animation frame: an atlas asset plus an optional sub-rectangle + duration. */
export interface RenderableAnimationFrame {
  readonly assetId: RenderableAssetId;
  readonly uv?: RenderableAnimationFrameUv;
  readonly durationMs?: number;
}

/**
 * Animation component carried on a {@link RenderableEntity}. The runtime renderer
 * advances a single shared clock; the projector supplies `clockMs` (and a clip
 * id + per-instance offset) so playtest sprites animate frame-identically to the
 * editor preview.
 */
export interface RenderableEntityAnimation {
  readonly clipId?: string;
  readonly frames: readonly RenderableAnimationFrame[];
  readonly loop: boolean;
  readonly defaultDurationMs?: number;
  readonly speed?: number;
  readonly offsetMs?: number;
  /** Shared animation clock time in milliseconds. */
  readonly clockMs: number;
}

/** Normalized sprite pivot (0..1, origin top-left). Defaults to top-left (0,0). */
export interface RenderableEntityAnchor {
  readonly x: number;
  readonly y: number;
}

export interface RenderableEntityTextStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: 'normal' | 'bold';
  readonly fill?: number;
  readonly stroke?: number;
  readonly strokeWidth?: number;
}

export interface RenderableEntityText {
  readonly value: string;
  readonly style?: RenderableEntityTextStyle;
}

export interface RenderableEntity {
  readonly id: string;
  readonly assetId: RenderableAssetId;
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  readonly scale?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly opacity?: number;
  readonly tint?: number;
  readonly layerIndex?: number;
  /** Optional normalized pivot honored by the renderer when positioning the sprite. */
  readonly anchor?: RenderableEntityAnchor;
  /** Optional animation component; when present and multi-frame, the renderer cycles frames. */
  readonly animation?: RenderableEntityAnimation;
  /** Optional text layer. When present, renderers draw text and ignore the sprite texture for this entity. */
  readonly text?: RenderableEntityText;
}

export interface RuntimePluginRenderManifest {
  readonly fixedZoom: number;
  readonly hudInsets: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

export interface RenderableEntityProjector<Snapshot> {
  readonly project: (snapshot: Snapshot) => readonly RenderableEntity[];
  readonly mergeFrame?: (previousFullState: Snapshot | undefined, frame: Snapshot) => Snapshot;
  readonly getFrameTimestamp?: (frame: Snapshot) => number | undefined;
  readonly getRenderManifest?: () => RuntimePluginRenderManifest;
  readonly textureManifestForAtlas?: () => readonly {
    readonly assetId: string;
    readonly path: string;
  }[];
}

export type RenderableAssetId = string;

export interface RenderableEntity {
  readonly id: string;
  readonly assetId: RenderableAssetId;
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  readonly scale?: number;
  readonly layerIndex?: number;
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

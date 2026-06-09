import * as tilemapModule from "@pixi/tilemap";
import {
  Application,
  Assets,
  Container,
  Culler,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type ApplicationOptions,
} from "pixi.js";
import { Effect, Option } from "effect";

import {
  compileClipTimeline,
  resolveClipFrameIndex,
  type CompiledClip,
} from "../clip-timeline.js";
import type { RenderableAnimationFrame } from "../../plugin/renderable-entity.js";

import type { RegisteredBundledAsset } from "../../assets/bundled-asset.js";
import { RuntimeAssetLoader, type LoadedAsset, type LoadedAssets } from "../../assets/runtime-asset-loader.js";
import { PositionComponent, RenderableComponent, TransformComponent } from "../../ecs/components.js";
import type { EntityId, World } from "../../ecs/world.js";
import type { RenderableAssetId, RenderableEntity } from "../../plugin/renderable-entity.js";
import {
  previousPositionFor,
  rendererAssetError,
  rendererDisposeError,
  rendererInitError,
  rendererRenderError,
  type MountedRenderer,
  type RendererAdapter,
  type RendererError,
} from "../renderer-adapter.js";

export interface TileLayerTile {
  readonly assetId: number;
  readonly x: number;
  readonly y: number;
  readonly u?: number;
  readonly v?: number;
  readonly tileWidth?: number;
  readonly tileHeight?: number;
}

export interface StaticTileLayer {
  readonly layerIndex: number;
  readonly tiles: readonly TileLayerTile[];
}

export interface PixiRendererAdapterOptions {
  readonly applicationOptions?: Partial<ApplicationOptions>;
  readonly assetLoader?: RuntimeAssetLoader;
  readonly textureFactory?: (asset: LoadedAsset) => Texture | Promise<Texture>;
  readonly bundledTextureFactory?: (asset: RegisteredBundledAsset) => Texture | Promise<Texture>;
}

const DEFAULT_APPLICATION_OPTIONS: Partial<ApplicationOptions> = {
  autoStart: false,
  backgroundAlpha: 0,
};

const isHtmlContainer = (value: unknown): value is HTMLElement =>
  typeof value === "object" &&
  value !== null &&
  "appendChild" in value &&
  typeof (value as { appendChild?: unknown }).appendChild === "function";

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

const clampOpacity = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 1 : Math.min(1, Math.max(0, value));

const assetIndexFor = (index: number): number => index + 1;

type CompositeTilemapLike = Container & {
  tile: (
    tileTexture: Texture | string | number,
    x: number,
    y: number,
    options?: {
      readonly u?: number;
      readonly v?: number;
      readonly tileWidth?: number;
      readonly tileHeight?: number;
    },
  ) => CompositeTilemapLike;
};

type CompositeTilemapConstructor = new () => CompositeTilemapLike;

const CompositeTilemap = (tilemapModule as unknown as { readonly CompositeTilemap: CompositeTilemapConstructor })
  .CompositeTilemap;

export class PixiRendererAdapter implements RendererAdapter {
  private readonly applicationOptions: Partial<ApplicationOptions>;
  private readonly assetLoader: RuntimeAssetLoader;
  private readonly textureFactory: (asset: LoadedAsset) => Texture | Promise<Texture>;
  private readonly bundledTextureFactory: (asset: RegisteredBundledAsset) => Texture | Promise<Texture>;
  private readonly spritePool = new Map<EntityId, Sprite>();
  private readonly spritePoolByStringId = new Map<string, Sprite>();
  private readonly textPoolByStringId = new Map<string, Text>();
  private readonly spriteLayers = new Map<number, Container>();
  private readonly texturesByRenderableAssetId = new Map<number | string, Texture>();
  // Sub-rect frame textures for animated entities, keyed by asset+uv.
  private readonly animationFrameTextureCache = new Map<string, Texture>();
  // Compiled clip timelines keyed by clip id (or a frame-derived key) so the
  // shared-clock frame lookup never recompiles per rendered frame.
  private readonly compiledClipCache = new Map<string, CompiledClip>();
  private readonly objectUrls: string[] = [];
  private app: Application | undefined;

  constructor(options: PixiRendererAdapterOptions = {}) {
    this.applicationOptions = { ...DEFAULT_APPLICATION_OPTIONS, ...options.applicationOptions };
    this.assetLoader = options.assetLoader ?? new RuntimeAssetLoader();
    this.textureFactory = options.textureFactory ?? ((asset) => this.textureFromAsset(asset));
    this.bundledTextureFactory = options.bundledTextureFactory ?? ((asset) => this.textureFromBundledAsset(asset));
  }

  mount(container: unknown): Effect.Effect<MountedRenderer, RendererError> {
    return Effect.tryPromise({
      try: async () => {
        if (!isHtmlContainer(container)) {
          throw new Error("Pixi renderer requires an HTMLElement container");
        }
        const app = new Application();
        await app.init(this.applicationOptions);
        container.appendChild(app.canvas);
        this.app = app;
        return { container };
      },
      catch: (cause) => rendererInitError("failed to mount Pixi renderer", cause),
    });
  }

  loadAssets(manifest: Parameters<RendererAdapter["loadAssets"]>[0]): Effect.Effect<LoadedAssets, RendererError> {
    return this.assetLoader.load(manifest).pipe(
      Effect.flatMap((loaded) =>
        Effect.all(
          [...loaded.values()].map((asset, index) =>
            Effect.tryPromise({
              try: () => Promise.resolve(this.textureFactory(asset)),
              catch: (cause) =>
                rendererAssetError(String(asset.id), "failed to create Pixi texture", cause),
            }).pipe(
              Effect.tap((texture) =>
                Effect.sync(() => {
                  this.texturesByRenderableAssetId.set(assetIndexFor(index), texture);
                  this.texturesByRenderableAssetId.set(asset.id, texture);
                }),
              ),
            ),
          ),
        ).pipe(Effect.as(loaded)),
      ),
    );
  }

  loadBundledAssets(
    assets: readonly RegisteredBundledAsset[],
  ): Effect.Effect<readonly RegisteredBundledAsset[], RendererError> {
    return Effect.all(
      assets.map((asset) =>
        Effect.tryPromise({
          try: () => Promise.resolve(this.bundledTextureFactory(asset)),
          catch: (cause) =>
            rendererAssetError(String(asset.assetId), "failed to create Pixi bundled texture", cause),
        }).pipe(
          Effect.tap((texture) =>
            Effect.sync(() => {
              this.texturesByRenderableAssetId.set(asset.assetId, texture);
            }),
          ),
        ),
      ),
    ).pipe(Effect.as(assets));
  }

  addTileLayer(layer: StaticTileLayer): Effect.Effect<void, RendererError> {
    return Effect.try({
      try: () => {
        const app = this.requireApp();
        const tilemap = new CompositeTilemap();
        tilemap.zIndex = layer.layerIndex;
        // Layer-level viewport culling: skip the whole tilemap when its global
        // bounds fall entirely outside the visible screen rect. Per-chunk culling
        // inside CompositeTilemap is left as a follow-up (see cullStage).
        tilemap.cullable = true;
        for (const tile of layer.tiles) {
          const texture = this.texturesByRenderableAssetId.get(tile.assetId);
          if (!texture) {
            throw new Error(`missing tile texture ${tile.assetId}`);
          }
          tilemap.tile(texture, tile.x, tile.y, {
            ...(tile.u === undefined ? {} : { u: tile.u }),
            ...(tile.v === undefined ? {} : { v: tile.v }),
            ...(tile.tileWidth === undefined ? {} : { tileWidth: tile.tileWidth }),
            ...(tile.tileHeight === undefined ? {} : { tileHeight: tile.tileHeight }),
          });
        }
        app.stage.sortableChildren = true;
        app.stage.addChild(tilemap);
      },
      catch: (cause) => rendererRenderError("failed to add Pixi tile layer", cause),
    });
  }

  renderFrame(world: World, alpha: number): Effect.Effect<void, RendererError> {
    return Effect.try({
      try: () => {
        const app = this.requireApp();
        const liveEntities = new Set<EntityId>();
        app.stage.sortableChildren = true;

        world.query([PositionComponent, RenderableComponent], (entity, position, renderable) => {
          liveEntities.add(entity);
          const sprite = this.spriteFor(entity, renderable.assetId, renderable.layerIndex);
          const previous = previousPositionFor(world, entity) ?? position;
          sprite.position.set(lerp(previous.x, position.x, alpha), lerp(previous.y, position.y, alpha));

          const transform = world.getComponent(entity, TransformComponent);
          if (Option.isSome(transform)) {
            sprite.rotation = transform.value.rotation;
            sprite.scale.set(transform.value.scaleX, transform.value.scaleY);
          }
        });

        for (const [entity, sprite] of this.spritePool) {
          if (!liveEntities.has(entity)) {
            sprite.removeFromParent();
            this.spritePool.delete(entity);
          }
        }
        this.cullStage();
        app.render();
      },
      catch: (cause) => rendererRenderError("failed to render Pixi frame", cause),
    });
  }

  renderFromEntities(
    entities: readonly RenderableEntity[],
    previousById: ReadonlyMap<string, RenderableEntity>,
    alpha: number,
  ): Effect.Effect<void, RendererError> {
    return Effect.try({
      try: () => {
        const app = this.requireApp();
        const liveEntities = new Set<string>();
        app.stage.sortableChildren = true;

        for (const entity of entities) {
          liveEntities.add(entity.id);
          const previous = previousById.get(entity.id) ?? entity;

          if (entity.text !== undefined) {
            const label = this.textForStringId(entity.id, entity.layerIndex ?? 0);
            label.position.set(lerp(previous.x, entity.x, alpha), lerp(previous.y, entity.y, alpha));
            label.text = entity.text.value;
            label.style = {
              fontFamily: entity.text.style?.fontFamily ?? "Inter, system-ui, sans-serif",
              fontSize: entity.text.style?.fontSize ?? 10,
              fontWeight: entity.text.style?.fontWeight ?? "bold",
              fill: entity.text.style?.fill ?? 0xffffff,
              ...(entity.text.style?.stroke === undefined
                ? {}
                : {
                    stroke: {
                      color: entity.text.style.stroke,
                      width: entity.text.style.strokeWidth ?? 2,
                    },
                  }),
            };
            label.anchor.set(entity.anchor?.x ?? 0, entity.anchor?.y ?? 0);
            label.rotation = entity.rotation ?? 0;
            label.scale.set(entity.scaleX ?? entity.scale ?? 1, entity.scaleY ?? entity.scale ?? 1);
            label.alpha = clampOpacity(entity.opacity);
          } else {
            const sprite = this.spriteForStringId(entity.id, entity.assetId, entity.layerIndex ?? 0);
            sprite.position.set(lerp(previous.x, entity.x, alpha), lerp(previous.y, entity.y, alpha));

            sprite.anchor.set(entity.anchor?.x ?? 0, entity.anchor?.y ?? 0);
            sprite.rotation = entity.rotation ?? 0;
            sprite.scale.set(entity.scaleX ?? entity.scale ?? 1, entity.scaleY ?? entity.scale ?? 1);
            sprite.alpha = clampOpacity(entity.opacity);
            sprite.tint = entity.tint ?? 0xffffff;

            const animation = entity.animation;
            if (animation !== undefined && animation.frames.length > 0) {
              const frame =
                animation.frames.length === 1
                  ? animation.frames[0]!
                  : (animation.frames[
                      resolveClipFrameIndex(this.compiledClipFor(animation), animation.clockMs, {
                        ...(animation.speed === undefined ? {} : { speed: animation.speed }),
                        ...(animation.offsetMs === undefined ? {} : { offsetMs: animation.offsetMs }),
                      })
                    ] ?? animation.frames[0]!);
              const texture = this.animationFrameTexture(frame);
              if (texture !== undefined && sprite.texture !== texture) {
                sprite.texture = texture;
              }
            }
          }
        }

        for (const [entityId, sprite] of this.spritePoolByStringId) {
          if (!liveEntities.has(entityId)) {
            sprite.removeFromParent();
            this.spritePoolByStringId.delete(entityId);
          }
        }
        for (const [entityId, text] of this.textPoolByStringId) {
          if (!liveEntities.has(entityId)) {
            text.removeFromParent();
            this.textPoolByStringId.delete(entityId);
          }
        }
        this.cullStage();
        app.render();
      },
      catch: (cause) => rendererRenderError("failed to render Pixi entities", cause),
    });
  }

  /** Root container for editor viewport layers (camera pan/zoom applied here). */
  getEditorWorldRoot(): Container {
    const app = this.requireApp();
    app.stage.sortableChildren = true;
    let root = app.stage.getChildByLabel("editor-world-root") as Container | null;
    if (!root) {
      root = new Container();
      root.label = "editor-world-root";
      root.sortableChildren = true;
      root.zIndex = 0;
      app.stage.addChild(root);
    }
    return root;
  }

  resize(width: number, height: number): Effect.Effect<void, RendererError> {
    return Effect.try({
      try: () => {
        const app = this.requireApp();
        app.renderer.resize(width, height);
      },
      catch: (cause) => rendererRenderError("failed to resize Pixi renderer", cause),
    });
  }

  requestRender(): Effect.Effect<void, RendererError> {
    return Effect.try({
      try: () => {
        this.requireApp().render();
      },
      catch: (cause) => rendererRenderError("failed to render Pixi frame", cause),
    });
  }

  canvasElement(): HTMLCanvasElement | undefined {
    return this.app?.canvas;
  }

  textureForRenderableAssetId(renderableAssetId: number | string): Texture | undefined {
    return this.texturesByRenderableAssetId.get(renderableAssetId);
  }

  dispose(): Effect.Effect<void, RendererError> {
    return Effect.try({
      try: () => {
        for (const sprite of this.spritePool.values()) {
          sprite.removeFromParent();
        }
        for (const sprite of this.spritePoolByStringId.values()) {
          sprite.removeFromParent();
        }
        for (const text of this.textPoolByStringId.values()) {
          text.removeFromParent();
        }
        this.spritePool.clear();
        this.spritePoolByStringId.clear();
        this.textPoolByStringId.clear();
        this.spriteLayers.clear();
        this.texturesByRenderableAssetId.clear();
        this.animationFrameTextureCache.clear();
        this.compiledClipCache.clear();
        for (const url of this.objectUrls.splice(0)) {
          URL.revokeObjectURL(url);
        }
        this.app?.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
        this.app = undefined;
      },
      catch: (cause) => rendererDisposeError("failed to dispose Pixi renderer", cause),
    });
  }

  spritePoolSize(): number {
    return this.spritePool.size;
  }

  private requireApp(): Application {
    if (!this.app) {
      throw new Error("Pixi renderer is not mounted");
    }
    return this.app;
  }

  /**
   * The visible world rect used for viewport culling. With the identity stage
   * transform used by the game render paths this equals the screen rect; the
   * Culler maps it through each object's global transform, so it stays correct
   * even if a camera pan/zoom is later applied to the stage.
   */
  private visibleViewRect(): Rectangle | undefined {
    const app = this.app;
    if (!app) {
      return undefined;
    }
    const screen =
      (app as { readonly screen?: Rectangle }).screen ??
      (app.renderer as { readonly screen?: Rectangle } | undefined)?.screen;
    if (!screen || typeof screen.width !== "number" || typeof screen.height !== "number") {
      return undefined;
    }
    return screen;
  }

  /**
   * Pixi v8 viewport culling: marks cullable objects (sprites and tilemap
   * layers) whose global bounds fall entirely outside the visible screen rect
   * as `culled`, so the renderer skips them. Visible objects keep `culled =
   * false` and render identically — z-order, interpolation and object-pool
   * semantics are untouched. Runs before `render()` with
   * `skipUpdateTransform = false` so bounds reflect the freshly set sprite
   * positions rather than the previous frame.
   */
  private cullStage(): void {
    const view = this.visibleViewRect();
    if (!view) {
      return;
    }
    Culler.shared.cull(this.requireApp().stage, view, false);
  }

  private compiledClipFor(animation: {
    readonly clipId?: string;
    readonly frames: readonly RenderableAnimationFrame[];
    readonly loop: boolean;
    readonly defaultDurationMs?: number;
  }): CompiledClip {
    const key =
      animation.clipId ??
      `${animation.loop}:${animation.frames.map((frame) => frame.durationMs ?? "").join(",")}`;
    const cached = this.compiledClipCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const compiled = compileClipTimeline(
      animation.frames.map((frame) => frame.durationMs),
      {
        loop: animation.loop,
        ...(animation.defaultDurationMs === undefined
          ? {}
          : { defaultDurationMs: animation.defaultDurationMs }),
      },
    );
    this.compiledClipCache.set(key, compiled);
    return compiled;
  }

  private animationFrameTexture(frame: RenderableAnimationFrame): Texture | undefined {
    const base = this.texturesByRenderableAssetId.get(frame.assetId);
    if (base === undefined) {
      return undefined;
    }
    if (frame.uv === undefined) {
      return base;
    }
    const key = `${frame.assetId}:${frame.uv.x}:${frame.uv.y}:${frame.uv.w}:${frame.uv.h}`;
    const cached = this.animationFrameTextureCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const texture = new Texture({
      source: base.source,
      frame: new Rectangle(frame.uv.x, frame.uv.y, frame.uv.w, frame.uv.h),
    });
    this.animationFrameTextureCache.set(key, texture);
    return texture;
  }

  private spriteFor(entity: EntityId, renderableAssetId: number, layerIndex: number): Sprite {
    const existing = this.spritePool.get(entity);
    if (existing) {
      return existing;
    }
    const texture = this.texturesByRenderableAssetId.get(renderableAssetId);
    if (!texture) {
      throw new Error(`missing sprite texture ${renderableAssetId}`);
    }
    const sprite = new Sprite({ texture });
    sprite.zIndex = layerIndex;
    sprite.cullable = true;
    this.layerFor(layerIndex).addChild(sprite);
    this.spritePool.set(entity, sprite);
    return sprite;
  }

  private spriteForStringId(entityId: string, renderableAssetId: RenderableAssetId, layerIndex: number): Sprite {
    const existingText = this.textPoolByStringId.get(entityId);
    if (existingText !== undefined) {
      existingText.removeFromParent();
      this.textPoolByStringId.delete(entityId);
    }
    const existing = this.spritePoolByStringId.get(entityId);
    if (existing) {
      return existing;
    }
    const texture = this.texturesByRenderableAssetId.get(renderableAssetId);
    if (!texture) {
      throw new Error(`missing sprite texture ${renderableAssetId}`);
    }
    const sprite = new Sprite({ texture });
    sprite.zIndex = layerIndex;
    sprite.cullable = true;
    this.layerFor(layerIndex).addChild(sprite);
    this.spritePoolByStringId.set(entityId, sprite);
    return sprite;
  }

  private textForStringId(entityId: string, layerIndex: number): Text {
    const existingSprite = this.spritePoolByStringId.get(entityId);
    if (existingSprite !== undefined) {
      existingSprite.removeFromParent();
      this.spritePoolByStringId.delete(entityId);
    }
    const existing = this.textPoolByStringId.get(entityId);
    if (existing) {
      return existing;
    }
    const text = new Text({ text: "" });
    text.zIndex = layerIndex;
    text.cullable = true;
    this.layerFor(layerIndex).addChild(text);
    this.textPoolByStringId.set(entityId, text);
    return text;
  }

  private layerFor(layerIndex: number): Container {
    const existing = this.spriteLayers.get(layerIndex);
    if (existing) {
      return existing;
    }
    const layer = new Container();
    layer.zIndex = layerIndex;
    this.requireApp().stage.addChild(layer);
    this.spriteLayers.set(layerIndex, layer);
    return layer;
  }

  private async textureFromAsset(asset: LoadedAsset): Promise<Texture> {
    if (typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
      throw new Error("Blob URLs are unavailable in this environment");
    }
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([body], { type: asset.mime }));
    this.objectUrls.push(url);
    if (typeof Image === "undefined") {
      return Assets.load<Texture>(url);
    }
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`failed to decode ${asset.mime} asset ${asset.id}`));
      image.src = url;
    });
    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        // Some browser engines reject decode() after onload for cached blob images.
      }
    }
    return Texture.from(image);
  }

  private async textureFromBundledAsset(asset: RegisteredBundledAsset): Promise<Texture> {
    if (asset.path.startsWith("data:") && asset.mime.startsWith("image/")) {
      const texture = await this.textureFromDataImage(asset.path, asset.mime, String(asset.assetId));
      if (texture !== undefined) {
        return texture;
      }
    }
    return Assets.load<Texture>(asset.path);
  }

  private async textureFromDataImage(
    path: string,
    mime: string,
    assetId: string,
  ): Promise<Texture | undefined> {
    if (typeof fetch === "function" && mime !== "image/svg+xml") {
      const response = await fetch(path);
      const blob = await response.blob();
      if (typeof createImageBitmap === "function") {
        return Texture.from(await createImageBitmap(blob));
      }
    }
    if (typeof Image === "undefined") {
      return undefined;
    }
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`failed to decode bundled image ${assetId}`));
      image.src = path;
    });
    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        // Some browser engines reject decode() after onload for cached data URLs.
      }
    }
    return Texture.from(image);
  }
}

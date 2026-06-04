import { AssetPackManifest, AssetPackManifestAsset, License } from "@tileborne/asset-pipeline";
import type { AssetId, ContentHash, PackId } from "@tileborne/core";
import { Effect, Option } from "effect";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container, Rectangle, Sprite, Texture, TextureSource } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import { PositionComponent, RenderableComponent, VelocityComponent } from "../ecs/components.js";
import { World } from "../ecs/world.js";
import { makeGameRuntime } from "../runtime/game-runtime.js";
import type { RenderableEntity } from "../plugin/renderable-entity.js";
import {
  DEFAULT_RUNTIME_ASSET_CACHE_CAPACITY,
  RuntimeAssetLoader,
  type LoadedAssets,
  type RuntimeAssetManifest,
} from "../assets/runtime-asset-loader.js";
import {
  capturePreviousPositions,
  previousPositionFor,
  RendererAssetError,
  RendererDisposeError,
  RendererInitError,
  RendererRenderError,
  type MountedRenderer,
  type RendererAdapter,
} from "./renderer-adapter.js";
import { PixiRendererAdapter } from "./pixi/index.js";

const ASSET_A = "asset:00000000-0000-4000-8000-000000000001" as AssetId;
const ASSET_B = "asset:00000000-0000-4000-8000-000000000002" as AssetId;
const ASSET_C = "asset:00000000-0000-4000-8000-000000000003" as AssetId;
const PACK_ID = "pack:00000000-0000-4000-8000-000000000001" as PackId;
const HASH = `sha256:${"0".repeat(64)}` as ContentHash;

const license = () =>
  new License({
    spdxId: "MIT",
    attribution: Option.none(),
    sourceUrl: Option.none(),
    notes: Option.none(),
  });

const manifestAsset = (id: AssetId, path: string, size = 1): AssetPackManifestAsset =>
  new AssetPackManifestAsset({
    id,
    path,
    mime: "image/png",
    size,
    hash: HASH,
    license: Option.none(),
  });

const manifest = (assets: readonly AssetPackManifestAsset[]): RuntimeAssetManifest =>
  new AssetPackManifest({
    id: PACK_ID,
    name: "test-pack",
    version: "0.0.0",
    license: license(),
    assets,
  });

class NoopRenderer implements RendererAdapter {
  readonly calls: string[] = [];

  mount(container: unknown): Effect.Effect<MountedRenderer, never> {
    this.calls.push("mount");
    return Effect.succeed({ container });
  }

  loadAssets(manifest: RuntimeAssetManifest): Effect.Effect<LoadedAssets, never> {
    void manifest;
    this.calls.push("loadAssets");
    return Effect.succeed(new Map());
  }

  renderFrame(_world: World, alpha: number): Effect.Effect<void, never> {
    this.calls.push(`renderFrame:${alpha}`);
    return Effect.void;
  }

  dispose(): Effect.Effect<void, never> {
    this.calls.push("dispose");
    return Effect.void;
  }
}

describe("RendererAdapter", () => {
  it("accepts a NoopRenderer that satisfies the canonical interface", async () => {
    const renderer: RendererAdapter = new NoopRenderer();
    const world = new World();
    await Effect.runPromise(renderer.mount({}));
    await Effect.runPromise(renderer.loadAssets(manifest([])));
    await Effect.runPromise(renderer.renderFrame(world, 0.5));
    await Effect.runPromise(renderer.dispose());
    expect((renderer as NoopRenderer).calls).toEqual(["mount", "loadAssets", "renderFrame:0.5", "dispose"]);
  });

  it("exposes tagged renderer errors", () => {
    expect(new RendererInitError({ message: "init" })._tag).toBe("RendererInitError");
    expect(new RendererAssetError({ message: "asset", assetId: "a-1" })._tag).toBe("RendererAssetError");
    expect(new RendererRenderError({ message: "render" })._tag).toBe("RendererRenderError");
    expect(new RendererDisposeError({ message: "dispose" })._tag).toBe("RendererDisposeError");
  });
});

describe("RuntimeAssetLoader", () => {
  it("uses a 256 entry LRU cache by default", () => {
    expect(DEFAULT_RUNTIME_ASSET_CACHE_CAPACITY).toBe(256);
  });

  it("loads bytes from a local file path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tileborne-assets-"));
    try {
      const file = join(dir, "sprite.bin");
      await writeFile(file, new Uint8Array([1, 2, 3]));
      const loader = new RuntimeAssetLoader();
      const loaded = await Effect.runPromise(loader.load(manifest([manifestAsset(ASSET_A, file, 3)])));
      expect(loaded.get(ASSET_A)?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves a cached asset on the second request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tileborne-assets-"));
    try {
      const file = join(dir, "sprite.bin");
      await writeFile(file, new Uint8Array([4]));
      const loader = new RuntimeAssetLoader();
      const pack = manifest([manifestAsset(ASSET_A, file)]);
      await Effect.runPromise(loader.load(pack));
      await unlink(file);
      const loaded = await Effect.runPromise(loader.load(pack));
      expect(loaded.get(ASSET_A)?.bytes).toEqual(new Uint8Array([4]));
      expect(loader.cacheSize()).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("evicts the least recently used asset when capacity is exceeded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tileborne-assets-"));
    try {
      const first = join(dir, "first.bin");
      const second = join(dir, "second.bin");
      const third = join(dir, "third.bin");
      await writeFile(first, new Uint8Array([1]));
      await writeFile(second, new Uint8Array([2]));
      await writeFile(third, new Uint8Array([3]));
      const loader = new RuntimeAssetLoader({ capacity: 2 });
      await Effect.runPromise(loader.load(manifest([manifestAsset(ASSET_A, first), manifestAsset(ASSET_B, second)])));
      await Effect.runPromise(loader.load(manifest([manifestAsset(ASSET_C, third)])));
      expect(loader.has(ASSET_A)).toBe(false);
      expect(loader.has(ASSET_B)).toBe(true);
      expect(loader.has(ASSET_C)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("promotes a cache hit to MRU so the other entry is evicted next", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tileborne-assets-"));
    try {
      const first = join(dir, "first.bin");
      const second = join(dir, "second.bin");
      const third = join(dir, "third.bin");
      await writeFile(first, new Uint8Array([1]));
      await writeFile(second, new Uint8Array([2]));
      await writeFile(third, new Uint8Array([3]));
      const loader = new RuntimeAssetLoader({ capacity: 2 });
      const ab = manifest([manifestAsset(ASSET_A, first), manifestAsset(ASSET_B, second)]);
      await Effect.runPromise(loader.load(ab));
      await Effect.runPromise(loader.load(manifest([manifestAsset(ASSET_A, first)])));
      await Effect.runPromise(loader.load(manifest([manifestAsset(ASSET_C, third)])));
      expect(loader.has(ASSET_A)).toBe(true);
      expect(loader.has(ASSET_B)).toBe(false);
      expect(loader.has(ASSET_C)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads bytes through fetch for URL assets", async () => {
    const loader = new RuntimeAssetLoader({
      fetch: async () => new Response(new Uint8Array([9, 8, 7])),
    });
    const loaded = await Effect.runPromise(loader.load(manifest([manifestAsset(ASSET_A, "https://assets.test/sprite.png", 3)])));
    expect(loaded.get(ASSET_A)?.bytes).toEqual(new Uint8Array([9, 8, 7]));
  });
});

describe("renderer interpolation snapshots", () => {
  it("captures previous positions before a fixed update mutates the world", () => {
    const world = new World();
    const entity = world.createEntity();
    const position = world.addComponent(entity, PositionComponent, { x: 1, y: 2 });
    capturePreviousPositions(world);
    position.x = 5;
    position.y = 8;
    expect(previousPositionFor(world, entity)).toEqual({ x: 1, y: 2 });
  });

  it("keeps renderable data in SoA query storage", () => {
    const world = new World();
    const entity = world.createEntity();
    world.addComponent(entity, PositionComponent);
    world.addComponent(entity, RenderableComponent, { assetId: 1, layerIndex: 2 });
    const seen: number[] = [];
    world.query([PositionComponent, RenderableComponent], (_entity, _position, renderable) => {
      seen.push(renderable.assetId, renderable.layerIndex);
    });
    expect(seen).toEqual([1, 2]);
  });

  it("produces lerped display positions across 3 fixed updates at alpha=0.5", async () => {
    const world = new World();
    const entity = world.createEntity();
    world.addComponent(entity, PositionComponent, { x: 0, y: 0 });
    world.addComponent(entity, VelocityComponent, { x: 10, y: 0 });

    const displayed: Array<{ x: number; y: number }> = [];
    const interpolatingRenderer: RendererAdapter = {
      mount: () => Effect.succeed({ container: undefined }),
      loadAssets: () => Effect.succeed(new Map()),
      renderFrame: (w, alpha) => {
        w.query([PositionComponent], (id, position) => {
          const prev = previousPositionFor(w, id) ?? { x: position.x, y: position.y };
          displayed.push({
            x: prev.x + (position.x - prev.x) * alpha,
            y: prev.y + (position.y - prev.y) * alpha,
          });
        });
        return Effect.void;
      },
      dispose: () => Effect.void,
    };

    for (let tick = 0; tick < 3; tick += 1) {
      capturePreviousPositions(world);
      world.query([PositionComponent, VelocityComponent], (_id, position, velocity) => {
        position.x += velocity.x;
        position.y += velocity.y;
      });
      await Effect.runPromise(interpolatingRenderer.renderFrame(world, 0.5));
    }

    expect(displayed).toEqual([
      { x: 5, y: 0 },
      { x: 15, y: 0 },
      { x: 25, y: 0 },
    ]);
  });
});

describe("PixiRendererAdapter", () => {
  it("can be constructed in a Node test process without mounting a canvas", () => {
    const adapter = new PixiRendererAdapter();
    expect(adapter.spritePoolSize()).toBe(0);
  });

  it("renderFromEntities grows and shrinks the string-keyed sprite pool", async () => {
    const adapter = new PixiRendererAdapter();
    const internals = adapter as unknown as {
      app: { readonly stage: Container; readonly render: () => void };
      readonly texturesByRenderableAssetId: Map<AssetId, Texture>;
      readonly spritePoolByStringId: Map<string, unknown>;
    };
    internals.app = { stage: new Container(), render: vi.fn() };
    internals.texturesByRenderableAssetId.set(ASSET_A, Texture.EMPTY);
    internals.texturesByRenderableAssetId.set(ASSET_B, Texture.EMPTY);

    const firstPass: readonly RenderableEntity[] = [
      { id: "player-1", assetId: ASSET_A, x: 0, y: 0 },
      { id: "projectile-1", assetId: ASSET_B, x: 10, y: 0 },
    ];
    await Effect.runPromise(adapter.renderFromEntities(firstPass, new Map(), 1));
    expect(internals.spritePoolByStringId.size).toBe(2);

    const secondPass: readonly RenderableEntity[] = [
      { id: "player-1", assetId: ASSET_A, x: 5, y: 0 },
    ];
    await Effect.runPromise(
      adapter.renderFromEntities(
        secondPass,
        new Map(firstPass.map((entity) => [entity.id, entity])),
        0.5,
      ),
    );
    expect([...internals.spritePoolByStringId.keys()]).toEqual(["player-1"]);
  });

  it("culls entities outside the viewport while keeping in-view entities renderable", async () => {
    const adapter = new PixiRendererAdapter();
    const internals = adapter as unknown as {
      app: { readonly stage: Container; readonly render: () => void; readonly screen: Rectangle };
      readonly texturesByRenderableAssetId: Map<AssetId, Texture>;
      readonly spritePoolByStringId: Map<string, Sprite>;
    };
    // A sized texture gives culled sprites meaningful (non-empty) global bounds.
    const sizedTexture = new Texture({ source: new TextureSource({ width: 32, height: 32 }) });
    internals.app = { stage: new Container(), render: vi.fn(), screen: new Rectangle(0, 0, 800, 600) };
    internals.texturesByRenderableAssetId.set(ASSET_A, sizedTexture);
    internals.texturesByRenderableAssetId.set(ASSET_B, sizedTexture);

    const entities: readonly RenderableEntity[] = [
      { id: "in-view", assetId: ASSET_A, x: 100, y: 100 },
      { id: "off-screen", assetId: ASSET_B, x: 10_000, y: 10_000 },
    ];
    await Effect.runPromise(adapter.renderFromEntities(entities, new Map(), 1));

    const inView = internals.spritePoolByStringId.get("in-view")!;
    const offScreen = internals.spritePoolByStringId.get("off-screen")!;

    expect(inView.cullable).toBe(true);
    expect(offScreen.cullable).toBe(true);
    expect(inView.culled).toBe(false);
    expect(inView.isRenderable).toBe(true);
    expect(offScreen.culled).toBe(true);
    expect(offScreen.isRenderable).toBe(false);
  });

  it("re-includes a culled entity once it scrolls back into the viewport", async () => {
    const adapter = new PixiRendererAdapter();
    const internals = adapter as unknown as {
      app: { readonly stage: Container; readonly render: () => void; readonly screen: Rectangle };
      readonly texturesByRenderableAssetId: Map<AssetId, Texture>;
      readonly spritePoolByStringId: Map<string, Sprite>;
    };
    const sizedTexture = new Texture({ source: new TextureSource({ width: 32, height: 32 }) });
    internals.app = { stage: new Container(), render: vi.fn(), screen: new Rectangle(0, 0, 800, 600) };
    internals.texturesByRenderableAssetId.set(ASSET_A, sizedTexture);

    await Effect.runPromise(
      adapter.renderFromEntities([{ id: "rover", assetId: ASSET_A, x: 5_000, y: 5_000 }], new Map(), 1),
    );
    const rover = internals.spritePoolByStringId.get("rover")!;
    expect(rover.culled).toBe(true);

    await Effect.runPromise(
      adapter.renderFromEntities([{ id: "rover", assetId: ASSET_A, x: 200, y: 200 }], new Map(), 1),
    );
    expect(rover.culled).toBe(false);
    expect(rover.isRenderable).toBe(true);
  });
});

describe("GameRuntime renderer integration", () => {
  it("keeps headless mode ticking", async () => {
    const runtime = makeGameRuntime();
    const state = await Effect.runPromise(runtime.init());
    const entity = state.world.createEntity();
    state.world.addComponent(entity, PositionComponent);
    state.world.addComponent(entity, VelocityComponent, { x: 60, y: 0 });
    await Effect.runPromise(
      runtime.registerSystem({
        name: "movement",
        query: [PositionComponent, VelocityComponent],
        update: (world, dt) => {
          world.query([PositionComponent, VelocityComponent], (_moving, position, velocity) => {
            position.x += velocity.x * dt;
          });
        },
      }),
    );
    await Effect.runPromise(runtime.step(10));
    expect(state.loop.tick).toBe(10);
  });

  it("calls renderFrame once for each single-tick step", async () => {
    const renderer = new NoopRenderer();
    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ renderer, rendererContainer: {}, assetManifest: manifest([]) }));
    for (let index = 0; index < 10; index += 1) {
      await Effect.runPromise(runtime.step(1));
    }
    expect(renderer.calls.filter((call) => call.startsWith("renderFrame")).length).toBe(10);
  });

  it("disposes the configured renderer on stop", async () => {
    const renderer = new NoopRenderer();
    const runtime = makeGameRuntime();
    await Effect.runPromise(runtime.init({ renderer, rendererContainer: {}, assetManifest: manifest([]) }));
    await Effect.runPromise(runtime.stop());
    expect(renderer.calls.at(-1)).toBe("dispose");
  });
});

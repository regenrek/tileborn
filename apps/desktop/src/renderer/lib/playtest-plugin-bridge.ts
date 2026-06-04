/**
 * Tiny shell-side bridge from a plugin id string to its
 * {@link RenderableEntityProjector} factory + bundled assets.
 *
 * Architectural invariant (ADR-0014, "Plugin-boundary contract"):
 * This is the **only** file under `apps/desktop/src/renderer/**` that names a
 * concrete plugin id literal. Everything else in the renderer treats the
 * resolved projector as an opaque `RenderableEntityProjector<unknown>`.
 *
 * Discovery (ADR-0023 section B): resolution is now a **registry lookup**, not
 * a `switch (pluginId)`. Each built-in mode provider registers its projector +
 * frame codecs keyed by plugin id; `resolvePlaytestPlugin` resolves the active
 * mode's plugin id against that registry. A new genre plugin becomes resolvable
 * by registering a provider here — no per-id `case` to grow. The renderer can't
 * execute plugin code (ADR-0004), so the projector code is still bundled and
 * registered in this one boundary file; WHICH plugin is the active mode is
 * discovered from the manifest upstream (`discoverGameModes`).
 */
import {
  PLUGIN_ID,
  createBattleRoyaleBundledAssets,
  createInitialFrame,
  createBattleRoyaleProjector,
  decodeClientFrameView,
  decodeServerFrame,
  encodeClientInputFrame,
  encodeHeartbeatFrame,
  encodeServerFrame,
  serverFrameToView,
} from '@tileborne/plugin-battle-royale';
import type {
  BattleRoyaleProjectorConfig,
  ClientFrameView,
  ClientInputFrame,
  InitialFrameInput,
  InputDirection,
  PlayerModelRenderData,
  ServerFrameView,
  ZoneView,
} from '@tileborne/plugin-battle-royale';
import type {
  BundledAssetSpec,
  RenderableEntityProjector,
  RuntimePluginRenderManifest,
  RegisteredBundledAsset,
} from '@tileborne/runtime';
import { createBundledAssetRegistry } from '@tileborne/runtime';

/**
 * Bridge-default render manifest used when a resolved plugin's projector does
 * not implement `getRenderManifest`. Keeps the shell working with older or
 * non-BR plugins that pre-date ADR-0014 Phase 1's manifest contract.
 */
const FALLBACK_RENDER_MANIFEST: RuntimePluginRenderManifest = {
  fixedZoom: 4,
  hudInsets: { top: 0, right: 0, bottom: 0, left: 0 },
};

/**
 * The single plugin id this bridge currently resolves. Exported so other
 * renderer files can refer to the active plugin without naming the literal
 * themselves (ADR-0014 boundary invariant).
 */
export const BATTLE_ROYALE_PLUGIN_ID = PLUGIN_ID;

export type {
  ClientFrameView,
  ClientInputFrame,
  InitialFrameInput,
  InputDirection,
  PlayerModelRenderData,
  ServerFrameView,
  ZoneView,
};

/**
 * Per-playtest player-model wiring resolved by the shell from the per-project
 * roster + the lobby selection, then injected into the plugin projector. Kept
 * here (the ADR-0014 boundary file) so the rest of the renderer never names a
 * plugin id; the data itself is plugin-agnostic render data.
 */
export interface PlaytestPlayerModelConfig {
  /** modelId -> resolved render data (atlas + animation frames + anchor). */
  readonly catalog: ReadonlyMap<string, PlayerModelRenderData>;
  /** Fallback per-player selection when the wire snapshot omits modelId. */
  readonly playerModelIds: ReadonlyMap<string, string>;
  /** Final fallback model id applied to any player without a resolved selection. */
  readonly defaultModelId?: string;
  /** Installed-pack atlas textures the runtime must load for the catalog models. */
  readonly atlasAssets: readonly BundledAssetSpec[];
}

export interface ResolvePlaytestPluginOptions {
  readonly playerModels?: PlaytestPlayerModelConfig;
}

export interface ResolvedPlaytestPlugin {
  readonly projector: RenderableEntityProjector<unknown>;
  readonly bundledAssets: readonly RegisteredBundledAsset[];
  /**
   * Plugin-owned render manifest (fixed zoom + HUD insets). Resolved from
   * `projector.getRenderManifest()` when available; falls back to a neutral
   * default (zoom 4, no insets) for plugins that pre-date ADR-0014 Phase 1.
   * This is the single source of truth for those values inside the renderer.
   */
  readonly manifest: RuntimePluginRenderManifest;
  /**
   * Decode a single plugin-emitted wire frame into the opaque snapshot value
   * the projector consumes. Returns `undefined` when the bytes are not
   * recognised. The shell calls this for `tileborne:runtime:snapshot` IPC
   * frames; it is the **one** place the BR decoder is referenced from the
   * renderer (kept here alongside the plugin-id literal).
   */
  readonly decodeServerFrame: (bytes: Uint8Array) => unknown;
  readonly serverFrameToView: (frame: unknown) => ServerFrameView | undefined;
  readonly createInitialFrame: (input: InitialFrameInput) => unknown;
  readonly encodeClientInputFrame: (input: ClientInputFrame) => Uint8Array;
  readonly encodeHeartbeatFrame: (tick: number) => Uint8Array;
  readonly encodeServerFrame: (frame: unknown) => Uint8Array;
  readonly decodeClientFrameView: (bytes: Uint8Array) => ClientFrameView | undefined;
}

/**
 * Builds a {@link ResolvedPlaytestPlugin} for one mode provider. Registered by
 * plugin id in {@link MODE_RENDER_PROVIDERS}; this is the discovery seam a
 * second genre plugin slots into (no `switch` to grow).
 */
type ModeRenderProvider = (options: ResolvePlaytestPluginOptions) => ResolvedPlaytestPlugin;

const createBattleRoyalePlaytestPlugin: ModeRenderProvider = (options) => {
  const projectorConfig: BattleRoyaleProjectorConfig | undefined =
    options.playerModels === undefined
      ? undefined
      : {
          catalog: options.playerModels.catalog,
          playerModelIds: options.playerModels.playerModelIds,
          ...(options.playerModels.defaultModelId === undefined
            ? {}
            : { defaultModelId: options.playerModels.defaultModelId }),
        };
  const projector = createBattleRoyaleProjector(projectorConfig);
  const manifest = projector.getRenderManifest?.() ?? FALLBACK_RENDER_MANIFEST;
  const modelAtlasAssets = registerBundledAssets(options.playerModels?.atlasAssets ?? []);
  return {
    projector,
    bundledAssets: [
      ...registerBundledAssets(createBattleRoyaleBundledAssets()),
      ...modelAtlasAssets,
    ],
    manifest,
    decodeServerFrame: (bytes) => {
      try {
        return decodeServerFrame(bytes);
      } catch {
        return undefined;
      }
    },
    serverFrameToView,
    createInitialFrame,
    encodeClientInputFrame,
    encodeHeartbeatFrame,
    encodeServerFrame,
    decodeClientFrameView,
  };
};

/**
 * Registry of built-in mode render providers keyed by plugin id. Battle Royale
 * is the first registered mode (ADR-0023: BR is one discovered mode, not a
 * hardcoded `case`). Adding a genre = registering another provider here.
 */
const MODE_RENDER_PROVIDERS: ReadonlyMap<string, ModeRenderProvider> = new Map([
  [BATTLE_ROYALE_PLUGIN_ID, createBattleRoyalePlaytestPlugin],
]);

/** Plugin ids that have a bundled render provider (id-list discovery surface). */
export const KNOWN_PLAYTEST_MODE_IDS: readonly string[] = [...MODE_RENDER_PROVIDERS.keys()];

export const resolvePlaytestPlugin = (
  pluginId: string,
  options: ResolvePlaytestPluginOptions = {},
): ResolvedPlaytestPlugin | undefined => MODE_RENDER_PROVIDERS.get(pluginId)?.(options);

const registerBundledAssets = (
  assets: readonly BundledAssetSpec[],
): readonly RegisteredBundledAsset[] => {
  const registry = createBundledAssetRegistry();
  for (const asset of assets) {
    registry.register(asset);
  }
  return registry.list();
};

/**
 * Tiny shell-side bridge from a plugin id string to its
 * {@link RenderableEntityProjector} factory + bundled assets.
 *
 * Architectural invariant (ADR-0014, "Plugin-boundary contract"):
 * This is the **only** file under `apps/desktop/src/renderer/**` that names a
 * concrete plugin id literal. Everything else in the renderer treats the
 * resolved projector as an opaque `RenderableEntityProjector<unknown>`.
 *
 * When a second plugin appears, reconsider whether this should become a lazy
 * id-list discovery layer instead of growing the switch. (ADR-0014 Risks #5.)
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
  ClientFrameView,
  ClientInputFrame,
  InitialFrameInput,
  InputDirection,
  ServerFrameView,
  ZoneView,
} from '@tileborne/plugin-battle-royale';
import type {
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
  ServerFrameView,
  ZoneView,
};

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

export const resolvePlaytestPlugin = (pluginId: string): ResolvedPlaytestPlugin | undefined => {
  switch (pluginId) {
    case BATTLE_ROYALE_PLUGIN_ID: {
      const projector = createBattleRoyaleProjector();
      const manifest = projector.getRenderManifest?.() ?? FALLBACK_RENDER_MANIFEST;
      return {
        projector,
        bundledAssets: registerBundledAssets(createBattleRoyaleBundledAssets()),
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
    }
    default:
      return undefined;
  }
};

const registerBundledAssets = (
  assets: ReturnType<typeof createBattleRoyaleBundledAssets>,
): readonly RegisteredBundledAsset[] => {
  const registry = createBundledAssetRegistry();
  for (const asset of assets) {
    registry.register(asset);
  }
  return registry.list();
};

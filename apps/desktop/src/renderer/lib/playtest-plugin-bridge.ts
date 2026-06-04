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
  battleRoyaleDefaultInputMap,
  createBattleRoyaleBundledAssets,
  createInitialFrame,
  createBattleRoyaleProjector,
  decodeClientFrameView,
  decodeServerFrame,
  encodeClientInputFrame,
  encodeHeartbeatFrame,
  encodeServerFrame,
  resolveBattleRoyaleInputIntent,
  serverFrameToView,
} from '@tileborne/plugin-battle-royale';
import {
  controlScheme,
  coreActionId,
  CONTROL_SCHEMES,
  CORE_ACTIONS,
  type ActionState,
  type ControlScheme,
  type InputMap,
} from '@tileborne/core';
import { decodeInputMap, resolveEffectiveInputMap } from '@tileborne/plugin-api';
import { Result } from 'effect';
import {
  deriveInputCaptureProfile,
  type InputCaptureProfile,
  type ResolvedInputIntent,
} from './playtest-input';
import { loadUserInputOverlay } from './playtest-user-bindings';
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
  /**
   * The user's persisted keybind remap overlay (ADR-0024). When provided it is
   * layered on the plugin defaults via `resolveEffectiveInputMap`; when omitted
   * the overlay is loaded from the renderer prefs store
   * ({@link loadUserInputOverlay}). Pass `undefined` explicitly is treated the
   * same as omitting (the store still loads) — to force "no overlay" in a test,
   * run with an empty store. The effective map the resolver consumes is always
   * `pluginDefault ⊕ overlay`, deterministic + non-destructive.
   */
  readonly userInputOverlay?: InputMap;
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
  /**
   * The plugin's EFFECTIVE neutral input map (ADR-0024): its default bindings
   * with the user remap overlay applied (`resolveEffectiveInputMap(pluginDefault,
   * userOverlay)`). The overlay is the player's persisted rebindings loaded from
   * the renderer prefs store. The engine resolver maps raw input through this.
   */
  readonly inputMap: InputMap;
  /** The active control scheme the resolver resolves against (keyboard-mouse today). */
  readonly controlScheme: ControlScheme;
  /** Which key codes / mouse buttons are bound in the active scheme. */
  readonly inputCaptureProfile: InputCaptureProfile;
  /**
   * The plugin's action→intent adapter: maps a neutral `ActionState` into the
   * `{ dir, shoot, aimDeg, weaponSlot }` wire intent the runtime + BR expect.
   * This is the ONLY place the renderer learns what an action "does".
   */
  readonly resolveInputIntent: (
    actions: ActionState,
    context: { aimOrigin?: { x: number; y: number } },
  ) => ResolvedInputIntent;
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
  // Build the effective input map = BR plugin defaults ⊕ user remap overlay
  // (ADR-0024). The overlay is the player's persisted rebindings; when none is
  // injected we load it from the renderer prefs store. `resolveEffectiveInputMap`
  // keeps it deterministic + non-destructive (defaults remain the base), so a
  // remapped PrimaryAction (e.g. Space→mouse) resolves through the new trigger.
  const scheme = controlScheme(CONTROL_SCHEMES.KeyboardMouse);
  const userOverlay = options.userInputOverlay ?? loadUserInputOverlay();
  const inputMap = resolveEffectiveInputMap(battleRoyaleDefaultInputMap(), userOverlay);
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
    inputMap,
    controlScheme: scheme,
    inputCaptureProfile: deriveInputCaptureProfile(inputMap, scheme),
    resolveInputIntent: (actions, context) => resolveBattleRoyaleInputIntent(actions, context),
  };
};

/**
 * The example arena plugin id. Named here in the ADR-0014 boundary file (the one
 * place the renderer may name concrete plugin ids), so the rest of the renderer
 * resolves arena as the active mode purely by manifest discovery.
 */
export const EXAMPLE_ARENA_PLUGIN_ID = '@tileborne-plugins/example-arena';

const ARENA_INPUT_MAP_CONTRIBUTION_ID = 'arena-input-map';

/**
 * The arena mode's default bindings as plain DATA (mirrors the arena manifest's
 * `runtime.inputMaps` slot): WASD move, pointer aim, mouse-0 melee, Shift dash.
 * Decoded against the engine `InputMap` schema like any other mode.
 */
const ARENA_INPUT_MAP_DATA = {
  id: 'arena-default-bindings',
  actions: [
    { action: CORE_ACTIONS.Move, valueKind: 'analog2d' },
    { action: CORE_ACTIONS.Aim, valueKind: 'pointer' },
    { action: CORE_ACTIONS.PrimaryAction, valueKind: 'digital' },
    { action: CORE_ACTIONS.Dash, valueKind: 'digital' },
  ],
  schemeDefaults: {
    'keyboard-mouse': [
      { _tag: 'InputBinding', action: CORE_ACTIONS.Move, trigger: { _tag: 'key', code: 'KeyW' }, axisRole: 'y-' },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Move, trigger: { _tag: 'key', code: 'KeyS' }, axisRole: 'y+' },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Move, trigger: { _tag: 'key', code: 'KeyA' }, axisRole: 'x-' },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Move, trigger: { _tag: 'key', code: 'KeyD' }, axisRole: 'x+' },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Aim, trigger: { _tag: 'pointer' } },
      { _tag: 'InputBinding', action: CORE_ACTIONS.PrimaryAction, trigger: { _tag: 'mouseButton', button: 0 } },
      { _tag: 'InputBinding', action: CORE_ACTIONS.Dash, trigger: { _tag: 'key', code: 'ShiftLeft' } },
    ],
  },
};

const ARENA_MOVE_ACTION = coreActionId(CORE_ACTIONS.Move);
const ARENA_PRIMARY_ACTION = coreActionId(CORE_ACTIONS.PrimaryAction);

/** Quantize a move analog vector into the neutral 8-way direction (or idle). */
const arenaMoveVectorToDirection = (x: number, y: number): number | undefined => {
  const dx = Math.sign(x);
  const dy = Math.sign(y);
  if (dx === 0 && dy === 0) {
    return undefined;
  }
  if (dx === 1 && dy === 0) return 0;
  if (dx === 1 && dy === 1) return 1;
  if (dx === 0 && dy === 1) return 2;
  if (dx === -1 && dy === 1) return 3;
  if (dx === -1 && dy === 0) return 4;
  if (dx === -1 && dy === -1) return 5;
  if (dx === 0 && dy === -1) return 6;
  return 7;
};

/**
 * Minimal, skeletal render provider for the example arena mode (ADR-0023
 * proof). The arena package proves genre-neutral DISCOVERY + contract decode,
 * but it defines no server-frame WIRE codec yet, so the multiplayer snapshot
 * path decodes nothing (`decodeServerFrame` → undefined) and the projector emits
 * no entities. This provider exists so that SELECTING arena resolves a projector
 * (no crash) and wires the neutral arena input map; full arena entity rendering
 * is deferred until the arena defines a wire frame. It touches no engine code.
 */
const createExampleArenaPlaytestPlugin: ModeRenderProvider = (options) => {
  const projector: RenderableEntityProjector<unknown> = {
    project: () => [],
    mergeFrame: (_previousFullState, frame) => frame,
    getRenderManifest: () => FALLBACK_RENDER_MANIFEST,
  };
  const scheme = controlScheme(CONTROL_SCHEMES.KeyboardMouse);
  const decoded = decodeInputMap(ARENA_INPUT_MAP_CONTRIBUTION_ID, ARENA_INPUT_MAP_DATA);
  // Static, schema-valid data (covered by the arena package proof test); the
  // BR-default fallback only guards an impossible decode failure with a valid map.
  const baseInputMap = Result.isSuccess(decoded) ? decoded.success : battleRoyaleDefaultInputMap();
  const userOverlay = options.userInputOverlay ?? loadUserInputOverlay();
  const inputMap = resolveEffectiveInputMap(baseInputMap, userOverlay);
  return {
    projector,
    bundledAssets: [],
    manifest: FALLBACK_RENDER_MANIFEST,
    decodeServerFrame: () => undefined,
    serverFrameToView: () => undefined,
    createInitialFrame: (input) => input,
    encodeClientInputFrame: () => new Uint8Array(),
    encodeHeartbeatFrame: () => new Uint8Array(),
    encodeServerFrame: () => new Uint8Array(),
    decodeClientFrameView: () => undefined,
    inputMap,
    controlScheme: scheme,
    inputCaptureProfile: deriveInputCaptureProfile(inputMap, scheme),
    resolveInputIntent: (actions) => {
      const move = actions.analog.get(ARENA_MOVE_ACTION);
      const dir = move === undefined ? undefined : arenaMoveVectorToDirection(move.x, move.y);
      const shoot = actions.digital.get(ARENA_PRIMARY_ACTION)?.pressed ?? false;
      return { dir, shoot };
    },
  };
};

/**
 * Registry of built-in mode render providers keyed by plugin id. Battle Royale
 * is the first registered mode (ADR-0023: BR is one discovered mode, not a
 * hardcoded `case`); the example arena is the second, proving the registry
 * extends to a new genre. Adding a genre = registering another provider here.
 */
const MODE_RENDER_PROVIDERS: ReadonlyMap<string, ModeRenderProvider> = new Map([
  [BATTLE_ROYALE_PLUGIN_ID, createBattleRoyalePlaytestPlugin],
  [EXAMPLE_ARENA_PLUGIN_ID, createExampleArenaPlaytestPlugin],
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

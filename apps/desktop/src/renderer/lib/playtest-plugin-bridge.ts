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
 * a per-plugin-id switch. Each built-in mode provider registers its projector +
 * frame codecs behind manifest-declared renderer capability ids;
 * `resolvePlaytestPlugin` resolves the active mode's declared renderer
 * capability against that registry. A new genre plugin becomes resolvable
 * by registering a provider here — no per-id `case` to grow. The renderer can't
 * execute plugin code (ADR-0004), so the projector code is still bundled and
 * registered in this one boundary file; WHICH plugin is the active mode is
 * discovered from the manifest upstream (`discoverGameModes`).
 */
import {
  BR_PRIMARY_WEAPON_ID,
  PLUGIN_ID,
  battleRoyaleAudioCues,
  battleRoyaleDefaultHudLayout,
  battleRoyaleDefaultInputMap,
  createBattleRoyaleBundledAssets,
  createInitialFrame,
  createBattleRoyaleProjector,
  decodeClientFrameView,
  decodeServerFrame,
  encodeClientInputFrame,
  encodeHeartbeatFrame,
  encodeSnapshotAckFrame,
  encodeServerFrame,
  requiredBattleRoyaleRenderableAssetIds,
  resolveBattleRoyaleInputIntent,
  serverFrameToView,
} from '@tileborne/plugin-battle-royale/renderer';
import {
  ARENA_INPUT_MAP_CONTRIBUTION_ID,
  ARENA_PLUGIN_ID,
  buildArenaInputMapData,
  createArenaBundledAssets,
  createArenaProjector,
  createInitialFrame as createArenaInitialFrame,
  decodeClientFrameView as decodeArenaClientFrameView,
  decodeServerFrame as decodeArenaServerFrame,
  encodeClientInputFrame as encodeArenaClientInputFrame,
  encodeHeartbeatFrame as encodeArenaHeartbeatFrame,
  encodeSnapshotAckFrame as encodeArenaSnapshotAckFrame,
  encodeServerFrame as encodeArenaServerFrame,
  serverFrameToView as arenaServerFrameToView,
} from '@tileborne/plugin-example-arena';
import {
  controlScheme,
  coreActionId,
  standardHudLayout,
  CONTROL_SCHEMES,
  CORE_ACTIONS,
  type ActionState,
  type ControlScheme,
  type HudLayout,
  type InputMap,
} from '@tileborne/core';
import {
  decodeInputMap,
  resolveEffectiveHudLayout,
  resolveEffectiveInputMap,
  type GameModeCapabilityId,
} from '@tileborne/plugin-api';
import { Result } from 'effect';
import {
  deriveInputCaptureProfile,
  type InputCaptureProfile,
  type ResolvedInputIntent,
} from './playtest-input';
import { loadUserInputOverlay } from './playtest-user-bindings';
import { loadUserHudOverlay } from './playtest-user-hud';
import type {
  BattleRoyaleProjectorConfig,
  ClientFrameView,
  ClientInputFrame,
  InitialFrameInput,
  InputDirection,
  PlayerModelClipRenderData,
  PlayerModelRenderData,
  ServerFrameView,
  SpriteVisualRenderData,
  WeaponVisualRenderData,
  ZoneView,
} from '@tileborne/plugin-battle-royale/renderer';
import type {
  BundledAssetSpec,
  RenderableEntityProjector,
  RuntimePluginRenderManifest,
  RegisteredBundledAsset,
  RuntimeAudioBusDefinition,
  RuntimeAudioCueDefinition,
} from '@tileborne/runtime';
import {
  createBundledAssetRegistry,
  dispatchRuntimeAudioEvent,
  runtimeAudioCueForEvent,
} from '@tileborne/runtime';

const cueByBinding = (
  cues: readonly RuntimeAudioCueDefinition[],
  binding: string,
): string | undefined => cues.find((cue) => cue.binding === binding)?.id;

export const audioCueForResolvedIntent = (
  cues: readonly RuntimeAudioCueDefinition[],
  intent: ResolvedInputIntent,
  previousIntent: ResolvedInputIntent | undefined,
): string | undefined => {
  if (intent.shoot && previousIntent?.shoot !== true) return cueByBinding(cues, 'weapon.fire');
  if (intent.reload && previousIntent?.reload !== true) return cueByBinding(cues, 'weapon.reload');
  return undefined;
};

export const audioCueForRuntimeEvent = (
  cues: readonly RuntimeAudioCueDefinition[],
  event: Parameters<typeof runtimeAudioCueForEvent>[1],
): string | undefined => runtimeAudioCueForEvent(cues, event);

export { dispatchRuntimeAudioEvent };

const battleRoyaleRuntimeAudioCues = (): readonly RuntimeAudioCueDefinition[] =>
  battleRoyaleAudioCues;

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
  PlayerModelClipRenderData,
  PlayerModelRenderData,
  ServerFrameView,
  SpriteVisualRenderData,
  WeaponVisualRenderData,
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
  /** Installed-pack atlas textures the runtime must load for the catalog models. */
  readonly atlasAssets: readonly BundledAssetSpec[];
}

export interface PlaytestOverlayVisualConfig {
  /** overlay slot -> resolved render data (atlas + animation frames + anchor). */
  readonly catalog: ReadonlyMap<string, SpriteVisualRenderData>;
  /** Installed-pack atlas textures the runtime must load for the overlay visuals. */
  readonly atlasAssets: readonly BundledAssetSpec[];
}

/**
 * Per-weapon-ENTITY visuals derived from the merged game-object catalog
 * (ADR-0028): each weapon `GameObjectType` (`weapon-ref` component) resolves to
 * its equipped sprite + companion visuals. Replaces the former global
 * equipped-weapon/projectile/muzzle-flash/impact-vfx/pickup visual roles.
 */
export interface PlaytestWeaponVisualConfig {
  /** weaponId -> render-ready weapon visuals (equipped + companions). */
  readonly catalog: ReadonlyMap<string, WeaponVisualRenderData>;
  /** Installed-pack atlas textures the runtime must load for the weapon visuals. */
  readonly atlasAssets: readonly BundledAssetSpec[];
}

export interface ResolvePlaytestPluginOptions {
  readonly playerModels?: PlaytestPlayerModelConfig;
  readonly overlayVisuals?: PlaytestOverlayVisualConfig;
  readonly weaponVisuals?: PlaytestWeaponVisualConfig;
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
  /**
   * The user's persisted HUD customisation overlay (same overlay model as
   * {@link userInputOverlay}). When omitted it is loaded from the renderer
   * prefs store ({@link loadUserHudOverlay}). The effective layout the HUD
   * renderer consumes is always `pluginDefault ⊕ overlay`.
   */
  readonly userHudOverlay?: HudLayout;
  /**
   * The mode's default HUD layout DISCOVERED from its manifest
   * (`runtime.hudLayouts` via the `gameModes` IPC). When provided it is the
   * base layout (so an installed third-party mode's manifest wins); the
   * code-built default of the bundled plugin is only the fallback for callers
   * without manifest access (tests, host bootstrap).
   */
  readonly manifestHudLayout?: HudLayout;
  /**
   * The PROJECT's designer-authored HUD layout overlay (persisted in the
   * project manifest's settings bag, `project-hud-layout.ts`). Sits between
   * the plugin default and the player's personal overlay:
   * `pluginDefault ⊕ project ⊕ player`.
   */
  readonly projectHudLayout?: HudLayout;
}

/**
 * Resolve the three HUD layout layers into the effective in-match layout:
 * plugin default (manifest-discovered or bundled) ⊕ project overlay ⊕ player
 * overlay. Each step is the same non-destructive merge, so absent layers are
 * free.
 */
const resolveHudLayoutLayers = (
  base: HudLayout,
  options: ResolvePlaytestPluginOptions,
): HudLayout => {
  const withProject =
    options.projectHudLayout === undefined
      ? base
      : resolveEffectiveHudLayout(base, options.projectHudLayout);
  return resolveEffectiveHudLayout(withProject, options.userHudOverlay ?? loadUserHudOverlay());
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
   * The mode's EFFECTIVE in-match HUD layout: the plugin's contributed default
   * (`RuntimeHudLayout` slot data) with the project's designer overlay and the
   * user's persisted HUD customisation overlay applied (in that order). The
   * HUD renderer consumes this generically — which widgets exist, where they
   * sit, and how many there are is entirely layout data, never shell code.
   */
  readonly hudLayout: HudLayout;
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
  readonly encodeSnapshotAckFrame: (tick: number, receivedAtMs: number) => Uint8Array;
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
   * Optional plugin-owned audio contribution. The shell stays generic: it asks
   * the active mode which cue, if any, should fire for the resolved input
   * intent, then sends that cue through the shared browser runtime audio engine.
   */
  readonly audio?:
    | {
        readonly buses: readonly RuntimeAudioBusDefinition[];
        readonly cues: readonly RuntimeAudioCueDefinition[];
        readonly cueForIntent: (
          intent: ResolvedInputIntent,
          previousIntent: ResolvedInputIntent | undefined,
        ) => string | undefined;
      }
    | undefined;
  /**
   * The plugin's action→intent adapter: maps a neutral `ActionState` into the
   * `{ dir, shoot, reload, interact, drop, abilities, aimDeg, swapSlot }` intent the runtime expects, with
   * `dir` omitted when there is no movement. This is the ONLY place the
   * renderer learns what an action "does".
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
  const weaponCatalog = options.weaponVisuals?.catalog;
  // BR's primary weapon is the default when present; otherwise a single derived
  // weapon entity serves as default (multi-weapon snapshots carry weaponId).
  const defaultWeaponId =
    weaponCatalog === undefined
      ? undefined
      : weaponCatalog.has(BR_PRIMARY_WEAPON_ID)
        ? BR_PRIMARY_WEAPON_ID
        : [...weaponCatalog.keys()].sort()[0];
  const projectorConfig: BattleRoyaleProjectorConfig | undefined =
    options.playerModels === undefined &&
    options.overlayVisuals === undefined &&
    weaponCatalog === undefined
      ? undefined
      : {
          ...(options.playerModels === undefined ? {} : { catalog: options.playerModels.catalog }),
          ...(options.overlayVisuals === undefined
            ? {}
            : { overlays: options.overlayVisuals.catalog }),
          ...(weaponCatalog === undefined ? {} : { weapons: weaponCatalog }),
          ...(defaultWeaponId === undefined ? {} : { defaultWeaponId }),
        };
  const projector = createBattleRoyaleProjector(projectorConfig);
  const manifest = projector.getRenderManifest?.() ?? FALLBACK_RENDER_MANIFEST;
  const modelAtlasAssets = registerBundledAssets(options.playerModels?.atlasAssets ?? []);
  const overlayVisualAtlasAssets = registerBundledAssets(options.overlayVisuals?.atlasAssets ?? []);
  const weaponVisualAtlasAssets = registerBundledAssets(options.weaponVisuals?.atlasAssets ?? []);
  // Build the effective input map = BR plugin defaults ⊕ user remap overlay
  // (ADR-0024). The overlay is the player's persisted rebindings; when none is
  // injected we load it from the renderer prefs store. `resolveEffectiveInputMap`
  // keeps it deterministic + non-destructive (defaults remain the base), so a
  // remapped PrimaryAction (e.g. Space→mouse) resolves through the new trigger.
  const scheme = controlScheme(CONTROL_SCHEMES.KeyboardMouse);
  const userOverlay = options.userInputOverlay ?? loadUserInputOverlay();
  const inputMap = resolveEffectiveInputMap(battleRoyaleDefaultInputMap(), userOverlay);
  const hudLayout = resolveHudLayoutLayers(
    options.manifestHudLayout ?? battleRoyaleDefaultHudLayout(),
    options,
  );
  const bundledAssets = [
    ...registerBundledAssets(createBattleRoyaleBundledAssets()),
    ...modelAtlasAssets,
    ...overlayVisualAtlasAssets,
    ...weaponVisualAtlasAssets,
  ];
  assertBundledAssetsPresent(
    bundledAssets,
    requiredBattleRoyaleRenderableAssetIds(),
    BATTLE_ROYALE_PLUGIN_ID,
  );
  const audioCues = battleRoyaleRuntimeAudioCues();
  return {
    projector,
    bundledAssets,
    manifest,
    hudLayout,
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
    encodeSnapshotAckFrame,
    encodeServerFrame,
    decodeClientFrameView,
    inputMap,
    controlScheme: scheme,
    inputCaptureProfile: deriveInputCaptureProfile(inputMap, scheme),
    audio: {
      buses: [
        {
          id: 'battle-royale.music',
          label: 'Battle Royale Music',
          kind: 'music',
          defaultVolume: 0.65,
        },
        {
          id: 'battle-royale.sfx',
          label: 'Battle Royale SFX',
          kind: 'sfx',
          defaultVolume: 0.85,
        },
      ],
      cues: audioCues,
      cueForIntent: (intent, previousIntent) =>
        audioCueForResolvedIntent(audioCues, intent, previousIntent),
    },
    resolveInputIntent: (actions, context) => resolveBattleRoyaleInputIntent(actions, context),
  };
};

/**
 * The example arena plugin id. Named here in the ADR-0014 boundary file (the one
 * place the renderer may name concrete plugin ids), so the rest of the renderer
 * resolves arena as the active mode purely by manifest discovery.
 */
export const EXAMPLE_ARENA_PLUGIN_ID = ARENA_PLUGIN_ID;
export const BATTLE_ROYALE_RENDERER_CAPABILITY_ID = 'battle-royale.renderer' as const;
export const EXAMPLE_ARENA_RENDERER_CAPABILITY_ID = 'example-arena.renderer' as const;

const ARENA_MOVE_ACTION = coreActionId(CORE_ACTIONS.Move);
const ARENA_PRIMARY_ACTION = coreActionId(CORE_ACTIONS.PrimaryAction);

/** Quantize a move analog vector into the neutral 8-way direction (or idle). */
const arenaMoveVectorToDirection = (x: number, y: number): InputDirection | undefined => {
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

const createExampleArenaPlaytestPlugin: ModeRenderProvider = (options) => {
  const projector = createArenaProjector();
  const manifest = projector.getRenderManifest?.() ?? FALLBACK_RENDER_MANIFEST;
  const scheme = controlScheme(CONTROL_SCHEMES.KeyboardMouse);
  const decoded = decodeInputMap(ARENA_INPUT_MAP_CONTRIBUTION_ID, buildArenaInputMapData());
  // Static, schema-valid data (covered by the arena package proof test); the
  // BR-default fallback only guards an impossible decode failure with a valid map.
  const baseInputMap = Result.isSuccess(decoded) ? decoded.success : battleRoyaleDefaultInputMap();
  const userOverlay = options.userInputOverlay ?? loadUserInputOverlay();
  const inputMap = resolveEffectiveInputMap(baseInputMap, userOverlay);
  // Without a manifest-discovered layout, the engine's neutral baseline
  // arrangement applies; widgets only render where HUD state exists.
  const hudLayout = resolveHudLayoutLayers(
    options.manifestHudLayout ?? standardHudLayout(),
    options,
  );
  return {
    projector,
    bundledAssets: registerBundledAssets(createArenaBundledAssets()),
    manifest,
    hudLayout,
    decodeServerFrame: (bytes) => {
      try {
        return decodeArenaServerFrame(bytes);
      } catch {
        return undefined;
      }
    },
    serverFrameToView: (frame) => arenaServerFrameToView(frame) as ServerFrameView | undefined,
    createInitialFrame: createArenaInitialFrame,
    encodeClientInputFrame: encodeArenaClientInputFrame,
    encodeHeartbeatFrame: encodeArenaHeartbeatFrame,
    encodeSnapshotAckFrame: encodeArenaSnapshotAckFrame,
    encodeServerFrame: encodeArenaServerFrame,
    decodeClientFrameView: (bytes) =>
      decodeArenaClientFrameView(bytes) as ClientFrameView | undefined,
    inputMap,
    controlScheme: scheme,
    inputCaptureProfile: deriveInputCaptureProfile(inputMap, scheme),
    resolveInputIntent: (actions) => {
      const move = actions.analog.get(ARENA_MOVE_ACTION);
      const dir = move === undefined ? undefined : arenaMoveVectorToDirection(move.x, move.y);
      const shoot = actions.digital.get(ARENA_PRIMARY_ACTION)?.pressed ?? false;
      return {
        dir,
        shoot,
        reload: false,
        interact: false,
        drop: false,
        abilities: [],
      };
    },
  };
};

/**
 * Registry of built-in mode render providers. Capability ids are the only
 * runtime keys declared by `contributes.gameModes`; plugin ids remain metadata
 * for discovery and overlays and are never renderer aliases.
 * is the first registered mode (ADR-0023: BR is one discovered mode, not a
 * hardcoded `case`); the example arena is the second, proving the registry
 * extends to a new genre. Adding a genre = registering another provider here.
 */
interface BundledModeRenderRegistration {
  readonly pluginId: string;
  readonly capabilityId: GameModeCapabilityId;
  readonly provider: ModeRenderProvider;
}

const MODE_RENDER_REGISTRATIONS: readonly BundledModeRenderRegistration[] = [
  {
    pluginId: BATTLE_ROYALE_PLUGIN_ID,
    capabilityId: BATTLE_ROYALE_RENDERER_CAPABILITY_ID as GameModeCapabilityId,
    provider: createBattleRoyalePlaytestPlugin,
  },
  {
    pluginId: EXAMPLE_ARENA_PLUGIN_ID,
    capabilityId: EXAMPLE_ARENA_RENDERER_CAPABILITY_ID as GameModeCapabilityId,
    provider: createExampleArenaPlaytestPlugin,
  },
];

const MODE_RENDER_PROVIDERS: ReadonlyMap<GameModeCapabilityId, ModeRenderProvider> = new Map(
  MODE_RENDER_REGISTRATIONS.map((registration) => [
    registration.capabilityId,
    registration.provider,
  ]),
);

/** Plugin ids that have a bundled render provider (id-list discovery surface). */
export const KNOWN_PLAYTEST_MODE_IDS: readonly string[] = MODE_RENDER_REGISTRATIONS.map(
  ({ pluginId }) => pluginId,
);

export const resolvePlaytestPlugin = (
  rendererCapabilityId: GameModeCapabilityId | string | undefined,
  options: ResolvePlaytestPluginOptions = {},
): ResolvedPlaytestPlugin => {
  if (rendererCapabilityId === undefined) {
    throw new Error(
      'Active game mode does not declare capabilities.renderer; add a renderer capability to contributes.gameModes.',
    );
  }
  const provider = MODE_RENDER_PROVIDERS.get(rendererCapabilityId as GameModeCapabilityId);
  if (provider === undefined) {
    throw new Error(
      `No bundled playtest renderer is registered for capability ${rendererCapabilityId}. Check contributes.gameModes.capabilities.renderer.`,
    );
  }
  return provider(options);
};

const registerBundledAssets = (
  assets: readonly BundledAssetSpec[],
): readonly RegisteredBundledAsset[] => {
  const registry = createBundledAssetRegistry();
  for (const asset of assets) {
    registry.register(asset);
  }
  return registry.list();
};

const assertBundledAssetsPresent = (
  assets: readonly RegisteredBundledAsset[],
  requiredAssetIds: readonly string[],
  pluginId: string,
): void => {
  const registered = new Set(assets.map((asset) => String(asset.assetId)));
  const missing = requiredAssetIds.filter((assetId) => !registered.has(assetId));
  if (missing.length > 0) {
    throw new Error(
      `[playtest] ${pluginId} renderer is missing required bundled asset(s): ${missing.join(', ')}`,
    );
  }
};

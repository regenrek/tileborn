# ADR-0014: Runtime rendering via plugin-owned `RenderableEntityProjector`

- Status: Proposed
- Date: 2026-05-23
- Deciders: Tileborne core team
- Tags: runtime, rendering, networking, plugin-boundary, battle-royale

## Context

`@tileborne/runtime` already ships:

- A `PixiRendererAdapter` with ECS-keyed sprite pooling, tilemap rendering, and a follow-camera-capable `worldRoot` (`packages/runtime/src/renderer/pixi/pixi-renderer-adapter.ts` lines 160–190 are the canonical `renderFrame` path).
- A wire protocol for the battle-royale plugin (`packages/ipc-contracts/src/protocols/battle-royale.ts`) exposing `WelcomeSnapshot` (lines 47–52) and `DeltaSnapshot` (lines 54–59) with `players`/`playersUpdated` arrays, plus a `PlayerInput` (line 36) with a `shoot` field.
- A multiplayer playtest client (`apps/desktop/src/renderer/components/playtest-multiplayer-viewport.tsx`) that decodes snapshots but **paints players as DOM `<div>` dots** (lines 121–168) layered over the Pixi canvas (mount at lines 31–82). The single-player viewport (`apps/desktop/src/renderer/components/playtest-viewport.tsx` lines 91–141) is keyboard-only and shares no rendering code with multiplayer.

Two problems follow:

1. The multiplayer playtest does not look like a game. The Petwars private repo has textured pet sprites + follow camera + projectiles; the OSS Tileborne shell does not.
2. The DOM-dot overlay is the result of a shortcut that bypassed the renderer entirely. The renderer adapter and the wire protocol exist; nothing connects them.

The plugin boundary (ADR-0001, ADR-0006, ADR-0009) requires that the shell never reach into plugin internals and never reference `@tileborne/ipc-contracts/.../protocols/battle-royale` from the renderer tree. Any fix must respect that boundary.

The walkthrough blocker `.refs/v0.1.0-walkthrough/08-br-loop-dom.json` reports `Plugin @tileborne/plugin-battle-royale · startup failed · Invalid protocol frame`, which strongly suggests a residual legacy `RuntimeMessage` envelope (`packages/runtime/src/net/protocol.ts`) competing with `BattleRoyaleProtocol` on the multiplayer hot path.

## Decision

Introduce a tiny **plugin-side renderable contract** and rebuild the playtest rendering on top of it:

1. **`RenderableEntityProjector<Snapshot>`** — a new plugin-owned interface in `packages/runtime/src/plugin/renderable-entity.ts`. Plugins map their own snapshot type to a flat list of `RenderableEntity { id: string; assetId: RenderableAssetId; x: number; y: number; rotation?: number; scale?: number; ... }`. The shell only depends on this interface; it never names the plugin's snapshot type.
2. **`SnapshotEntityStore`** — a new networking helper in `packages/runtime/src/net/snapshot-entity-store.ts` that ingests opaque welcome+delta frames via `apply(frame: unknown)`, maintains `previous`/`current` snapshots typed as `unknown`, and exposes `getCurrentSnapshot()`/`getPreviousSnapshot()` for the projector to narrow. The old `packages/runtime/src/net/snapshot-state.ts` is marked `@deprecated`.
3. **`PixiRendererAdapter.renderFromEntities(entities, previousById, alpha)`** — a new render entry point that mirrors `renderFrame` but keys sprites by the projector-provided string `entity.id`. A parallel `spritePoolByStringId` keeps the existing ECS-keyed `spritePool` tests green during the transition.
4. **`BattleRoyaleProjector`** — a plugin-owned implementation in `packages/plugin-battle-royale/src/renderer/battle-royale-projector.ts`, exported from the package root as `createBattleRoyaleProjector()`. It also exposes `textureManifestForAtlas()` so the shell can preload textures without knowing which atlas the plugin uses.
5. **Tiny `playtest-plugin-bridge.ts`** in the shell that maps a plugin id string to its projector factory. This is the _only_ place in `apps/desktop/src/renderer/**` that names a plugin id.

The multiplayer and single-player playtest viewports are then rewritten on this trio: subscribe a `SnapshotEntityStore` to the client (multiplayer) or to a new `tileborne:runtime:snapshot` IPC event (single-player), run a `requestAnimationFrame` loop that calls `adapter.renderFromEntities(projector.project(store.getCurrentSnapshot()), store.previousById(), alpha)`, and install a follow camera that centers `worldRoot.position` on the local player at a fixed zoom.

Phase 1 polish adds a geckos-style `SnapshotInterpolator` (~100 ms fixed-window buffer), mouse aim + weapon hotkeys, a plugin-exported `RuntimePluginRenderManifest { fixedZoom; hudInsets }`, the legacy-envelope handshake audit, and tests.

## Consequences

### Positive

- One render path for single-player and multiplayer playtest; both go through `PixiRendererAdapter.renderFromEntities` (acceptance gate item 9).
- Plugin boundary is preserved and tightened: the shell never imports `@tileborne/ipc-contracts/.../protocols/battle-royale` after Phase 0 step 5, and never imports `@tileborne/plugin-battle-royale/src/...` deep paths.
- Unblocks Definition-of-Done items #1 (textured pets), #2 (no DOM dots), and #4 (projectile sprite shared across clients).
- The wire protocol stays plugin-owned; only the projector knows the schema.
- The runtime keeps a sprite pool keyed by stable string ids, which is the right shape for any future entity-streaming snapshot source.

### Negative

- A second sprite pool (`spritePoolByStringId`) lives alongside the existing ECS-keyed `spritePool` during the slice. We accept this until the ECS render path is itself rewritten on top of the projector, which is out of scope for this ADR.
- The wire protocol grows by one shape (`ProjectileSnapshot` + `ProjectileUpdate`) and `PlayerInput` gains two optional fields (`aimDeg`, `weaponSlot`). All optional, so existing clients keep working through Phase 0; Phase 1 enables them.
- A `playtest-plugin-bridge.ts` exists in the shell with a literal plugin id string. This is intentional — it is the smallest possible shell-side coupling and is enforced by a `@tileborne/boundary-tests` rule so it stays the only such reference.
- Phase 1 step 13 ("legacy envelope removal") may surface latent assumptions in `apps/game-host/src/rooms/room-object.ts` and `apps/game-host/src/worker.ts`. We timebox 1 day before falling back to a sniff-then-decode bridge.

## Plugin-boundary contract (invariants)

Enforced manually until Phase 1 step 14 ships a `@tileborne/boundary-tests` rule:

- `apps/desktop/src/renderer/**` never imports `@tileborne/plugin-battle-royale/src/...` deep paths. Only `@tileborne/plugin-battle-royale` top-level is allowed, and only the factory functions `createBattleRoyaleProjector` and (Phase 1) `getRenderManifest`.
- `apps/desktop/src/renderer/**` never imports `@tileborne/ipc-contracts/.../protocols/battle-royale` after Phase 0 step 5. `BattleRoyaleProtocol` types are referenced exclusively inside `@tileborne/plugin-battle-royale`.
- `apps/game-host` keeps plugin types only via the existing bundled-plugin loader at `apps/game-host/src/bundled-plugin-loader.ts`.
- The only place in `apps/desktop/src/renderer/**` that names a plugin id literal is `apps/desktop/src/renderer/lib/playtest-plugin-bridge.ts`.

## Phase 0 plan — vertical slice (~3 working days)

| #   | Title                                          | Effort | Files                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Plugin-side renderable contract                | S      | `packages/runtime/src/plugin/renderable-entity.ts` (new); export from `packages/runtime/src/plugin/index.ts` and re-export from `packages/runtime/src/index.ts`                                                                                                                                                                                                                           |
| 2   | `SnapshotEntityStore` with previous/current    | M      | `packages/runtime/src/net/snapshot-entity-store.ts` (new); mark `packages/runtime/src/net/snapshot-state.ts` `@deprecated` (do not delete in slice)                                                                                                                                                                                                                                       |
| 3   | `PixiRendererAdapter.renderFromEntities`       | M      | `packages/runtime/src/renderer/pixi/pixi-renderer-adapter.ts` lines 160–190 mirrored under new method; parallel `spritePoolByStringId`; reuses `texturesByRenderableAssetId`; no change to `mount`/`loadAssets`/`dispose`                                                                                                                                                                 |
| 4   | `BattleRoyaleProjector` in plugin              | S      | `packages/plugin-battle-royale/src/renderer/battle-royale-projector.ts` (new); export `createBattleRoyaleProjector()` + `textureManifestForAtlas()` from `packages/plugin-battle-royale/src/index.ts`                                                                                                                                                                                     |
| 5   | Rewire `PlaytestMultiplayerViewport`           | M      | `apps/desktop/src/renderer/components/playtest-multiplayer-viewport.tsx`: replace mount sequence (lines 31–82) and DOM-dot overlay (lines 121–168); subscribe `SnapshotEntityStore` to `PlaytestMultiplayerClient` welcome+delta; rAF loop; follow camera centers `worldRoot.position` on local player at fixed zoom `4`; delete `<div>` dots                                             |
| 6   | Tiny plugin bridge in shell                    | S      | `apps/desktop/src/renderer/lib/playtest-plugin-bridge.ts` (new); single-case switch `'@tileborne/plugin-battle-royale' → createBattleRoyaleProjector()`                                                                                                                                                                                                                                   |
| 7   | `ProjectileSnapshot` in wire protocol          | S      | `packages/ipc-contracts/src/protocols/battle-royale.ts`: add `ProjectileSnapshot`/`ProjectileUpdate`; extend `WelcomeSnapshot` (lines 47–52) with `projectiles`; extend `DeltaSnapshot` (lines 54–59) with `projectilesUpdated` + `projectilesRemoved`; update `packages/plugin-battle-royale/src/server/snapshot-emitter.ts` `captureSnapshot` lines 44–78 to walk projectile components |
| 8   | Shoot-key input wiring                         | S      | `apps/desktop/src/renderer/components/playtest-multiplayer-viewport.tsx` `syncInput` lines 90–92: track `Space` (or left mouse) and set `shoot: true` on existing `PlayerInput`                                                                                                                                                                                                           |
| 9   | Single-player viewport unification + IPC event | M      | `apps/desktop/src/renderer/components/playtest-viewport.tsx` lines 91–141: drive same `SnapshotEntityStore` from a new `tileborne:runtime:snapshot` event channel carrying `{ sessionId: string; frame: Uint8Array }` added to `packages/ipc-contracts/src/codegen-shape.ts` `tileborne:runtime` events domain (line 126)                                                                 |

**Slice acceptance gate:** host + join shows 2 textured pets on procgen map, follow camera, Space spawns a projectile sprite visible to both clients, no DOM dots remain over canvas, `pnpm -w vitest --run` green.

## Phase 1 plan — polish + finish 1–2 week scope (~5–7 more days)

| #   | Title                                        | Effort | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | `SnapshotInterpolator`                       | M      | `packages/runtime/src/net/snapshot-interpolator.ts` (new) — ~100 ms fixed-window buffer modeled on geckosio/snapshot-interpolation `src/snapshot-interpolation.ts` + `src/vault.ts`; `SnapshotEntityStore` consults it to expose interpolated current snapshot                                                                                                                                                                                                                                                      |
| 11  | Mouse aim + weapon hotkeys                   | M      | `apps/desktop/src/renderer/lib/playtest-input.ts`: add mouse→world conversion (reference `EditorViewportController.setCamera` math lines 173–177 and `tileCoordsFromPointer` lines 542–559); extend `BattleRoyaleProtocol.PlayerInput` (line 36) with optional `aimDeg: Schema.OptionFromOptional(Schema.Int)` and `weaponSlot: Schema.OptionFromOptional(Schema.Int)`; extend `RuntimePlayerInput` in `packages/plugin-battle-royale/src/types/runtime-plugin.ts` lines 25–30                                      |
| 12  | `RuntimePluginRenderManifest`                | S      | Plugin exports `getRenderManifest(): { fixedZoom: number; hudInsets: { top; right; bottom; left } }`; shell honors it in viewport resize handler                                                                                                                                                                                                                                                                                                                                                                    |
| 13  | WS handshake audit / legacy envelope removal | S–M    | Resolve `08-br-loop-dom.json` "Invalid protocol frame". Audit `packages/runtime/src/net/protocol.ts`, `apps/game-host/src/worker.ts`, `apps/game-host/src/rooms/room-object.ts`. Drop legacy `RuntimeMessage` from multiplayer hot path; host forwards only bytes from `BattleRoyaleProtocol.encodeServerMessage`. Timebox 1 day before sniff-then-decode fallback                                                                                                                                                  |
| 14  | Tests                                        | M      | Unit: `packages/runtime/src/net/snapshot-entity-store.test.ts`, `packages/plugin-battle-royale/src/renderer/battle-royale-projector.test.ts`, extend `packages/runtime/src/renderer/renderer.test.ts` with headless `renderFromEntities` smoke. E2E: extend Electron e2e from `.refs/v0.1.0-walkthrough/08-br-loop-dom.json` asserting `playtest-multiplayer-canvas` has ≥2 sprites and zero `playtest-multiplayer-player-*` DOM dots. Add `@tileborne/boundary-tests` rule enforcing the boundary invariants above |

## IPC contract changes

All schema changes live in `packages/ipc-contracts/src/protocols/battle-royale.ts` unless noted.

- **New** `ProjectileSnapshot` — `{ id: ProjectileId; ownerPlayerId: PlayerId; weaponSlot: int; x: number; y: number; vx: number; vy: number; rotation: number; ttlMs: int }`.
- **New** `ProjectileUpdate` — delta variant with `id` and partial-position fields.
- **Extended** `WelcomeSnapshot` (lines 47–52) — adds `projectiles: Schema.Array(ProjectileSnapshot)`.
- **Extended** `DeltaSnapshot` (lines 54–59) — adds `projectilesUpdated: Schema.Array(ProjectileUpdate)` and `projectilesRemoved: Schema.Array(ProjectileId)`.
- **Extended** `PlayerInput` (line 36, Phase 1) — adds optional `aimDeg: Schema.OptionFromOptional(Schema.Int)` and `weaponSlot: Schema.OptionFromOptional(Schema.Int)`. `RuntimePlayerInput` in `packages/plugin-battle-royale/src/types/runtime-plugin.ts` lines 25–30 mirrors the additions.
- **New** event channel — `tileborne:runtime:snapshot` in `packages/ipc-contracts/src/codegen-shape.ts` `tileborne:runtime` events domain (line 126), payload `{ sessionId: string; frame: Uint8Array }`. Used by the single-player viewport to receive snapshots from the runtime worker.

## Definition of done (parent task gate)

1. Host + join shows 2 textured pets moving on procgen BR map.
2. `document.querySelectorAll('[data-testid^="playtest-multiplayer-player-"]').length === 0` in the Electron renderer during a playtest.
3. Viewport camera follows local player at fixed zoom in both windows.
4. `Space` spawns a projectile sprite visible to both clients.
5. No `PlaytestHudOverlay` regressions.
6. Electron e2e walkthrough step `08-br-loop` passes; `.refs/v0.1.0-walkthrough/08-br-loop-dom.json` no longer reports "Invalid protocol frame".
7. `pnpm -w vitest --run` green; new tests pass.
8. Zero new shell imports of `@tileborne/ipc-contracts/.../protocols/battle-royale` or `@tileborne/plugin-battle-royale/src/...`.
9. Single-player playtest renders via the same `renderFromEntities` code path as multiplayer.

All nine items must hold before the parent plandb task is marked done.

## Risks

1. **Sprite pool divergence.** Running two pools (`spritePool` ECS-keyed, `spritePoolByStringId` projector-keyed) during the slice creates two leak surfaces. Mitigation: shared `dispose` walks both maps; renderer test extends to both.
2. **Snapshot churn under interpolation.** The geckos-style 100 ms buffer assumes monotonically growing server timestamps; reconnects can break that. Mitigation: `SnapshotEntityStore.reset()` on welcome frame; `SnapshotInterpolator` clears its vault.
3. **Legacy `RuntimeMessage` envelope mismatch.** Phase 1 step 13 may surface deeper assumptions in `apps/game-host`. Mitigation: timebox 1 day before falling back to sniff-then-decode, which keeps the slice unblocked.
4. **Projector / wire protocol coupling.** A future plugin that ships its own wire types must implement its own projector; if we accidentally leak `BattleRoyaleProtocol` shapes into `RenderableEntity` defaults, the contract erodes. Mitigation: `boundary-tests` rule + ADR invariant section.
5. **Plugin bridge becomes a registry.** The single-case switch in `playtest-plugin-bridge.ts` is at risk of growing into a discovery layer that pulls plugin packages into the shell bundle. Mitigation: keep the bridge as a literal map and add the second entry only when the second plugin actually exists; reconsider the shape (lazy import + plugin id list) when the count would otherwise reach three.

## Reference repos (per-file study list)

Existing manifest: `~/Library/Caches/search-context/runs/tileborn-runtime-rendering-2026-05-23/reference-context.md`. Do **not** copy code wholesale from any of these — read for shape and idioms only.

- **`halftheopposite/TOSIOS` (MIT)** — top-down Pixi battle-royale analog. Study:
  - `packages/client/src/scenes/GameScene.ts` for the rAF render loop + interpolation hook-in point.
  - `packages/client/src/entities/Player.ts` for the rotation+sprite-anchor convention.
  - `packages/common/src/types/Message.ts` for the welcome/delta envelope shape (compare to our `BattleRoyaleProtocol`).
  - **Do not copy** Colyseus state binding — we own our delta loop.
- **`endel/colyseus-pixijs-boilerplate` (MIT)** — minimal Pixi v8 + snapshot lerp blueprint. Study:
  - `src/Application.ts` for the smallest-possible Pixi v8 mount + resize loop.
  - `src/scenes/GameScene.ts` for `linearInterpolation(prev, curr, alpha)` and the `worldRoot.position` follow-camera math.
  - **Do not copy** Colyseus client wiring.
- **`geckosio/snapshot-interpolation` (BSD-3)** — canonical interpolation algorithm. Study:
  - `src/snapshot-interpolation.ts` for the `calcInterpolation` time-shift logic.
  - `src/vault.ts` for the ring-buffer behavior we want in `SnapshotInterpolator`.
  - **Do not copy** the package wholesale — port the two functions we need to keep zero runtime deps.
- **`colyseus/schema` (MIT)** — delta encoding + ChangeTree pattern. Study:
  - `src/changes/ChangeTree.ts` for the additions/changes/removals tri-set we already mirror in `DeltaSnapshot` (`playersUpdated` / `playersRemoved` + new projectile equivalents).
  - **Do not adopt** the full Schema decorator system; our Effect Schema is the SSOT (ADR-0002).
- **`deepnight/ldtk` (MIT)** — UX reference for future editor inspector/palette (Phase 2+; out of scope here). Study only if Phase 2 picks up the property inspector — not part of this slice.

## Out of scope

These are explicitly **not** in this ADR's workstream and should not be conflated with the slice:

- Procgen overhaul (current procgen BR map is good enough for the slice).
- Combat depth (damage curves, health bars beyond a placeholder, status effects).
- Skin catalog and asset pipeline for pet variants.
- Full HUD (the existing `PlaytestHudOverlay` keeps current shape; we only verify no regression).
- Editor object/property inspector (`deepnight/ldtk`-style); deferred to Phase 2+.

## Smallest 3-day vertical slice (day-by-day)

Aimed at a single engineer working sequentially; can compress with two engineers since P0.2/P0.3/P0.4 are parallelizable behind P0.1.

**Day 1 — contracts and plumbing.**

- Morning: P0.1 `RenderableEntity` + `RenderableEntityProjector` interface (S).
- Afternoon: P0.2 `SnapshotEntityStore` with previous/current (M); deprecate `snapshot-state.ts`.
- Late: P0.7 wire-protocol `ProjectileSnapshot` + server `snapshot-emitter.ts` update (S).

**Day 2 — renderer + plugin projector.**

- Morning: P0.3 `PixiRendererAdapter.renderFromEntities` + parallel `spritePoolByStringId` (M).
- Afternoon: P0.4 `BattleRoyaleProjector` mapping players (and projectiles) to `RenderableEntity` (S).
- Late: P0.6 `playtest-plugin-bridge.ts` (S).

**Day 3 — shell rewire + single-player unification.**

- Morning: P0.5 rewire `PlaytestMultiplayerViewport`, kill DOM dots, install follow camera (M).
- Midday: P0.8 shoot-key input wiring (S).
- Afternoon: P0.9 single-player viewport on the same store via `tileborne:runtime:snapshot` IPC event (M).
- Late: smoke-test the acceptance gate; open Phase 1 tasks for interpolation, mouse aim, manifest, handshake audit, tests.

## Implementation notes

These notes were added as the Phase 0 frontend slice (P0.5/P0.6/P0.8/P0.9) landed and should be folded into a future revision of the ADR rather than treated as a Decision change.

- **`tileborne:runtime:snapshot` payload schema.** Lives in `packages/ipc-contracts/src/events.ts` (not `codegen-shape.ts`, which only defines the prefix and bridge type plumbing). Payload uses a local `Schema.declare<Uint8Array>` because `Schema.instanceOf(Uint8Array)` narrows to `Uint8Array<ArrayBuffer>` and rejects the `ArrayBufferLike`-parameterised Uint8Array returned by `BattleRoyaleProtocol.encodeServerMessage` under strict TS settings.
- **Plugin bridge surface.** `apps/desktop/src/renderer/lib/playtest-plugin-bridge.ts` returns `{ projector, textureManifest, decodeServerFrame }`. The third field (a `(bytes: Uint8Array) => unknown` decoder) was not in the ADR's listed shape but is required so the single-player viewport can convert IPC snapshot bytes into the opaque snapshot value the projector consumes. It is plugin-specific code that belongs next to the plugin-id literal; alternative would be to add `decodeServerFrame` to the plugin's public exports (Phase 1 cleanup).
- **Follow-camera transform.** `PixiRendererAdapter` does not currently expose a `worldRoot` accessor and `renderFromEntities` attaches sprites directly to the stage. The Phase 0 viewports therefore apply the camera transform by pre-multiplying entity coordinates (`(e.x - cameraX) * zoom + cx`) before calling `renderFromEntities`, and additionally call `EditorViewportController.setCamera` so the tilemap on `worldRoot` stays aligned. Phase 1 should expose a single `worldRoot` (or render-target Container) on the adapter so both code paths share one transform.
- **Plugin-bundled placeholder textures.** Two 24×24/6×6 PNGs are embedded as base64 in `apps/desktop/src/renderer/lib/bundled-projector-textures.ts` and loaded via a `RuntimeAssetManifest` constructed with `disableChecks: true` (the renderer adapter keys its texture cache by the raw `asset.id` string, which intentionally bypasses the `asset:<uuid>` brand regex for these synthetic ids). When a real asset pipeline lands for plugin sprites, replace the inline base64 with disk-resident assets and drop the `disableChecks` workaround.
- **Boundary residue.** Five renderer files still name `BattleRoyaleProtocol` (multiplayer client, plugin bridge decoder, `playtest-input.ts` Direction8 type, multiplayer store welcome state, ambient `tileborne.d.ts`). Phase 1 task `t-p0-boundary-cleanup` removes them by moving wire decoding into the plugin package or preload.
- **Backend export added during the slice.** `packages/plugin-battle-royale/package.json` `exports."."` gained `"types": "./src/index.ts"` so the renderer can type-import from the top-level package. This is packaging metadata, not a public-API change.

## References

- `docs/01-spec.md` §11 (Pixi viewport architecture), §13 (runtime SDK).
- `docs/03-runtime-game-host.md` §3–§4 (React/Pixi/ECS boundaries).
- Related: [ADR-0001](./0001-plugin-ui-model-declarative-first.md), [ADR-0002](./0002-ipc-schema-ssot-effect-schema.md), [ADR-0006](./0006-runtime-renderer-abstraction-pixi-default.md), [ADR-0009](./0009-three-repo-split-private-petwars-boundary.md).
- Walkthrough blocker: `.refs/v0.1.0-walkthrough/08-br-loop-dom.json`.
- Reference manifest: `~/Library/Caches/search-context/runs/tileborn-runtime-rendering-2026-05-23/reference-context.md`.

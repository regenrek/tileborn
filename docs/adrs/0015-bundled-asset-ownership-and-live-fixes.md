# ADR-0015: Bundled asset ownership and live-test fixes

- Status: Proposed
- Date: 2026-05-23
- Deciders: Tileborne core team
- Tags: runtime, assets, plugin-boundary, live-test, battle-royale

## Context

ADR-0014's live verification is RED: DoD 1/9. The live-test report under `.refs/v0.1.0-live-test/` surfaced four findings already filed as orphan PlanDB tasks under `p-mjnv tileborn`:

- **F1 [BLOCKER] `t-v8y1`** - `apps/desktop/src/renderer/lib/bundled-projector-textures.ts` constructs `new AssetPackManifestAsset(...)` with `id: "tileborne:bundled-pets/default"` and `{ disableChecks: true }`. Effect `4.0.0-beta.70` still applies the field-level `AssetId` brand/pattern filter and throws `Expected ^asset:<uuid>$ got "tileborne:bundled-pets/default"`. Both playtest viewports crash on mount, blocking DoD #1/#3/#4/#5/#9 and masking #6.
- **F2 [HIGH] `t-c857`** - The generate-map dialog no longer auto-closes after successful generation. The map appears in the sidebar, but Close/Escape do not dismiss the dialog, blocking deterministic walkthrough step 04.
- **F3 [MEDIUM] `t-13dq`** - `.refs/v0.1.0-walkthrough/08-br-loop-dom.json` still reports "Invalid protocol frame", but cannot be re-verified until F1 and F2 allow a run to reach the BR handshake.
- **F4 [LOW] `t-ne6z`** - Cmd+K did not open the command palette via CDP keyboard input on `/settings`. This may be a CDP input-dispatch artifact and needs manual repro before code changes.

This is a new ADR rather than an addendum to ADR-0014 because F1 exposes an ownership question ADR-0014 did not answer: placeholder/built-in textures are currently plugin-scoped runtime assets, but the shell constructs them through the brand-strict asset-pack schema for user-imported assets.

The failure site is the renderer-local workaround:

```58:70:apps/desktop/src/renderer/lib/bundled-projector-textures.ts
const assets = specs.map(
  (spec, index) =>
    new AssetPackManifestAsset(
      {
        id: spec.assetId as unknown as AssetId,
        path: dataUrl(spec.base64),
        mime: 'image/png',
        size: spec.base64.length,
        hash: placeholderHash,
        license: Option.none(),
      },
      { disableChecks: true },
```

The schema it flows through is intentionally UUID-branded:

```49:52:packages/core/src/ids.ts
/** Branded asset identifier (`asset:<uuid>`). */
export const AssetId = asset.schema;
export type AssetId = typeof AssetId.Type;
export const makeAssetId = asset.make;
```

```6:15:packages/asset-pipeline/src/pack/pack-manifest.ts
export class AssetPackManifestAsset extends Schema.Class<AssetPackManifestAsset>(
  "AssetPackManifestAsset",
)({
  id: AssetId,
  path: Schema.String,
  mime: Schema.String,
  size: Schema.Number,
  hash: ContentHash,
  license: Schema.OptionFromUndefinedOr(License),
}) {}
```

The runtime loader consumes the manifest as bytes plus cache keys after construction. Its current public type is still `AssetPackManifest`, but its renderer-facing texture cache already keys by the raw `asset.id` string as well as numeric indexes:

```115:129:packages/runtime/src/renderer/pixi/pixi-renderer-adapter.ts
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
```

The plugin already owns the renderable asset IDs, but the type aliases still force those IDs through `AssetId`:

```1:8:packages/runtime/src/plugin/renderable-entity.ts
import type { AssetId } from "@tileborne/core";

export type RenderableAssetId = AssetId;

export interface RenderableEntity {
  readonly id: string;
  readonly assetId: RenderableAssetId;
```

```103:118:packages/plugin-battle-royale/src/renderer/battle-royale-projector.ts
export const PLAYER_TEXTURE_ASSET_ID = "tileborne:bundled-pets/default";
export const PROJECTILE_TEXTURE_ASSET_ID = "tileborne:bundled-fx/projectile-bolt";

const playerRenderableAssetId = PLAYER_TEXTURE_ASSET_ID as RenderableAssetId;
const projectileRenderableAssetId = PROJECTILE_TEXTURE_ASSET_ID as RenderableAssetId;

const textureManifest = [
  {
    assetId: PLAYER_TEXTURE_ASSET_ID,
    path: "assets/bundled-pets/default.png",
  },
  {
    assetId: PROJECTILE_TEXTURE_ASSET_ID,
    path: "assets/bundled-fx/projectile-bolt.png",
  },
```

For F2, the current success path already calls `onOpenChange(false)`, so the fix task must verify whether `usePendingDialogClose(generateMap.isPending, onOpenChange)` is keeping the dialog pinned during mutation settlement or whether navigation/order changed:

```91:105:apps/desktop/src/renderer/components/generate-map-dialog.tsx
try {
  const result = await generateMap.mutateAsync({
    projectId: projectId as ProjectId,
    width: Number(width),
    height: Number(height),
    seed: Number(seed),
    preset,
    tilesetPackId: resolvedTilesetPackId as PackId,
  });
  notifySuccess(`Generated map ${result.map.id}`);
  onOpenChange(false);
  await navigate({
    to: '/projects/$projectId/maps/$mapId',
    params: { projectId, mapId: result.map.id },
  });
```

For F4, Cmd+K is a window-level `keydown` listener, so a CDP-only failure is plausible if CDP dispatch did not synthesize the same `metaKey` event observed by a human:

```29:37:apps/desktop/src/renderer/router.tsx
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setCommandPaletteOpen(true);
    }
  };
  window.addEventListener('keydown', onKeyDown);
```

Internal reference apps are useful for gap analysis, not as architecture templates. The bundled player model path should therefore normalize string IDs, atlas metadata, and texture keys behind Tileborne-owned manifests before renderer code sees them.

## Decision

The canonical owner for plugin-bundled placeholder/built-in textures, and any future plugin-bundled assets, is the plugin itself.

`@tileborne/runtime` exposes a `registerBundledAsset(spec: BundledAssetSpec): RegisteredAsset` entry path (or equivalent) that does **not** flow through `AssetPackManifestAsset`. `BundledAssetSpec` uses a separate ID type such as `BundledAssetId`, with a namespace like `plugin:<plugin-id>/<asset-key>`, validated by namespace and syntax rather than by the `asset:<uuid>` brand.

For F1's first fix, the smallest patch stays in `apps/desktop/src/renderer/lib/bundled-projector-textures.ts`: replace `new AssetPackManifestAsset(...)` with a plain object literal cast to `AssetPackManifestAsset` (for example, `as unknown as AssetPackManifestAsset`) and keep `AssetPackManifest` construction unchanged. This is Option 1 from the live-test report: no new types, no schema change, no runtime API change. The full canonical migration is a follow-up under this ADR's parent PlanDB task, not a v0.1 blocker.

For F2, the fix belongs in the generate-map dialog success flow. The intended behavior is `setOpen(false)`/`onOpenChange(false)` after successful generation and before the deterministic walkthrough proceeds. The implementation task must account for the current `usePendingDialogClose` wrapper because the file already calls `onOpenChange(false)`.

For F3, no architectural decision is needed. Re-run the BR handshake walkthrough only after F1-immediate and F2 land.

For F4, do manual repro first. This ADR does not specify a fix unless Cmd+K fails outside CDP as well.

Do **not** loosen the `AssetId` regex. `AssetId` remains brand-strict for user-imported asset-pack entries, durable manifests, pack deltas, pack indexes, and pipeline validation.

## Consequences

### Positive

- Plugins own the built-in assets their renderable surfaces emit, strengthening ADR-0014's plugin-boundary contract.
- `AssetId` stays brand-strict for user-imported asset packs and pipeline-managed durable data.
- The runtime becomes the contract owner for turning plugin-bundled asset specs into renderer-loadable assets.
- The renderer stops being the long-term place where BR placeholder art and asset-pack schema bypasses accumulate.

### Negative

- One new runtime type pair (`BundledAssetId` / `BundledAssetSpec`) and one new runtime API (`registerBundledAsset`) must be maintained.
- A small adapter is needed to bridge bundled assets into Pixi's texture cache.
- The F1-immediate cast bypasses validation locally; it is acceptable only as a short-lived blocker fix and must be removed by F1-canonical.

## Architecture-ownership analysis

- **Runtime owner**: `apps/desktop/src/renderer/lib/bundled-projector-textures.ts` and the renderer mount path are where the crash currently happens. Architecture Ownership rule cited: Decision Order #2 says to name the layer where the wrong behavior currently happens; this is the UI layer because the crash occurs while the renderer constructs placeholder texture manifests for the playtest viewport.
- **First fix owner**: `apps/desktop/src/renderer/lib/bundled-projector-textures.ts` owns the smallest correct patch: construct the manifest asset as a plain object literal cast instead of invoking `Schema.Class`. Architecture Ownership rule cited: Decision Order #3 and Common Judgments say the first fix owner can be the current layer when that is the minimal patch to stop the product doing the wrong thing; this avoids broad schema/runtime churn while the live test is blocked.
- **Canonical long-term owner**: `packages/plugin-battle-royale/` owns the BR bundled placeholder textures, with `packages/runtime/src/assets/` owning the `BundledAssetId` / `BundledAssetSpec` / `registerBundledAsset` contract used to register them. Architecture Ownership rules cited: Decision Order #4 says reusable product behavior should move out of runtime orchestration when it is policy; Layer Map says adapter/integration layers own concrete provider behavior, while shared core owns pure validation; here the plugin owns plugin-specific assets and runtime owns the narrow registration contract.
- **Competing owners that are wrong**: `apps/desktop/src/renderer/lib/` is wrong long-term because UI should not own plugin asset policy; `apps/desktop/src/main/` is wrong because Electron main owns platform shell concerns, not plugin render assets; `packages/asset-pipeline/` is wrong because its `AssetId` schema is for durable imported packs; `packages/core/` is wrong because the IDs are not cross-domain core identities; `packages/runtime/src/assets/` is wrong as sole owner because runtime should expose the registration path but not decide BR's asset catalog. Architecture Ownership rules cited: Hard-Cut Rules prohibit leaving reusable policy in orchestration code, putting platform shell concerns in domain/application layers, and putting pure validation/normalization in orchestration when it belongs in shared core or a narrow domain module.
- **Cleanup direction**: after F1-immediate, introduce `BundledAssetId`, `BundledAssetSpec`, and `registerBundledAsset` in `packages/runtime/src/assets/`; export them from `@tileborne/runtime`; add `createBattleRoyaleBundledAssets()` in `@tileborne/plugin-battle-royale`; migrate `bundled-projector-textures.ts` so the renderer consumes registered assets instead of constructing asset-pipeline types; add a boundary test forbidding `AssetPackManifestAsset`, `AssetPackManifest`, and `AssetId` imports in `apps/desktop/src/renderer/**`. Architecture Ownership rules cited: Decision Order #5 says to remove duplicate policy/fallback/dual paths once the canonical owner is clear.

## Plan - F1 (BLOCKER)

### F1-immediate (1 hour)

Replace `new AssetPackManifestAsset(...)` in `apps/desktop/src/renderer/lib/bundled-projector-textures.ts` with a plain object literal cast to `AssetPackManifestAsset`. Keep the existing `AssetPackManifest` wrapper and existing texture bytes.

Verification:

- Both playtest viewports mount in `dev:cdp`.
- The teal pet silhouette renders.
- The walkthrough reaches and re-shoots step `08-br-loop`.
- No new types, schema changes, runtime API changes, or asset-pipeline changes.

### F1-canonical (1-2 days)

Introduce `BundledAssetId`, `BundledAssetSpec`, and `registerBundledAsset` in `packages/runtime/src/assets/`, and export them from `@tileborne/runtime`.

Expose a plugin-side factory such as `createBattleRoyaleBundledAssets()` from `@tileborne/plugin-battle-royale`, so the renderer no longer constructs asset specs or imports asset-pipeline manifest classes for plugin-bundled textures.

Verification:

- Viewport renders sprites end-to-end through the new bundled-asset registration path.
- `apps/desktop/src/renderer/**` no longer imports `AssetPackManifestAsset`, `AssetPackManifest`, or `AssetId` from `@tileborne/asset-pipeline` / `@tileborne/core` for projector textures.
- Add a boundary test analogous to the BR protocol boundary that forbids those imports in the renderer tree.
- User-imported asset-pack import tests still pass without loosening `AssetId`.

## Plan - F2 (HIGH)

Apply a tiny fix in `apps/desktop/src/renderer/components/generate-map-dialog.tsx` so successful generation closes the dialog reliably. The task should verify whether the existing `onOpenChange(false)` is blocked by `usePendingDialogClose` while the mutation is still pending, then move or duplicate the close call as the smallest correct patch.

Verification:

- Walkthrough step 04 closes after generation.
- Sidebar list includes the new map.
- Close and Escape dismiss the dialog when it is not pending.
- Deterministic walkthrough reaches step 09.

## Plan - F3 (MEDIUM)

Depends on F1-immediate and F2.

After those land, run:

```bash
TILEBORNE_CDP_URL=http://127.0.0.1:9323 node scripts/live-cdp-walkthrough.mjs
```

Regenerate `.refs/v0.1.0-walkthrough/08-br-loop-dom.json`, assert it contains no "Invalid protocol frame" string, and produce a green `.refs/v0.1.0-walkthrough/08-br-loop.png`. Delete `.refs/v0.1.0-walkthrough/08-br-loop-FAIL.png` only if the step is green.

## Plan - F4 (LOW)

Ask the user to manually test Cmd+K on `/settings`.

- If Cmd+K opens the palette manually, close F4 as a CDP input-dispatch artifact.
- If Cmd+K fails manually, create a follow-up fix task under this parent and investigate the global `keydown` listener / focus target path.

## Definition of done

1. Multiplayer playtest host+join shows 2 textured pets, verified live via `dev:cdp`.
2. Follow camera centers the local player, verified live.
3. Space spawns a yellow projectile sprite in both windows, verified live.
4. HUD overlay renders without regressions and `data-hud-inset-*` attributes are present, verified live.
5. `node scripts/live-cdp-walkthrough.mjs` exits 0 end-to-end for steps 01-10; `.refs/v0.1.0-walkthrough/08-br-loop-dom.json` is regenerated with no "Invalid protocol frame" string.
6. After F1-canonical lands, `apps/desktop/src/renderer/**` contains zero imports of `AssetPackManifestAsset`, `AssetPackManifest`, or `AssetId` for projector texture loading.

## Risks

- Brand-strict `AssetId` users in asset-pack import, pack indexes, pack deltas, and pipeline validation must keep working unchanged.
- Loosening `AssetId` would conflate durable imported assets with plugin-bundled runtime assets; this ADR forbids that.
- F1-immediate's cast can bypass legitimate future validation if it lingers. F1-canonical is the cleanup and must remove the workaround.
- The canonical migration is additive. Existing asset-pack manifests remain unchanged.

## References

- ADR-0014: `docs/adrs/0014-runtime-rendering-via-plugin-projector.md`.
- Walkthrough script: `scripts/live-cdp-walkthrough.mjs`.
- Live-test artifacts directory: `.refs/v0.1.0-live-test/`.
- Failing walkthrough artifact: `.refs/v0.1.0-walkthrough/08-br-loop-dom.json`.
- Petwars bundled-pet convention: `/Users/kregenrek/projects/games/petwars/app/public/assets/player-models/*/pet.json` plus `/Users/kregenrek/projects/games/petwars/app/src/shared/skins/builtin-models.ts`.
- Required search-context manifests:
  - `~/Library/Caches/search-context/runs/2026-05-23T21-00-10Z/reference-context.md`
  - `~/Library/Caches/search-context/runs/2026-05-23T21-00-14Z/reference-context.md`
  - `~/Library/Caches/search-context/runs/2026-05-23T21-00-20Z/reference-context.md`
- Focused search-context manifest for this ADR: `~/Library/Caches/search-context/runs/2026-05-23T21-00-33Z/reference-context.md`.

Search-context cloned five unique repositories total. The results were mostly weak matches and are recorded for negative guidance:

- **`kubernetes/sample-apiserver`** - Apache-2.0, pushed 2026-05-23. Study `pkg/apiserver/apiserver.go` for explicit API group registration, `pkg/registry/wardle/flunder/etcd.go` for registry ownership boundaries, and `pkg/generated/applyconfiguration/utils.go` for typed generated shapes. Do not copy: Go/Kubernetes server architecture or etcd registry patterns.
- **`aio-libs/aiohttp-demos`** - Apache-2.0, pushed 2026-05-23. Study `demos/polls/aiohttpdemo_polls/main.py` for small demo boot composition, `demos/blog/tests/conftest.py` for fixture setup, and `demos/graphql-demo/ui/src/App.js` only as an example of demo wiring. Do not copy: Python/aiohttp app structure or bundled generated JS.
- **`jvidalv/vital`** - MIT, pushed 2026-03-30. Study `src/app/app.tsx` for Vite/React starter composition, `src/components/atoms/logos/vite.tsx` for tiny inline asset components, and `AGENTS.md` for placeholder warnings. Do not copy: starter template architecture or unrelated Tailwind conventions.
- **`livekit/components-js`** - Apache-2.0, pushed 2026-05-21. Study `packages/react/CHANGELOG.md` for placeholder lifecycle naming, `tooling/api-documenter/src/documenters/YamlDocumenter.ts` for generated reference separation, and `packages/shadcn/components/agents-ui/agent-track-control.tsx` for component-bound asset ownership. Do not copy: LiveKit track/media model or shadcn package structure.
- **`digital-go-jp/design-system-example-components-react`** - MIT, pushed 2026-02-26. Study `src/components/NotificationBanner/parts/Icon.tsx`, `src/components/ChipLabel/ChipLabel.tsx`, and `src/components/Calendar/Calendar.stories.tsx` for local component asset encapsulation. Do not copy: design-system tokens, accessibility copy, or unrelated SVG assets.

Petwars patterns worth porting:

- Keep bundled assets as explicit product/plugin-local manifest entries with stable string IDs and URL/path fields.
- Convert those entries into runtime texture keys at load time.

Petwars anti-patterns to avoid:

- No global registry discipline for IDs.
- Runtime/user/built-in skin paths mixed by loose string conventions.
- No strict boundary between bundled assets and user-uploaded assets.

## Out of scope

- Real non-placeholder art assets.
- User-supplied pet or weapon uploads.
- Private Petwars product-layer skin catalog behavior from ADR-0014.
- Any F4 fix until manual repro confirms the bug outside CDP.

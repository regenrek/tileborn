# ADR-0021: Pack capability contract & paintable-pack semantics

- Status: Proposed
- Date: 2026-05-24
- Deciders: Tileborne core team
- Tags: assets, tileset, pack, manifest, ipc, editor-ux, generate-map, brush, palette, sdk-tileset, services-app
- Supersedes: none
- Superseded by: none
- Relates to: ADR-0005 (asset import trust/license), ADR-0008 (schema versioning), ADR-0013 (core summary schemas), ADR-0016 (ERW Ancient rules), ADR-0020 (Tiled interop scope)

## Context

Tileborne accepts two structurally different things via the same "Import asset pack" surface:

1. **Asset-only packs** — a folder with `tileborne-asset-pack.json` containing only `{ id, name, version, license, assets[] }`. Used today for the raw ERW Ancient Ruins source bundle (`~/projects/games/ERW-Ancient Ruins/`), which is just a sprite/atlas dump with PNG paths and licenses but no tile geometry.
2. **Tileset packs** — the same `tileborne-asset-pack.json` filename, but with the extended manifest (`schemaVersion`, `tilesets[]`, `tiles[]`, `autotileRules`, `terrainClasses`, `terrainTransitions`, `animations`, `collisionMasks`, `variantFilters`). The bundled `packages/test-fixtures/fixtures/asset-packs/ancient/` is one of these (33 tilesets, ~29k tiles).

The two flavors are visually indistinguishable in `assets.listPacks` because the IPC `AssetPack` summary returns only `{ id, name, version, license, integrityHash, assetCount }`. The renderer cannot tell which packs are paintable without re-parsing the manifest. This caused several silent failures in the editor:

- **Sidebar tileset palette** picked `installedPacks[0]?.id` as the default pack. If pack 0 was an asset-only stub, `loadTilesetPack` rejected on `parseTilesetManifest`, the palette stayed in skeleton state forever, and the brush did nothing.
- **Generate Map** dialog showed every installed pack in its tileset `<Select>`. Selecting an asset-only pack ran the generator successfully but produced an empty/incoherent map (no tiles to choose from).
- **"Set as active palette"** in the Asset Library could pin an asset-only pack as `activePalettePackId`, breaking any future map view.
- **Multiple imports of the same logical pack** (different versions/source paths) clutter the UI with duplicate entries — three "ERW Ancient Ruins" rows is a real on-disk state we observed live.

Live diagnosis (CDP) on 2026-05-24 confirmed three "ERW Ancient Ruins" packs installed simultaneously, two with `tilesetCount: 0` and one with `tilesetCount: 33, tileCount: 29209`. The two stubs come from importing the raw third-party source folder; the real one comes from the bundled fixture. Without a capability contract there's no way for the editor to default sanely.

ADR-0020 (Tiled interop) lands a fourth flavor — Tileborne packs **derived from a Tiled tileset** — which sit in the same listing and need the same disambiguation.

## Decision

Introduce an explicit, durable **pack capability contract** that the editor, generators, and runtime all consume, and define **paintable** as a precise, testable property of a pack manifest.

This contract belongs in Tileborne's OSS surface because it is neutral editor/runtime/plugin infrastructure. `packages/plugin-battle-royale` consumes pack capability for Battle Royale plugin behavior when needed, but does not own the neutral detection rules. `/Users/kregenrek/projects/games/petwars-product` owns only private product branding, assets, maps, deploy targets, and config that consume Tileborne packages and the Battle Royale plugin.

### Capability shape

The contract lives in `@tileborne/core` (durable schema, branded IDs) so that IPC, services, and renderer can all reference the same Effect schema:

```ts
export class PackCapability extends Schema.Class<PackCapability>('PackCapability')({
  packId: PackId,
  paintable: Schema.Boolean,
  tilesetCount: Schema.Number,
  tileCount: Schema.Number,
  autotileRuleCount: Schema.Number,
  terrainClassCount: Schema.Number,
  hasAnimations: Schema.Boolean,
  hasCollisionMasks: Schema.Boolean,
  schemaVersion: Schema.Option(Schema.Number),
  source: Schema.Literal('tileborne', 'tiled-tileset', 'tiled-map', 'asset-only'),
  diagnostics: Schema.Array(PackCapabilityDiagnostic),
}) {}
```

`source` records _how_ the pack was imported (drives the right diagnostics and follow-up actions). `diagnostics` carries typed warnings (`PACK.no-tilesets`, `PACK.duplicate-id`, `PACK.unsupported-schema`, `PACK.flip-flag-dropped`, etc.) per ADR-0020.

### Paintable definition

A pack is **paintable** if, and only if:

1. The manifest is a valid `TilesetPack` (parses through `@tileborne/sdk-tileset/manifest.parseTilesetManifest`).
2. `tilesetCount >= 1` and `tileCount >= 1`.
3. Every referenced asset in `tilesets[].tiles[]` resolves to an `assets[]` entry whose `mime` starts with `image/`.
4. `schemaVersion` is recognized (`1` for v1).

Anything that fails these checks is **asset-only**: it can be browsed in the Asset Library, but cannot be selected as a brush source, cannot drive Generate Map, and cannot be set as `activePalettePackId`.

### Where the probe lives (canonical owner)

`packages/services-app/src/asset/capability.ts` (new) is the single owner of capability detection:

- It reads the manifest via the existing pack file readers, validates with `parseTilesetManifest`, and produces a `PackCapability`.
- Capability is computed at **import-finish time** and cached in the pack's `lock.json` alongside the integrity hash so future starts don't re-scan.
- The IPC `tileborne:assets:listPacks` response is extended to include `capability: PackCapability` per pack. This replaces the per-pack manifest fetch the renderer currently does (the temporary client-side probe in `apps/desktop/src/renderer/lib/pack-capability.ts` is the hot-fix; ADR-0021 makes it server-authoritative).
- `tileborne:assets:getPack` also returns the full capability.
- Boundary rule: renderer code never calls `parseTilesetManifest` itself. It receives `PackCapability` over IPC.

### Editor defaulting rules (consumed contract)

These are the **observable** rules the editor must follow once capability lands. They replace ad-hoc fallbacks scattered across components:

1. **Default palette pack** (`apps/desktop/src/renderer/components/sidebar/assets-tab.tsx`):  
   `palettePackId = activePalettePackId if paintable, else first installed pack with paintable=true, else undefined`.  
   When `undefined`, the sidebar shows an empty-state CTA ("Import a Tileborne pack with tilesets to start painting").
2. **Pack switcher in sidebar** is allowed to _select_ asset-only packs only as a no-op preview (greyed, disabled tooltip "Asset-only pack — no paintable tilesets"). It never sets `activePalettePackId` to a non-paintable pack.
3. **Generate Map dialog** (`apps/desktop/src/renderer/components/generate-map-dialog.tsx`): the tileset `<Select>` lists **only paintable packs**. If the list is empty, the submit button is disabled with a typed message and a quick-action link to the import dialog.
4. **Asset Library "Set as active"**: button is disabled for asset-only packs with the same disabled tooltip.
5. **Map ↔ palette pack sync**: when `activePalettePackId` changes and a map is open, the desktop service writes `map.properties.tilesetPackId` to the new pack so the viewport renderer (which uses `tilesetPackId`, not the editor UI store) stays in step. This closes the existing palette-vs-viewport divergence noted during the 2026-05-24 live audit.
6. **Duplicate-import detection**: when a new pack lands, capability detection compares `(manifest.id, integrityHash)` against installed packs and emits a `PACK.duplicate-id` diagnostic plus a "Replace existing" / "Keep both" prompt in the import dialog. v1 default is **keep both** but show a badge in the sidebar pack list.

### Asset-only packs are first-class but distinct

Asset-only packs remain valid imports — they're useful as sprite libraries for plugins, custom UI, and game-host runtime art. ADR-0021 does not deprecate them. It just stops them from masquerading as paintable. They:

- Show up in Asset Library with a `Sprites` badge instead of `Tileset`.
- Are addressable by `packId` for sprite/animation lookup at runtime (existing path).
- Cannot be the palette pack and do not appear in tile-pack selectors.

### Migration path for existing installs

1. On desktop boot, run capability detection against every installed pack lacking a cached `capability` field in `lock.json`. Persist the result.
2. Existing duplicate "ERW Ancient Ruins" entries (the live state observed) become explicit: each shows its `version` and `tilesetCount`. The user can manually `removePack` the asset-only stubs from Asset Library.
3. CLI gets a `tileborne asset describe <packId>` that prints capability + diagnostics so headless users can clean up via `tileborne asset remove`.

## Plugin-neutral architecture

- Capability schema lives in `@tileborne/core`. No React, Electron, Pixi, or Node-only imports.
- Capability detection lives in `packages/services-app/src/asset/capability.ts`, reusing `@tileborne/sdk-tileset/manifest.parseTilesetManifest`. Uses injected readers (no `node:fs` directly in worker-bundled code paths).
- IPC schemas extend `packages/ipc-contracts/src/contracts/assets.ts` per ADR-0002 (Effect Schema SSOT).
- Renderer (`apps/desktop/src/renderer/**`) consumes capability via existing `useAssetPacks` query plus a new `usePackCapability(packId)` selector. The temporary client-side probe (`apps/desktop/src/renderer/lib/pack-capability.ts`) is removed once the IPC ships.
- Runtime (`packages/runtime/**`) consumes capability when assembling runtime manifests — only paintable packs contribute tile UVs/atlases; asset-only packs only contribute referenced sprites. No runtime re-parsing.

Forbidden edges:

- Renderer must not call `parseTilesetManifest`.
- `apps/desktop/src/renderer/lib/pack-capability.ts` is allowed to exist as an interim hot-fix until the IPC ships, but a deprecation TODO with a link to this ADR is required, and the boundary test allow-list entry expires when ADR-0021 Phase 1 lands.
- Plugins cannot override capability detection. They can ship packs of either kind, but the Tileborne pipeline decides which is paintable.

## IPC contract changes

Extend `packages/ipc-contracts/src/contracts/assets.ts`:

- `tileborne:assets:listPacks` response: each pack gains `capability: PackCapability`.
- `tileborne:assets:getPack` response: gains `capability: PackCapability`.
- New event: `tileborne:assets:capabilityRefreshed`
  - Payload: `{ packId, capability }`. Emitted on import success and when an existing pack's lock is updated.
- New IPC: `tileborne:assets:describePack`
  - Request: `{ packId }`
  - Response: `{ pack, capability, diagnostics }` — for CLI `asset describe` and the Asset Library details pane.

## Definition of done

1. `PackCapability` schema exists in `@tileborne/core` and is exported through `@tileborne/ipc-contracts`.
2. Capability is computed at import time, cached in `lock.json`, and surfaced through `listPacks` / `getPack` / `describePack`.
3. Renderer no longer probes manifests directly; the interim `lib/pack-capability.ts` shim is removed.
4. Sidebar palette defaults to first paintable pack; non-paintable packs render disabled with a clear tooltip.
5. Generate Map dialog `<Select>` only lists paintable packs; non-paintable list state shows the import CTA.
6. Asset Library "Set as active" is disabled for asset-only packs.
7. `activePalettePackId` change while a map is open updates `map.properties.tilesetPackId`.
8. CLI: `tileborne asset describe <packId>` prints capability + diagnostics.
9. Boundary tests forbid `parseTilesetManifest` imports outside `packages/services-app/src/asset/**` and `@tileborne/sdk-tileset`.
10. `vitest --run` covers: paintable detection on the bundled ancient fixture, asset-only detection on the raw ERW source, duplicate-id diagnostics, capability persistence in `lock.json`, IPC schemas.
11. Live test artifact under `.refs/v0.1.x-pack-capability/` showing: pack list with mixed capabilities, sidebar disabling asset-only entries, Generate Map filtered list, paint-after-active sync into `map.properties.tilesetPackId`.

## Risks and mitigations

1. **Capability false negatives on legitimate Tileborne packs.** Mitigation: capability detection rejects only when `parseTilesetManifest` rejects; we add fixtures for every supported `schemaVersion`.
2. **Capability false positives on broken packs.** Mitigation: validate every tile asset reference resolves to an `image/*` mime in `assets[]`; surface as diagnostic.
3. **`lock.json` drift.** Mitigation: capability is keyed by `integrityHash`. If hash changes, capability is recomputed and persisted.
4. **Old desktop versions hitting new IPC.** Mitigation: capability is additive on the existing list/get responses; old clients ignore the new field.
5. **Plugin packs.** Mitigation: ADR-0021 defines capability, plugins consume it; plugins are not allowed to override it.
6. **Performance on huge packs.** Mitigation: the bundled ancient fixture (~9 MB JSON, 33 tilesets, 29k tiles) parses in <2 s on dev hardware. Cache in `lock.json` so detection runs once per pack version.
7. **Migration cost for users with existing duplicate imports.** Mitigation: the duplicate-id diagnostic plus `tileborne asset describe`/`remove` CLI gives them the tools to clean up before any UX changes hit them.

## Reference repos

Live evidence informing this ADR (CDP probe on 2026-05-24):

- `apps/desktop/src/renderer/components/sidebar/assets-tab.tsx` — old `installedPacks[0]?.id` fallback.
- `apps/desktop/src/renderer/components/shell/tileset-palette.tsx` — silent skeleton on parse failure.
- `apps/desktop/src/renderer/components/generate-map-dialog.tsx` — unfiltered pack `<Select>`.
- `packages/services-app/src/asset/index.ts:354` — `importDirectoryPack` (where capability detection should attach).
- `packages/sdk-tileset/src/manifest/parse.ts` — `parseTilesetManifest` (definition of paintable).
- `packages/test-fixtures/fixtures/asset-packs/ancient/tileborne-asset-pack.json` — paintable reference (33 tilesets, ~29k tiles).
- `~/.tileborne/assets/packs/pack:660e8400-…-erw-ancient/tileborne-asset-pack.json` — observed asset-only stub from raw ERW source import.
- `~/projects/games/petwars/editor/src/client/MapEditorSidebar.svelte` — reference for how the petwars Svelte editor splits "favorites/raw tileset" filtering, useful UI input for the disabled-state tooltip work.
- ADR-0005 — license/trust model that asset-only packs already satisfy and this ADR keeps untouched.
- ADR-0016 — ERW rule packs ride on top of paintable packs; capability detection is a prerequisite.
- ADR-0020 — Tiled tileset import lands packs that must satisfy this paintable contract.

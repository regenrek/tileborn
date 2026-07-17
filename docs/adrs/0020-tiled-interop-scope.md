# ADR-0020: Tiled interop scope (TMX/TMJ/TSX/TSJ + custom properties)

- Status: Proposed
- Date: 2026-05-24
- Deciders: Tileborne core team
- Tags: tiled, tileset, map, parser, import, export, sdk-tileset, cli, editor-ui, ipc, boundary-test
- Supersedes: none
- Superseded by: none
- Relates to: ADR-0008 (project/map schema versioning), ADR-0016 (ERW Ancient Tiled rules — domain-specific subset), ADR-0021 (pack capability / paintable semantics)

## Context

[Tiled](https://www.mapeditor.org/) is the canonical 2D tile-map editor in the wider ecosystem. Tileborne's neutral schema is intentionally similar (tile layers, object groups, terrain/wang sets, properties), and we already inherit a lot of that vocabulary. ADR-0016 picks the **ERW Ancient** subset of Tiled (wang sets + automapping rules + phase ordering) and turns it into the canonical rule pipeline. ADR-0020 zooms out: it covers the **general** Tiled-format interop surface that all packs and maps need, independent of any specific procgen ruleset.

Today the repo already contains a non-trivial parser surface and a CLI command for map import:

```
packages/sdk-tileset/src/tiled/
  index.ts             // public entry; exports gid, types, parsers, compilers
  types.ts             // Tiled JSON/XML AST types (TmjMap, TsjTileset, TmxMap, TsxTileset, …)
  gid.ts               // global tile ID encoding/decoding (flip flags + tileset offset)
  external-resolve.ts  // resolves <tileset source="…" /> external references
  tile-data.ts         // CSV/base64/zlib/zstd payload decoding for tile layers
  compile-tileset.ts   // Tiled tileset → Tileborne tileset
  compile-wang.ts      // Tiled wang sets → Tileborne autotile rules
  compile-map.ts       // Tiled map → Tileborne map
  tsj-parse.ts / tsx-parse.ts / tmj-parse.ts / tmx-parse.ts
  validate.ts
  deterministic-ids.ts // stable ID derivation from source path + ordinal
  xml-common.ts
```

CLI:

- `tileborne map import-tiled <file>` — wired through `MapService.importFromTiledFile` (`packages/services-app/src/map/index.ts:514`). Imports a single TMJ/TMX file as a Tileborne map under the active project. Path is verified-child-only.

What does **not** exist today:

- **No `tileborne tileset import-tiled`**: a Tiled `.tsj`/`.tsx` (with associated PNG atlas) cannot be turned into a paintable Tileborne asset pack. The desktop editor's "Import asset pack" only accepts a folder containing a `tileborne-asset-pack.json`. Users with Tiled tilesets on disk have no first-class import path. (See ADR-0021 for the asset-only vs tileset-pack distinction this exposes.)
- **No desktop UI for Tiled map or tileset import**: only the CLI surfaces it.
- **No Tiled export**: maps and tilesets are one-way only.
- **No documented custom-properties contract**: Tiled custom properties on maps, layers, tiles, tilesets, and objects are silently dropped today — yet they are how Tiled users encode gameplay metadata (collision class, spawn role, AI hints, render order). Some of this lands in `compile-map.ts` properties; most does not.
- **External tileset references**: `external-resolve.ts` exists but the CLI/editor entry points don't expose a clear policy for unresolved external tilesets, missing images, or relative-path traversal across project roots.
- **GID flip flags**: `gid.ts` decodes Tiled's three flip bits (H, V, D) but Tileborne's neutral tile schema has no place to round-trip them yet — they are normalized away on import. This is fine for renderers that derive flip from tags, but blocks a future symmetrical export.

External and local references that informed scope:

- Authoritative format docs in `/Users/kregenrek/projects/games/petwars/third-party-references/tiled/docs/reference/`:
  - `tmx-map-format.rst` — full TMX specification.
  - `json-map-format.rst` — TMJ/TSJ JSON specification.
  - `global-tile-ids.rst` — gid encoding and flip-flag layout.
  - `support-for-tmx-maps.rst` — what loaders are expected to handle.
- Tiled source tree itself for libtiled parsing semantics: `…/petwars/third-party-references/tiled/src/libtiled/`.
- `…/petwars/third-party-references/super-tiled2unity` — Unity importer reference for what Tiled features practical loaders preserve (custom properties, object templates, animations, layer offsets).
- Other tile-system references in the same folder (`ldtk`, `phaser-tilemap-plus`, `TileMapDual`, `wave-function-collapse`) — not in scope here, but usable as comparison ammo for ADR-0016 and future ADRs on autotile/procgen.
- Tileborne neutral schema: `packages/core` map types, ADR-0008 versioning rules.

## Decision

Tileborne treats the Tiled formats as **first-class interop targets**, not as the native authoring format. The neutral Tileborne map/tileset schema in `packages/core` and `packages/sdk-tileset` remains the SSOT. Tiled is a peer ecosystem we import from and export to.

This ADR is for Tileborne's OSS surfaces only: neutral editor/runtime/plugin contracts, import/export services, IPC, CLI, and SDK packages. Battle Royale gameplay behavior stays in the existing `packages/plugin-battle-royale` package, while private product concerns such as branding, assets, maps, deploy targets, and product config stay in `/Users/kregenrek/projects/games/petwars-product` and consume Tileborne plus the Battle Royale plugin.

### Canonical owner

`packages/sdk-tileset/src/tiled/` is the canonical owner of all Tiled syntax/semantics: parsing, gid math, external resolution, compilation to neutral schema, and (later) projection back to Tiled. No Tiled-specific code may live in:

- `apps/desktop/**` (renderer or main): only consumes IPC-projected results.
- `packages/runtime/**`: runtime never re-parses Tiled at boot or playtest.
- `packages/services-app/**` may **call** `sdk-tileset` parsers, but must not reimplement parsing.
- `packages/cli/**` may compose `MapService` / `AssetService`, not parse Tiled itself.

### Supported formats and feature subset (v1)

| Format                                                                          | Read                            | Write                  | Notes                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| TMJ (`.tmj`, `.json`) map                                                       | ✅                              | 🟡 (Phase 3)           | Tileborne map ↔ Tiled JSON map                                                    |
| TSJ (`.tsj`, `.json`) tileset                                                   | ✅                              | 🟡 (Phase 3)           | Tileborne tileset ↔ Tiled JSON tileset                                            |
| TMX (`.tmx`) map                                                                | ✅                              | ❌ (deferred)          | XML round-trip is lossier; defer until Phase 4 only if demand                     |
| TSX (`.tsx`) tileset                                                            | ✅                              | ❌ (deferred)          | Same as TMX                                                                       |
| External `<tileset source="…" />`                                               | ✅                              | n/a                    | Resolved verified-child only; refusal on traversal                                |
| Tile layers (CSV / base64 / base64+zlib / base64+zstd)                          | ✅                              | TMJ uncompressed       | `tile-data.ts`                                                                    |
| Object layers (rectangle, ellipse, polygon, polyline, point, text, tile-object) | ✅ tile/rect/ellipse/point/poly | TMJ tile/rect/point    | Polyline/polygon/text → Tileborne neutral object kinds with structured `geometry` |
| Image layers                                                                    | ❌ v1                           | ❌                     | Out of scope; can be added if a real consumer appears                             |
| Group layers                                                                    | ✅ flatten with prefix          | flatten on export      | Tileborne stays flat at v1                                                        |
| Wang sets / terrain sets                                                        | ✅ via `compile-wang`           | partial export         | Subsumed by ADR-0016 for ERW; generic export = best-effort                        |
| Animations                                                                      | ✅                              | TMJ frames only        | Animation IDs are deterministic per ADR; durations preserved                      |
| Tile collision objects                                                          | ✅                              | TMJ rect/point/polygon | Mapped to Tileborne `collisionMask` semantics                                     |
| Custom properties (string, int, float, bool, color, file, object)               | ✅ pass-through                 | ✅ on export           | See "Custom properties contract" below                                            |
| Object templates (`.tx`)                                                        | ❌ v1                           | ❌                     | Inlined at parse time if encountered; templates are not durable in our schema     |
| Class types / project file (`.tiled-project`)                                   | ❌ v1                           | ❌                     | Not portable; user-defined types come via custom properties                       |
| Hexagonal/Isometric/Staggered orientations                                      | ❌ v1                           | ❌                     | Tileborne v1 is orthogonal; refuse with typed diagnostic                          |

Anything explicitly listed `❌ v1` must produce a **typed diagnostic** with file/line context, not silent data loss.

### GID flip flags

Tiled encodes horizontal, vertical, and diagonal flip in the top three bits of each gid (`global-tile-ids.rst`). Today `gid.ts` extracts them and the compilers throw them away. ADR-0020 ratifies the v1 behavior:

- On import, flip flags are read and either:
  - mapped to Tileborne tile **tags** (`flip:h`, `flip:v`, `flip:d`) when the destination layer is a tile layer, **or**
  - preserved on Tiled tile-objects via a structured `transform` field in the neutral object schema.
- On export, those tags/transforms are converted back to gid flip bits.
- Until export lands (Phase 3), flip is allowed to round-trip lossily, but importers must never silently swap to a _different_ tile id. If flip cannot be represented downstream, emit a `TIL.flip-flag.dropped` diagnostic.

### External tileset resolution policy

`external-resolve.ts` resolves `<tileset source="…" />` and `"source": "…"`. ADR-0020 makes the policy explicit:

- All resolution is **verified-child of the import root** (the file the user pointed us at, or the project directory for in-project imports). Traversal is refused.
- Missing files yield typed `MapValidationError` / `TilesetValidationError`, not crashes.
- Image references inside an external tileset are resolved relative to the tileset file, then verified against the same root. Outside the root → typed error.
- A single import call may walk an arbitrary external graph but must enforce a configurable depth limit (default 8) and a path-cycle detector.

### Custom properties contract

Tiled custom properties are how downstream users encode game-specific metadata. ADR-0020 establishes a stable, lossless round-trip:

- The neutral schema (`@tileborne/core`) carries a `customProperties: ReadonlyMap<string, CustomPropertyValue>` field on map, layer, tile, tileset, and object.
- `CustomPropertyValue` is a tagged union: `{ kind: "string" | "int" | "float" | "bool" | "color" | "file" | "object"; value: …; sourceType?: string }`.
- Importers preserve the original `propertytype` (Tiled class) string in `sourceType` for export fidelity.
- Tileborne never _interprets_ arbitrary custom properties. Plugins or rule packs (ADR-0016) may project them into engine-specific data; that projection lives outside `sdk-tileset`.
- Property keys with reserved Tileborne prefixes (`tileborne.*`, `engine.*`) are forbidden in user-authored Tiled files and rejected with a typed diagnostic to avoid namespace collisions.

### Phase plan

**Phase 1 — Tileset import to paintable pack (highest user value).**

1. New CLI command: `tileborne tileset import-tiled <tsj-or-tsx> [--name] [--license]`.
2. New service method: `AssetService.importTilesetFromTiled(srcPath, manifest)` that compiles the Tiled tileset (including external resolution) into a `TilesetPack`-shaped manifest plus referenced atlas PNGs, and runs it through the existing pack-import pipeline so it lands as an installed pack with a real `tilesets[]` section (per ADR-0021 paintable definition).
3. Desktop "Import asset pack" dialog gains a third source kind: **"Tiled tileset (.tsj/.tsx)"** that calls a new IPC. Asset-only folders remain supported.
4. Boundary tests: renderer must not import Tiled parsers; service-app must not import them outside the tileset/map import code paths.
5. Live test item under `.refs/v0.1.x-tiled-interop/` showing a Tiled tileset on disk imported, painted in the editor, and surviving a project save/load.

**Phase 2 — Desktop UI for map import + diagnostics surface.**

1. Desktop dialog for "Import Tiled map" (TMJ/TMX) inside an open project, equivalent to today's CLI.
2. Diagnostic panel: lists `tileborne tiled-import` warnings (unsupported features, dropped flip flags, missing externals, namespace conflicts) with file/line and a "copy as JSON" action.
3. Generate Map dialog gains a "Source: Tileborne pack | Tiled tileset" toggle so users can generate against a Tiled tileset directly without manual import.
4. Live test item showing a TMJ map imported via UI, including diagnostics screen, with screenshot + DOM JSON.

**Phase 3 — Tiled export (TMJ/TSJ writer).**

1. `MapService.exportToTiledFile(mapId, dst)` writing TMJ.
2. `AssetService.exportTilesetToTiled(packId, tilesetId, dst)` writing TSJ.
3. Round-trip property tests: import → export → import yields a structurally-equivalent map (modulo documented `❌ v1` items).
4. Custom properties full round-trip including `sourceType`.
5. Optional CLI: `tileborne map export-tiled <mapId> <dst>`, `tileborne tileset export-tiled <packId> <tilesetId> <dst>`.

**Phase 4 — TMX/TSX export and Tiled object templates (deferred).**

Only do this when there is a real OSS user need; XML round-trip is significantly more work for limited additional value vs JSON.

## Plugin-neutral architecture

- Tiled parsers stay in `packages/sdk-tileset/src/tiled/`, **pure and worker-safe**: no `node:fs`, no Electron, no React, no Pixi. Filesystem reads happen in `packages/services-app` via injected readers.
- Tile/atlas image loading uses Tileborne's content-hashed asset pipeline (ADR-0005). Images referenced from a Tiled file are content-hashed at import time; a duplicate atlas across multiple Tiled tilesets is deduplicated.
- IPC contracts for desktop import flows live in `packages/ipc-contracts` per ADR-0002.
- Boundary tests in `packages/boundary-tests` enforce:
  - `apps/desktop/**` does not import `@tileborne/sdk-tileset/tiled/*`.
  - `packages/runtime/**` does not import any `tiled` module.
  - Worker-bundled paths reject `node:` imports.

## IPC contract changes

New contracts in `packages/ipc-contracts` (Effect schemas, branded IDs from `@tileborne/core`):

- `tileborne:assets:importTiledTileset`
  - Request: `{ sourceKind: "directory" | "tsj" | "tsx"; path: string; license?: AssetLicenseInput; name?: string }`
  - Response: `{ jobId, packId? }` — async with progress events on existing job channels.
- `tileborne:maps:importTiledMap`
  - Request: `{ projectId, path, options?: { dropUnsupported?: boolean } }`
  - Response: `{ mapId, layerCount, objectCount, diagnostics }`.
- `tileborne:maps:exportTiledMap` (Phase 3)
  - Request: `{ projectId, mapId, format: "tmj" | "tsj"; dst: string }`
  - Response: `{ path, diagnostics }`.
- `tileborne:assets:exportTiledTileset` (Phase 3)
  - Request: `{ packId, tilesetId, format: "tmj" | "tsj"; dst: string }`
  - Response: `{ path, diagnostics }`.

Diagnostics in IPC payloads are already-defined typed objects from `sdk-tileset`, not free-form strings.

## Definition of done

1. `tileborne tileset import-tiled` exists and produces a Tileborne pack that satisfies ADR-0021's paintable contract.
2. Desktop "Import asset pack" dialog supports the Tiled tileset source kind end-to-end.
3. Custom properties survive an import on map, layer, tile, tileset, and object levels.
4. External tileset resolution is verified-child only; depth-limited; cycle-detected; missing files yield typed diagnostics.
5. Diagnostics are typed (no string-only errors), surfaced in CLI output and a desktop UI panel.
6. GID flip flags either map to Tileborne tile tags / object transforms, or produce `TIL.flip-flag.dropped` diagnostic.
7. Boundary tests forbid Tiled imports outside `sdk-tileset` and forbid `node:`/Electron in worker paths.
8. `vitest --run` covers: TMJ + TMX + TSJ + TSX parser fixtures, gid round-trip, external resolve traversal/depth/cycle, compile-map, compile-tileset, compile-wang, custom-properties pass-through, IPC schemas, and CLI behavior.
9. Live test artifacts saved under `.refs/v0.1.x-tiled-interop/` for each phase: import, paint, save/load, diagnostic screen.
10. Phase 3 export (when implemented) passes round-trip property tests using the same fixtures.

## Risks and mitigations

1. **Feature-creep into a full Tiled clone.** Pin to the format subset table above; require an ADR amendment to extend.
2. **Lossy import surprises (flip flags, image layers, hex maps).** Always emit typed diagnostics; never silently drop. Diagnostics are visible in CLI and desktop UI before the user commits.
3. **External-path traversal / supply-chain risk.** Verified-child only; depth/cycle limits; treat all external paths as untrusted (ADR-0005).
4. **Renderer or runtime re-parsing Tiled to "save a hop"** breaking ownership. Boundary tests on every PR; ADR-0016 already establishes the precedent.
5. **Schema drift between Tileborne neutral and Tiled.** Custom-properties round-trip and round-trip property tests catch regressions early.
6. **Massive Tiled files (cities, tilemaps with 100k+ tiles).** Tile-data decoder must stream / chunk; benchmark the worst fixture before exposing the desktop dialog.
7. **Atlas duplication.** Enforce content-hash dedupe in the importer; surface dedupe info in diagnostics.

## Reference repos

Primary spec and parser references (read-only, in `~/projects/games/petwars/third-party-references/`):

- `tiled/docs/reference/tmx-map-format.rst` — TMX format spec.
- `tiled/docs/reference/json-map-format.rst` — TMJ/TSJ JSON spec.
- `tiled/docs/reference/global-tile-ids.rst` — gid + flip flags.
- `tiled/docs/reference/support-for-tmx-maps.rst` — what good loaders preserve.
- `tiled/src/libtiled/` — Qt/C++ reference parser implementation.
- `super-tiled2unity/` — practical Unity importer; good benchmark for "what gets preserved".
- `ldtk/` — alternate level-editor format; useful pressure for our neutral schema.

Tileborne current state (for grounding implementation work):

- `packages/sdk-tileset/src/tiled/index.ts:1` — public parser surface.
- `packages/sdk-tileset/src/tiled/gid.ts` — flip flag decode.
- `packages/sdk-tileset/src/tiled/external-resolve.ts` — external tileset reader hook.
- `packages/sdk-tileset/src/tiled/compile-map.ts` — Tiled → Tileborne map compiler.
- `packages/sdk-tileset/src/tiled/compile-tileset.ts` — Tiled → Tileborne tileset compiler.
- `packages/services-app/src/map/index.ts:514` — `MapService.importFromTiledFile`.
- `packages/cli/src/commands/map/index.ts:210` — `tileborne map import-tiled`.
- `docs/01-spec.md:219` — historical Tiled module placement.
- `docs/01-spec.md:1115` — CLI surface for Tiled import.
- `docs/01-spec.md:1167` — implementation status index.
- ADR-0016 — ERW Ancient subset (wang sets + automapping rules).
- ADR-0021 — paintable-pack capability contract that Phase 1 lands against.

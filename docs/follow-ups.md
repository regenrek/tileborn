# Follow-ups

Tracked deferrals and post-v0.1.0 work. Resolved items stay listed with a **Resolved** note for audit trail.

## Gameplay behavior authoring

### fu-behavior-specialized-graphs

V1 ships the ordered WHEN/IF/DO event-sheet model and native TypeScript. Defer
purpose-built dialogue, quest, state-machine, animation, and behavior-tree graph
editors until a concrete creator workflow requires one. Any future graph must
reuse the canonical behavior registry, compile to `BehaviorModule`, preserve one
source owner, emit the existing diagnostics/source locations, and run through
the same deterministic isolated scheduler. A universal Blueprint-style canvas,
a second runtime, and TypeScript-to-visual round-tripping remain explicitly out
of scope.

## SDK tileset

### fu-sdk-tileset-core-tileset-id

`@tileborne/core` exposes `TileSetId` while `@tileborne/sdk-tileset` defines `TilesetId`
with the same `tileset:<uuid>` prefix. Consolidate on one branded type when the editor
and runtime hard-cut to SDK metadata.

### fu-sdk-tileset-pack-schema-version

**Resolved in P-A4.** `TilesetPack` and the canonical Tileborne manifest JSON format now carry
`schemaVersion: 1` via `@tileborne/sdk-tileset/manifest`.

### fu-sdk-tileset-license-ssot

`TilesetPackLicense` mirrors `@tileborne/asset-pipeline` `License` shape. Consider a
shared license schema in `@tileborne/core` if both packages need identical validation.

### fu-sdk-tileset-erw-script-removal

**Resolved in P-A15.** The ad-hoc ERW fixture scripts were removed; the bundled
ancient pack snapshot is generated from `importErwAncientRuins` in
`@tileborne/sdk-tileset`.

### fu-acc-sdk-ldtk-external-containment

**Resolved in v0.1.0.** `@tileborne/sdk-tileset` applies the same traversal and project-root
containment policy to LDtk external level references. Regression tests in
`packages/sdk-tileset/src/ldtk/__tests__/external-resolve.test.ts`.

### fu-acc-sdk-compat-matrix-verification

**Resolved in P-A17/P-A18.** SDK verification covers the format-by-autotile-pattern matrix
with committed goldens in `packages/sdk-tileset/src/__verification__/`. See
`compatibility-matrix.test.ts` and `__verification__/README.md` for proven scenarios.

## Release engineering (post-v0.1.0)

### fu-release-npm-publish

npm publish and Trusted Publishing for `@tileborne/cli` and SDK packages.

### fu-release-cloudflare-deploy

Production Cloudflare deploy workflow for `apps/game-host`.

### fu-release-github-tag

GitHub release cut, changelog automation, and screenshot walkthrough in `.refs/v0.1.0-walkthrough/`.

## Dependency hygiene

### fu-deps-audit-transitive

16 transitive advisories in dev/build tooling (Playwright, Wrangler, tar, ws, qs). See
[`.refs/v0.1.0-security-scan.md`](../.refs/v0.1.0-security-scan.md). Bump after v0.1.0 tag.

### fu-erw-asset-license

Confirm authoritative license terms for ERW Ancient Ruins and update
`packages/test-fixtures/fixtures/asset-packs/ancient/PROVENANCE.md` `license.spdxId`.

# ADR-0013: Core summary schemas for cross-package manifests

- Status: Accepted
- Date: 2026-05-23
- Deciders: Tileborne core team
- Tags: schema, core, assets, branding

## Context

`@tileborne/core` originally exported `AssetPackManifestStub` and `BrandConfigStub`. The `Stub` suffix read as a temporary placeholder to OSS consumers, but these schemas are the **canonical identity slices** shared across project manifests, IPC summaries, and runtime boot configuration.

Full asset-pack validation (file lists, licenses, indexing) lives in `@tileborne/asset-pipeline` as `AssetPackManifest`. Product repos extend brand boot with logo and legal fields beyond the core summary (`docs/03-runtime-game-host.md` §5.1).

## Decision

Rename the core schemas to final OSS-facing names:

| Former name                 | Final name                     |
| --------------------------- | ------------------------------ |
| `AssetPackManifestStub`     | `AssetPackManifestSummary`     |
| `BrandConfigStub`           | `BrandConfigSummary`           |
| `makeAssetPackManifestStub` | `makeAssetPackManifestSummary` |

Hard-cut rename only — no aliases or compatibility shims. Schema tags match class names for Effect Schema round-trips.

## Options considered

- **A — Keep `Stub` suffix and document**: Low churn; misleading public API for a shipped v0.1.0 surface.
- **B — Merge into `@tileborne/asset-pipeline` types**: Couples core project manifests to pipeline imports; violates package layering.
- **C (chosen) — `…Summary` in `@tileborne/core`**: Clear that these are identity/metadata slices; full manifests stay in asset-pipeline and runtime boot layers.

## Consequences

- Positive: OSS exports communicate stable, intentional schema names.
- Positive: Distinction between `AssetPackManifestSummary` (core) and `AssetPackManifest` (pipeline) is explicit.
- Negative: One-time rename for any out-of-tree consumers (pre-release; acceptable hard cut).

## References

- `docs/01-spec.md` §3 (`@tileborne/core`), §9 (asset pack manifest on disk)
- `docs/03-runtime-game-host.md` §5.1 (`BrandConfig` product extensions)
- `packages/core/src/project/index.ts`
- PlanDB `t-yv2b` / P1.12

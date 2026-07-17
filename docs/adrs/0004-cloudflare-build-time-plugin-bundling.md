# ADR-0004: Cloudflare build-time plugin bundling

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: cloudflare, plugins, game-host, build

## Context

The game host runs on Cloudflare Workers + Durable Objects. Workers have no arbitrary filesystem, no dynamic `require()` from disk, and no runtime plugin discovery. Architecture invariant #5 states plugins are bundled at build time. Private brand repos (e.g. Petwars) invoke `tileborne game build --plugin <id> --target cloudflare` to produce a deployable worker bundle.

## Decision

Cloudflare deployments **statically bundle** the selected runtime plugin, asset manifests, and host entrypoints at build time. There is no filesystem plugin discovery in Workers. Generic Tileborne endpoints (`/discover`, `/playtest/*`, `/health`) remain brand-neutral; branding and asset injection happen in the private product repo’s build pipeline.

## Options considered

- **A — Runtime plugin loading from R2/KV**: Flexible but incompatible with Workers security model and complicates integrity verification.
- **B — Separate worker per plugin**: Operational overhead; duplicates host code.
- **C (chosen) — Build-time bundling via `tileborne game build`**: Matches Wrangler deploy flow; one artifact per brand+plugin combination; integrity checked before deploy.

## Consequences

- Positive: Deterministic deploys; plugin hash verified at build time.
- Positive: Same plugin package runs locally (CLI), in Electron playtest, and on Cloudflare after bundling.
- Negative: Switching plugins requires rebuild and redeploy—not hot-swappable at edge.
- Follow-up: Implement `apps/game-host/src/bundled-plugin.ts` and `build-manifest.ts` per `docs/01-spec.md` §13–§14.

## References

- `docs/01-spec.md` §13 (runtime SDK), §14 (Cloudflare deployment)
- `docs/03-runtime-game-host.md` §9 (plugin bundling, brand injection)
- Related: [ADR-0009](./0009-three-repo-split-private-petwars-boundary.md)

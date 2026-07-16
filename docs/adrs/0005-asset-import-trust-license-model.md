# ADR-0005: Asset import trust and license model

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: assets, security, licensing, pipeline

## Context

Tileborne imports third-party tilesets, Tiled projects, and archives into `~/.tileborne/assets/`. Untrusted archives are a common path for path traversal, zip bombs, and license violations. Architecture invariant #6 requires atomic, content-hashed, path-traversal-safe, license-aware imports.

`@tileborne/asset-pipeline` owns importers, pack manifests, security guards, and license schemas.

## Decision

Every asset import runs through a **staged, guarded pipeline**: inspect archive → enforce caps → block traversal/symlink escape → require license metadata for third-party packs → hash all files → write manifest → atomic rename into the asset library. Imports are jobs observable via IPC; the UI never writes asset files directly.

Required guards: no absolute paths, no `../` traversal, no symlink escape, byte/file/dimension caps, required `license.id`, required `sourceUrl` for third-party packs, per-file content hashes.

## Options considered

- **A — Trust-on-first-use / no license gate**: Faster UX; unacceptable for OSS redistribution and user legal exposure.
- **B — Manual copy into asset folders**: Bypasses validation; breaks indexing and hashing guarantees.
- **C (chosen) — Service-owned import jobs with mandatory license + security guards**: Matches spec §9; aligns with Effect job runner in main/CLI.

## Consequences

- Positive: Consistent asset index; reproducible pack manifests with `contentHash`.
- Positive: Clear audit trail for third-party asset provenance.
- Negative: Import fails closed when license metadata is missing—users must supply or fix metadata.
- Follow-up: Ship CC0 sample fixtures for OSS; document license schema in plugin SDK docs.

## References

- `docs/01-spec.md` §9 (asset architecture, import lifecycle, guards)
- `docs/02-editor-ux.md` §5 (asset library UX)
- Related: [ADR-0003](./0003-electron-process-boundary-rules.md)

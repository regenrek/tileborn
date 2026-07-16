# ADR-0008: Project and map schema versioning

- Status: Accepted
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: schema, migration, core, maps

## Context

Projects and maps are persisted JSON with `schemaVersion` and `engineVersion` fields (`docs/01-spec.md` §10). Plugins attach namespaced properties. Tileborne must upgrade older files safely without silent data loss. The spec requires “schema migrations versioned and tested” but does not yet pin the migration authoring format or automatic vs manual upgrade UX.

`@tileborne/core` owns versioning utilities; CLI exposes `tileborne project upgrade`.

## Decision

**Accepted policy:**

1. Every project manifest and map file carries an integer `schemaVersion`.
2. Breaking changes increment `schemaVersion`; `engineVersion` tracks the Tileborne release that wrote the file.
3. `packages/core/src/versioning/persisted-schema-registry.ts` is the sole
   registry for current versions and compatibility policy across first-party
   persisted formats. Domain packages own codecs and migration functions named
   by the registry; the registry does not import those codecs.
4. Upgrades run through application services/main or CLI—never in the renderer.
   User-authored source requires backup-first ordered migration and verified
   restore before replacement.
5. Migrations are explicit hand-written TypeScript `vN → vN+1` transforms,
   idempotent at their load boundary and covered by committed fixtures. Effect
   Schema remains the current-version codec, not an implicit migration engine.
6. Unknown future or corrupt authoring source is refused without mutation.
   Derived caches rebuild; shipped artifacts require an exact version and are
   rebuilt from source; disposable preferences may reset.

## Options considered

- **A — Big-bang rewrites on open**: Simple; risks data loss and blocks plugin-specific property migration.
- **B — Manual user JSON editing**: No tooling; unacceptable for a game editor product.
- **C — Versioned migration chain (selected)**: Sequential `vN → vN+1`
  TypeScript transforms with fixtures per version; application services and CLI
  apply the chain.
- **D — Effect Schema tagged unions with automatic decode migration**: Less boilerplate; may be insufficient for complex map chunk transforms.

## Consequences

- Positive: Clear contract for plugin authors storing namespaced properties under plugin ids.
- Positive: `schemaVersion` enables compatibility checks before load.
- Negative: Every durable format must register and maintain an explicit policy;
  version bumps cannot be local-only changes.
- Negative: The 1.0 audit exposes unversioned formats and same-version shape
  transforms that require follow-up rather than silently declaring support.
- Plugin-contributed properties are migrated by the plugin/domain transform;
  the application service orchestrates backup, ordering, and commit.
- Follow-up: execute the fixture/backup/restore work listed in
  [Persisted schema compatibility](../persisted-schema-compatibility.md).

## References

- `docs/01-spec.md` §10 (project and map model, storage rules)
- `docs/03-runtime-game-host.md` §8.5 (protocol schema versioning—separate from map schema)
- PlanDB context `c-6wn1` — open migration-authoring decision (hand-written TS vs Effect Schema transforms vs DSL; plugin property migration ownership)
- Related: [ADR-0002](./0002-ipc-schema-ssot-effect-schema.md)
- [Persisted schema compatibility matrix](../persisted-schema-compatibility.md)

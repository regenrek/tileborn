# ADR-0008: Project and map schema versioning

- Status: Proposed
- Date: 2026-05-20
- Deciders: Tileborne core team
- Tags: schema, migration, core, maps

## Context

Projects and maps are persisted JSON with `schemaVersion` and `engineVersion` fields (`docs/01-spec.md` §10). Plugins attach namespaced properties. Tileborne must upgrade older files safely without silent data loss. The spec requires “schema migrations versioned and tested” but does not yet pin the migration authoring format or automatic vs manual upgrade UX.

`@tileborne/core` owns versioning utilities; CLI exposes `tileborne project upgrade`.

## Decision

**Proposed core policy** (pending migration tooling choice):

1. Every project manifest and map file carries an integer `schemaVersion`.
2. Breaking changes increment `schemaVersion`; `engineVersion` tracks the Tileborne release that wrote the file.
3. Upgrades run through a dedicated migration service (main/CLI)—never in the renderer.
4. Migrations are idempotent, tested, and recorded in version control under `packages/core/src/versioning/`.

The **mechanism** for defining migrations (hand-written transforms vs Effect Schema evolutions vs codegen) remains open—see Consequences.

## Options considered

- **A — Big-bang rewrites on open**: Simple; risks data loss and blocks plugin-specific property migration.
- **B — Manual user JSON editing**: No tooling; unacceptable for a game editor product.
- **C — Versioned migration chain (preferred direction)**: Sequential `vN → vN+1` steps with fixtures per version; CLI `project upgrade` applies chain. **Authoring format TBD.**
- **D — Effect Schema tagged unions with automatic decode migration**: Less boilerplate; may be insufficient for complex map chunk transforms.

## Consequences

- Positive: Clear contract for plugin authors storing namespaced properties under plugin ids.
- Positive: `schemaVersion` enables compatibility checks before load.
- Negative: Until migration format is chosen, `project upgrade` is a stub.
- **Open question:** Should migrations be hand-written TypeScript functions, Effect Schema `transform` pipelines, or a small DSL? Who owns plugin-contributed property migrations?
- Follow-up: Add golden fixtures per schema version; wire upgrade into project open path in main.

## References

- `docs/01-spec.md` §10 (project and map model, storage rules)
- `docs/03-runtime-game-host.md` §8.5 (protocol schema versioning—separate from map schema)
- PlanDB context `c-6wn1` — open migration-authoring decision (hand-written TS vs Effect Schema transforms vs DSL; plugin property migration ownership)
- Related: [ADR-0002](./0002-ipc-schema-ssot-effect-schema.md)

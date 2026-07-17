# Backend Implementation

## Storage

- Extend the current schema-versioned project model only through the canonical core/services owner.
- Backups are outside the live transaction target, content-addressed or collision-safe, fsynced where supported, and verified before migration proceeds.
- Existing project-revision journals remain the atomic install/recovery primitive; unsupported or corrupted inputs never overwrite the source.
- Artifact manifests and checksums travel with the built output and contain no secrets or machine-specific absolute paths.

## Services

- Compatibility/migration registry in core/application services.
- Readiness orchestration that composes existing Battle Royale, behavior, asset, map, host, and Ship validators without duplicating their rules.
- Release artifact verifier covering packaged desktop resources and shipped game-host/runtime closure.
- Redacted crash/startup recovery and local observability owner; remote reporting is separately approval/configuration gated.

## Tests

- Golden legacy/current/future/corrupt project fixtures and ordered multi-step migrations.
- Fault injection before and after every journal/backup phase; restart must converge without loss.
- Backup restore round-trip and traversal/symlink/external-modification defenses.
- Artifact checksum/provenance tamper rejection and external-cwd boot.
- Game-host behavior isolation, room recovery, and Battle Royale runtime regression remain in their owning suites.

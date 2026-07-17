# Architecture Decisions

## ADR-001: Harden the existing canonical vertical, do not rebuild it

Status: accepted

Decision: Treat `pln-d39bcb7f` and `pln-059cc827` as verified source plans. Production hardening may fix findings but must preserve the one BehaviorModule runtime, services ownership, and Ship package path.

Consequences: Tasks begin with evidence and gap audits. Broad rewrites need a concrete failing acceptance criterion and independent review.

## ADR-002: Preserve the dirty worktree before cleanup

Status: accepted

Decision: Inventory every status entry and classify it as source, test, docs, generated durable input, disposable output, Planr evidence, or unrelated user work. No reset/checkout/destructive cleanup is permitted. Commit with explicit path sets.

Consequences: Integration is slower but auditable, user work is protected, and clean-checkout failures reveal real missing inputs.

## ADR-003: Support claims require native evidence

Status: accepted

Decision: Forge maker configuration proves intent, not platform support. macOS, Windows, and Linux are independently supported only after native packaging/install/launch/upgrade/uninstall smoke evidence.

Consequences: The 1.0 support matrix may be macOS-only until CI runners and credentials exist.

## ADR-004: Project migrations are explicit, backup-first, and atomic

Status: accepted

Decision: Persisted schema versions have one registry/owner. Migration validates input, writes a restorable backup, transforms through an ordered chain, and commits via the existing journaled project transaction. Future versions are rejected without mutation.

Consequences: Legacy fixtures and fault-injection tests become release gates; silent coercion and renderer migrations are prohibited.

## ADR-005: External mutations remain approval-gated

Status: accepted

Decision: Publishing, deployment, signing credential access, tag creation, and pushes are not performed as implicit hardening steps.

Consequences: Local readiness can complete with an exact blocker receipt, while final public release remains no-go until approved operations pass.

# Architecture Decisions

## ADR-001 - One readiness owner

Status: accepted for this plan

Decision: A single application-level readiness service aggregates neutral and
active-mode validators. Problems UI, checklist, Playtest, Build and Ship consume
the same revisioned result.

Consequences: No UI entry point can invent or bypass validity. Validators need
stable diagnostic identities and navigation locations.

## ADR-002 - Project content overlays immutable plugin templates

Status: accepted for this plan

Decision: Plugin packages provide immutable definitions/templates. Creators
duplicate or override them into versioned project-owned content with explicit
provenance and deterministic resolution.

Consequences: Plugins remain reinstallable and shareable; reference resolution
and precedence require one canonical owner and migration policy.

## ADR-003 - Schema-driven forms first, bundled code registration when required

Status: accepted for this plan

Decision: Generic settings/properties use declarative schemas. Bespoke React
authoring panels and runtime projectors for bundled trusted modes use one typed
desktop registration boundary; arbitrary plugin code is not executed.

Consequences: Future first-party modes have a clear integration point while
marketplace-grade sandboxing remains a separate goal.

## ADR-004 - Editor and CLI share ship services

Status: accepted for this plan

Decision: Ship Game orchestrates existing application/build/package services;
it does not shell out to the CLI or define a renderer-owned artifact format.

Consequences: CLI/editor parity is testable and build behavior has one owner.

## ADR-005 - Shared document lifecycle

Status: accepted for this plan

Decision: Every editable workspace participates in a common revisioned
clean/dirty/saving/saved/error/recovery protocol, with atomic durable writes.

Consequences: Workspace navigation and app close can make one reliable decision;
individual editors must stop managing incompatible save semantics.

# AI Specification

## Model Boundaries

No model is required for project creation, validation, migration, playtest, packaging, recovery, or shipped-game runtime. Coding agents may consume the same generated SDK types, diagnostics, readiness results, and receipts as human creators, but receive no hidden filesystem or network authority.

## Prompt Contracts

Agent-facing documentation must name the canonical SDK imports, deterministic restrictions, project/version contracts, verification commands, and safe recovery actions. Instructions must not recommend deleting project state, bypassing validation, or publishing without approval.

## Evaluation

- An agent can create and repair a representative behavior using only repository docs, types, and compiler diagnostics.
- Human and agent actions produce the same durable project shape and readiness results.
- The final release oracle has no model dependency and is replayable offline except explicitly credentialed deploy checks.

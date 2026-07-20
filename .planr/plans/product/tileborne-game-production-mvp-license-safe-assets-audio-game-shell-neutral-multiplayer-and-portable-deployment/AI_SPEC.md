# AI Specification

## Model Boundaries

No runtime model or hosted AI dependency is introduced. Agents may author only
through public typed editor/SDK/CLI capabilities and cannot bypass license,
readiness, secret, or deployment approval boundaries.

## Prompt Contracts

Agent-facing capability inventories describe supported audio events, shell
actions, multiplayer capabilities, and deployment targets with ids, schemas,
constraints, diagnostics, and examples. Prompts never request cloud secrets.

## Evaluation

- An agent creates the reference configuration without manual JSON or internal imports.
- Invalid ids/actions/licenses are rejected with actionable diagnostics.
- Agent output builds identically to equivalent UI-authored data.
- No prompt or generated config can persist credentials or invoke unregistered provider operations.

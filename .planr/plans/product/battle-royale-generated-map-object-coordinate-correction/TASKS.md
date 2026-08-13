# Tasks

### TASK-001 (code): Correct generated Battle Royale object coordinates

Goal:
Convert every generated object position from deterministic tile cells to
canonical world pixels at the generator boundary.

Acceptance criteria:
- All generated object families use one shared conversion helper.
- Generated objects remain within world bounds and span more than the first two tiles.
- Determinism and existing object-kind coverage remain tested.
- Focused tests, typecheck, and lint pass with verification evidence.

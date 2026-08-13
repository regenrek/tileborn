# Architecture Decisions

## ADR-001

Status: proposed

Decision:

Keep PixiJS as Tileborne's draw adapter and complete the accepted runtime ownership
model. Repair the canonical coordinate, capability, input, shell, and projector
paths instead of adopting a second game framework or renderer-owned loop.

Consequences:

- Existing ADR-0014/0018/0024/0027/0030 ownership remains authoritative.
- Battle Royale proves quality through plugin-owned policy and presentation while
  shared runtime/core contracts remain usable by Zelda-like top-down games.
- Any temporary fallback or duplicate policy added during repair must be removed.

## ADR-002

Status: proposed

Decision:

Adopt one explicit 2D visual-scale contract. Texture pixel dimensions never imply
world footprint; projector configuration declares world size, anchor, and layer for
every visual family, and the viewport applies camera projection exactly once.

Consequences:

- Custom assets remain possible without inheriting arbitrary source-image scale.
- Hitboxes and visual footprints can be compared during readiness and live review.

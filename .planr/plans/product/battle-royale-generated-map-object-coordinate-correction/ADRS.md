# Architecture Decisions

## ADR-001

Status: proposed

Decision:

`MapObject.x/y` remain world-pixel coordinates. Procedural generators own the
single tile-cell-to-world-pixel conversion before constructing map objects.

Consequences:

Editor, minimap, hit testing, runtime, and artifact consumers stay unchanged.
Existing malformed starter maps require an explicit, separately authorized
repair rather than an implicit migration.

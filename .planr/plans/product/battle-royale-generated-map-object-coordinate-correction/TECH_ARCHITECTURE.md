# Technical Architecture

## Components

- `@tileborne/plugin-battle-royale/generate-map`: canonical generated-layout owner.
- `@tileborne/core/MapObject`: durable world-pixel placement contract.
- Desktop viewport and runtime: unchanged consumers of world-pixel coordinates.

## Data Flow

Generator chooses deterministic tile cells, converts each axis once using the
map tile dimensions, and persists the resulting world-pixel position.

## Failure Modes

- Missing conversion clusters generated objects at the origin.
- Double conversion pushes objects beyond map bounds.
- Converting in the renderer would leave runtime, hit testing, minimap, and
  shipped artifacts inconsistent and is therefore out of scope.

# AI Specification

## Model Boundaries

No AI participates in runtime gameplay or authority. Image generation may produce
candidate original tiles/sprites, but assets require human visual review, provenance,
license metadata, normalization, and in-engine animation/readability validation.

## Prompt Contracts

Asset prompts must specify consistent camera, tile scale, palette, lighting direction,
character proportions, transparent background, animation sheet layout, and exclusions.

## Evaluation

Evaluate generated assets at actual game zoom for silhouette, animation continuity,
seamless tiling, alpha edges, palette cohesion, and compatibility with declared footprints.

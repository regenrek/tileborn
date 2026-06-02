import type { RenderableEntity } from "../plugin/renderable-entity.js";

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

const clampAlpha = (alpha: number): number =>
  Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;

/**
 * The single source of snapshot position interpolation.
 *
 * Given the `current` snapshot's renderable entities and the `previous`
 * snapshot's renderable entities (matched by id), lerp each entity's world-space
 * position toward `current` by `alpha`. Entities without a `previous` match
 * (newly spawned) render at their current position; non-positional fields
 * (asset, rotation, scale, animation) are always taken from the current entity
 * so the freshest gameplay state is shown.
 *
 * Both the follow-camera and the renderer must consume this result so the camera
 * tracks the same smoothed position the sprites are drawn at. Anchoring the
 * camera to the discrete latest snapshot instead reintroduces tick-rate stutter
 * even when the renderer lerps sprites.
 */
export const interpolateRenderableEntities = (
  current: readonly RenderableEntity[],
  previous: readonly RenderableEntity[],
  alpha: number,
): RenderableEntity[] => {
  const resolved = clampAlpha(alpha);
  if (previous.length === 0 || resolved >= 1) {
    return [...current];
  }

  const previousById = new Map<string, RenderableEntity>();
  for (const entity of previous) {
    previousById.set(entity.id, entity);
  }

  return current.map((entity) => {
    const prior = previousById.get(entity.id);
    if (prior === undefined) {
      return entity;
    }
    return {
      ...entity,
      x: lerp(prior.x, entity.x, resolved),
      y: lerp(prior.y, entity.y, resolved),
    };
  });
};

import { PositionComponent } from '../ecs/components.js';
import type { System } from '../ecs/systems.js';
import { resolveCircleRect } from './circle-rect.js';
import type { CollisionEnvironment } from './environment.js';

export interface CollisionFootprint {
  readonly radius: number;
  readonly offsetY: number;
}

export const createCollisionSystem = (
  environment: CollisionEnvironment,
  footprint: CollisionFootprint,
): System => ({
  name: 'collision',
  query: [PositionComponent],
  dependsOn: ['movement'],
  update: (world) => {
    world.query([PositionComponent], (_entity, position) => {
      for (const rect of environment.blockingRects) {
        resolveCircleRect(position, rect, footprint.radius, footprint.offsetY);
      }
    });
  },
});

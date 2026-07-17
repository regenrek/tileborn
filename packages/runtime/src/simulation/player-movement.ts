import { PositionComponent, VelocityComponent } from '../ecs/components.js';
import type { System } from '../ecs/systems.js';
import { InputCommand } from '../input/input.js';

export const PLAYER_SPEED_PX_PER_SECOND = 260;
export const MOVEMENT_TICK_RATE_HZ = 60;
export const PLAYER_FOOTPRINT_RADIUS = 8;
export const PLAYER_FOOTPRINT_OFFSET_Y = 14;

export const normalizeMovementInput = (
  moveX: number,
  moveY: number,
): { readonly x: number; readonly y: number } => {
  const x = clamp(moveX, -127, 127) / 127;
  const y = clamp(moveY, -127, 127) / 127;
  const length = Math.hypot(x, y);
  return length <= 1 ? { x, y } : { x: x / length, y: y / length };
};

export const createPlayerInputMovementSystem = (): System => ({
  name: 'movement',
  query: [PositionComponent, VelocityComponent],
  update: (world, dt, context) => {
    const command = context.input as InputCommand;
    const vector = normalizeMovementInput(command.moveX * 127, command.moveY * 127);
    world.query([PositionComponent, VelocityComponent], (_entity, position, velocity) => {
      velocity.x = vector.x * PLAYER_SPEED_PX_PER_SECOND;
      velocity.y = vector.y * PLAYER_SPEED_PX_PER_SECOND;
      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
    });
  },
});

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

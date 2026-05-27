import type { CollisionRect } from "./rect.js";

/** Lifted from `@tileborne/runtime` collision parity helper. */
export const resolveCircleRect = (
  player: { x: number; y: number },
  rect: CollisionRect,
  playerRadius: number,
  offsetY: number,
): void => {
  const centerX = player.x;
  const centerY = player.y + offsetY;
  const closestX = clamp(centerX, rect.x, rect.x + rect.width);
  const closestY = clamp(centerY, rect.y, rect.y + rect.height);
  const dx = centerX - closestX;
  const dy = centerY - closestY;
  const distance = Math.hypot(dx, dy);
  if (distance >= playerRadius || distance === 0) {
    if (distance !== 0) {
      return;
    }
    const left = Math.abs(centerX - rect.x);
    const right = Math.abs(centerX - (rect.x + rect.width));
    const top = Math.abs(centerY - rect.y);
    const bottom = Math.abs(centerY - (rect.y + rect.height));
    const min = Math.min(left, right, top, bottom);
    if (min === left) player.x = rect.x - playerRadius;
    else if (min === right) player.x = rect.x + rect.width + playerRadius;
    else if (min === top) player.y = rect.y - offsetY - playerRadius;
    else player.y = rect.y + rect.height - offsetY + playerRadius;
    return;
  }
  const push = playerRadius - distance;
  player.x += (dx / distance) * push;
  player.y += (dy / distance) * push;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const circleOverlapsRect = (
  centerX: number,
  centerY: number,
  radius: number,
  rect: CollisionRect,
): boolean => {
  const closestX = clamp(centerX, rect.x, rect.x + rect.width);
  const closestY = clamp(centerY, rect.y, rect.y + rect.height);
  const dx = centerX - closestX;
  const dy = centerY - closestY;
  return dx * dx + dy * dy < radius * radius;
};

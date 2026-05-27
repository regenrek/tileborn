export type InputDirection = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const MOVEMENT_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
]);

export const isPlaytestMovementKey = (code: string): boolean => MOVEMENT_KEYS.has(code);

/**
 * Compute the integer aim angle in degrees [0, 359] from a pointer position to
 * the local player position. The coordinate system follows DOM screen-space
 * convention (y grows downward); `0°` points east, `90°` south, `180°` west,
 * `270°` north. ADR-0014 Phase 1: aimDeg is sent through the BR plugin's
 * ClientInputFrame.aimDeg field; absent value means "use last direction".
 */
export const computeAimDeg = (
  pointerX: number,
  pointerY: number,
  playerScreenX: number,
  playerScreenY: number,
): number => {
  const dx = pointerX - playerScreenX;
  const dy = pointerY - playerScreenY;
  if (dx === 0 && dy === 0) {
    return 0;
  }
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  const normalized = ((Math.round(raw) % 360) + 360) % 360;
  return normalized;
};

/**
 * Maximum digit weapon-slot the renderer accepts. The BR plugin treats
 * weaponSlot as an opaque int; the renderer just forwards the key value.
 */
export const WEAPON_SLOT_MIN = 1;
export const WEAPON_SLOT_MAX = 5;

/**
 * Parse a KeyboardEvent.code like `Digit3` (top row) or `Numpad3` into a
 * weapon slot in [WEAPON_SLOT_MIN, WEAPON_SLOT_MAX]. Returns `undefined` for
 * non-digit codes or out-of-range digits.
 */
export const parseWeaponSlotKey = (code: string): number | undefined => {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (!match) {
    return undefined;
  }
  const slot = Number.parseInt(match[1] as string, 10);
  if (!Number.isInteger(slot) || slot < WEAPON_SLOT_MIN || slot > WEAPON_SLOT_MAX) {
    return undefined;
  }
  return slot;
};

export const movementKeysToDirection = (pressed: ReadonlySet<string>): InputDirection | undefined => {
  let dx = 0;
  let dy = 0;
  if (pressed.has("ArrowRight") || pressed.has("KeyD")) {
    dx += 1;
  }
  if (pressed.has("ArrowLeft") || pressed.has("KeyA")) {
    dx -= 1;
  }
  if (pressed.has("ArrowDown") || pressed.has("KeyS")) {
    dy += 1;
  }
  if (pressed.has("ArrowUp") || pressed.has("KeyW")) {
    dy -= 1;
  }

  if (dx === 0 && dy === 0) {
    return undefined;
  }
  if (dx === 1 && dy === 0) {
    return 0;
  }
  if (dx === 1 && dy === 1) {
    return 1;
  }
  if (dx === 0 && dy === 1) {
    return 2;
  }
  if (dx === -1 && dy === 1) {
    return 3;
  }
  if (dx === -1 && dy === 0) {
    return 4;
  }
  if (dx === -1 && dy === -1) {
    return 5;
  }
  if (dx === 0 && dy === -1) {
    return 6;
  }
  return 7;
};

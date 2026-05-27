export const ROOM_SCHEMA_VERSION = 1 as const;

export const TICK_HZ = 20;
export const TICK_INTERVAL_MS = 1000 / TICK_HZ;
export const PERSIST_EVERY_N_TICKS = 100;
export const HEARTBEAT_TIMEOUT_MS = 30_000;
export const DEFAULT_ROOM_IDLE_TIMEOUT_SECONDS = 60;
export const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = HEARTBEAT_TIMEOUT_MS / 1000;
export const MIN_HANDOFF_SIGNING_KEY_LENGTH = 32;
export const INVALID_HANDOFF_CLOSE_CODE = 4001;

export const roomIdleTimeoutMs = (seconds: number | undefined): number =>
  (seconds ?? DEFAULT_ROOM_IDLE_TIMEOUT_SECONDS) * 1000;

export const heartbeatTimeoutMs = (seconds: number | string | undefined): number => {
  const parsed =
    typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  const resolved = parsed !== undefined && Number.isFinite(parsed) ? parsed : DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;
  return resolved * 1000;
};

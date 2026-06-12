import { describe, expect, it } from "vitest";

import {
  assertHandoffSigningKey,
  isHandoffSigningKeyValid,
  mintHandoffToken,
  PLACEHOLDER_HANDOFF_SIGNING_KEY,
  verifyHandoffToken,
} from "../rooms/handoff-token.js";

const TEST_KEY = "test-handoff-signing-key-32-bytes!!";
const env = { HANDOFF_SIGNING_KEY: TEST_KEY };

describe("handoff token", () => {
  it("mints and verifies a token for the expected playtest", async () => {
    const token = await mintHandoffToken(env, {
      playtestId: "room-1",
      playerId: "player-1",
      ttlSeconds: 120,
    });
    const verified = await verifyHandoffToken(env, token, { playtestId: "room-1" });
    expect(verified).toEqual({ playerId: "player-1" });
  });

  it("rejects expired tokens", async () => {
    const token = await mintHandoffToken(env, {
      playtestId: "room-1",
      playerId: "player-1",
      ttlSeconds: -10,
    });
    const verified = await verifyHandoffToken(env, token, { playtestId: "room-1" });
    expect(verified).toBeNull();
  });

  it("rejects tampered signatures", async () => {
    const token = await mintHandoffToken(env, {
      playtestId: "room-1",
      playerId: "player-1",
      ttlSeconds: 120,
    });
    const tampered = `${token}x`;
    expect(await verifyHandoffToken(env, tampered, { playtestId: "room-1" })).toBeNull();
  });

  it("rejects tokens for a different playtest id", async () => {
    const token = await mintHandoffToken(env, {
      playtestId: "room-1",
      playerId: "player-1",
      ttlSeconds: 120,
    });
    expect(await verifyHandoffToken(env, token, { playtestId: "room-2" })).toBeNull();
  });

  it("returns null when signing key is missing", async () => {
    const token = await mintHandoffToken(env, {
      playtestId: "room-1",
      playerId: "player-1",
      ttlSeconds: 120,
    });
    expect(await verifyHandoffToken({}, token, { playtestId: "room-1" })).toBeNull();
  });

  it("validates signing key length at boot", () => {
    expect(isHandoffSigningKeyValid(env)).toBe(true);
    expect(isHandoffSigningKeyValid({ HANDOFF_SIGNING_KEY: "short" })).toBe(false);
    expect(() => assertHandoffSigningKey({ HANDOFF_SIGNING_KEY: "short" })).toThrow(/HANDOFF_SIGNING_KEY/);
  });

  it("rejects the known placeholder key even though it passes the length check", () => {
    expect(PLACEHOLDER_HANDOFF_SIGNING_KEY.length).toBeGreaterThanOrEqual(32);
    expect(isHandoffSigningKeyValid({ HANDOFF_SIGNING_KEY: PLACEHOLDER_HANDOFF_SIGNING_KEY })).toBe(
      false,
    );
    expect(() =>
      assertHandoffSigningKey({ HANDOFF_SIGNING_KEY: PLACEHOLDER_HANDOFF_SIGNING_KEY }),
    ).toThrow(/placeholder/);
  });
});

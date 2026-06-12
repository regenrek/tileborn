import { MIN_HANDOFF_SIGNING_KEY_LENGTH } from "./room-config.js";

export interface HandoffTokenPayload {
  readonly playtestId: string;
  readonly playerId: string;
  readonly exp: number;
}

export interface HandoffSigningEnv {
  readonly HANDOFF_SIGNING_KEY?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The historical scaffold/template placeholder key. It is long enough to pass
 * the length check, so it is rejected explicitly: a deployed worker must never
 * sign handoff tokens with a publicly-known key.
 */
export const PLACEHOLDER_HANDOFF_SIGNING_KEY = "replace-me-in-production-32-chars-minimum";

export const isHandoffSigningKeyValid = (env: HandoffSigningEnv): boolean => {
  const key = env.HANDOFF_SIGNING_KEY;
  return (
    typeof key === "string" &&
    key.length >= MIN_HANDOFF_SIGNING_KEY_LENGTH &&
    key !== PLACEHOLDER_HANDOFF_SIGNING_KEY
  );
};

export const assertHandoffSigningKey = (env: HandoffSigningEnv): void => {
  if (!isHandoffSigningKeyValid(env)) {
    throw new Error("HANDOFF_SIGNING_KEY is missing, too short, or the known placeholder");
  }
};

const importHmacKey = async (env: HandoffSigningEnv): Promise<CryptoKey> => {
  assertHandoffSigningKey(env);
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.HANDOFF_SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
};

const canonicalPayload = (payload: HandoffTokenPayload): string =>
  JSON.stringify({
    exp: payload.exp,
    playerId: payload.playerId,
    playtestId: payload.playtestId,
  });

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const mintHandoffToken = async (
  env: HandoffSigningEnv,
  input: { readonly playtestId: string; readonly playerId: string; readonly ttlSeconds: number },
): Promise<string> => {
  const key = await importHmacKey(env);
  const exp = Math.floor(Date.now() / 1000) + input.ttlSeconds;
  const payload: HandoffTokenPayload = {
    playtestId: input.playtestId,
    playerId: input.playerId,
    exp,
  };
  const canonical = canonicalPayload(payload);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return `${toBase64Url(encoder.encode(canonical))}.${toBase64Url(new Uint8Array(signature))}`;
};

export const verifyHandoffToken = async (
  env: HandoffSigningEnv,
  token: string,
  expected: { readonly playtestId: string },
): Promise<{ readonly playerId: string } | null> => {
  if (!isHandoffSigningKeyValid(env)) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const payloadPart = parts[0];
  const signaturePart = parts[1];
  if (!payloadPart || !signaturePart) {
    return null;
  }
  let payloadJson: string;
  try {
    payloadJson = decoder.decode(fromBase64Url(payloadPart));
  } catch {
    return null;
  }
  let parsed: HandoffTokenPayload;
  try {
    parsed = JSON.parse(payloadJson) as HandoffTokenPayload;
  } catch {
    return null;
  }
  if (
    typeof parsed.playtestId !== "string" ||
    typeof parsed.playerId !== "string" ||
    typeof parsed.exp !== "number"
  ) {
    return null;
  }
  if (parsed.playtestId !== expected.playtestId) {
    return null;
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  const key = await importHmacKey(env);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    new Uint8Array(fromBase64Url(signaturePart)),
    encoder.encode(canonicalPayload(parsed)),
  );
  if (!valid) {
    return null;
  }
  return { playerId: parsed.playerId };
};

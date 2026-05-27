import {
  decodeMessage,
  encodeMessage,
  Heartbeat,
  PlayerJoined,
  PlayerLeft,
  SnapshotDelta,
  WireInputCommand,
  type RuntimeMessage,
} from "@tileborne/runtime/worker";
import type { MessageEvent, WebSocket as MiniflareWebSocket } from "miniflare";

export const SMOKE_SIGNING_KEY = "smoke-handoff-signing-key-32-bytes-x";

export interface PlaytestStartPayload {
  readonly playtestId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly playerId: string;
}

export interface HealthPayload {
  readonly status: string;
  readonly version?: string;
  readonly buildId?: string;
  readonly reason?: string;
}

export interface DiscoverPayload {
  readonly plugin: { readonly id: string; readonly version: string };
  readonly assetPacks: readonly { readonly id: string; readonly version: string }[];
  readonly runtimeVersion: string;
  readonly protocolVersion: number;
  readonly buildId: string;
}

export interface StructuredErrorPayload {
  readonly error: string;
}

export const parseJson = async <T>(response: { json(): Promise<unknown> }): Promise<T> => {
  const value = await response.json();
  if (typeof value !== "object" || value === null) {
    throw new Error("expected JSON object response");
  }
  return value as T;
};

const toMessageBytes = (data: MessageEvent["data"]): Uint8Array | null => {
  if (typeof data === "string") {
    return null;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return data;
};

export const waitForMessage = async (
  socket: MiniflareWebSocket,
  predicate: (message: RuntimeMessage) => boolean,
  options: { readonly timeoutMs: number; readonly label: string },
): Promise<RuntimeMessage> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${options.label} after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    const onMessage = (event: MessageEvent): void => {
      const bytes = toMessageBytes(event.data);
      if (!bytes) {
        return;
      }
      const decoded = decodeMessage(bytes);
      if (predicate(decoded)) {
        cleanup();
        resolve(decoded);
      }
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
    };
    socket.addEventListener("message", onMessage);
  });

export const collectMessages = async (
  socket: MiniflareWebSocket,
  durationMs: number,
): Promise<readonly RuntimeMessage[]> => {
  const messages: RuntimeMessage[] = [];
  const onMessage = (event: MessageEvent): void => {
    const bytes = toMessageBytes(event.data);
    if (!bytes) {
      return;
    }
    messages.push(decodeMessage(bytes));
  };
  socket.addEventListener("message", onMessage);
  await delay(durationMs);
  socket.removeEventListener("message", onMessage);
  return messages;
};

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const expectPlayerJoined = (message: RuntimeMessage, playerId: string): void => {
  if (message._tag !== "PlayerJoined") {
    throw new Error(`expected PlayerJoined, got ${message._tag}`);
  }
  if (message.playerId !== playerId) {
    throw new Error(`expected PlayerJoined for ${playerId}, got ${message.playerId}`);
  }
};

export const findPlayerJoined = (
  messages: readonly RuntimeMessage[],
  playerId: string,
): PlayerJoined | undefined => {
  const match = messages.find((message) => message._tag === "PlayerJoined" && message.playerId === playerId);
  return match?._tag === "PlayerJoined" ? match : undefined;
};

export const findPlayerLeft = (
  messages: readonly RuntimeMessage[],
  playerId: string,
): PlayerLeft | undefined => {
  const match = messages.find((message) => message._tag === "PlayerLeft" && message.playerId === playerId);
  return match?._tag === "PlayerLeft" ? match : undefined;
};

export const findSnapshotDelta = (messages: readonly RuntimeMessage[]): SnapshotDelta | undefined => {
  const match = messages.find((message) => message._tag === "SnapshotDelta");
  return match?._tag === "SnapshotDelta" ? match : undefined;
};

export const encodeInputCommand = (playerId: string, frame: number, command: Record<string, string>): ArrayBuffer => {
  const bytes = encodeMessage(
    new WireInputCommand({
      playerId,
      frame,
      command,
    }),
  );
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export const encodeHeartbeat = (): ArrayBuffer => {
  const bytes = encodeMessage(new Heartbeat({}));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export const tamperHandoffToken = (token: string): string => {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return `${token}.tampered`;
  }
  const lastChar = signature.at(-1) ?? "a";
  const flipped = lastChar === "a" ? "b" : "a";
  return `${payload}.${signature.slice(0, -1)}${flipped}`;
};

export const waitForWebSocketClose = (
  socket: MiniflareWebSocket,
  expectedCode: number,
  timeoutMs: number,
): Promise<{ readonly code: number; readonly reason: string }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for WebSocket close code ${expectedCode}`));
    }, timeoutMs);
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      resolve({ code: event.code, reason: event.reason });
    });
    if (socket.readyState === WebSocket.CLOSED) {
      clearTimeout(timer);
      reject(new Error("socket already closed before listener attached"));
    }
  });

import type { Effect } from "effect";

import type { IpcTransportError } from "../errors.js";

export interface IpcClientTransport {
  invoke(channel: string, payload: unknown): Effect.Effect<unknown, IpcTransportError>;
  subscribe(channel: string, onPayload: (raw: unknown) => void): () => void;
}

export interface IpcServerTransport {
  handle(channel: string, fn: (payload: unknown) => Promise<unknown>): () => void;
  emit(channel: string, payload: unknown): void;
}


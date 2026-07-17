/**
 * Raw IPC transport exposed by the preload script as `window.tileborneIpc`.
 *
 * Only plain wire JSON crosses this surface — Electron's `contextBridge`
 * structured-clones every value, which strips class prototypes and `Option`
 * identity. The typed bridge (schema decode/encode) is therefore built in the
 * RENDERER realm on top of this transport, so decoded schema instances never
 * cross the bridge.
 */
export interface TileborneIpcTransport {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  subscribe(channel: string, onPayload: (payload: unknown) => void): () => void;
}

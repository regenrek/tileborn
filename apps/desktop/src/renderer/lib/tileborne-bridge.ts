import {
  buildTileborneBridge,
  MainEventRegistry,
  MainIpcRegistry,
  type IpcClientTransport,
  type MainTileborneBridge,
} from '@tileborne/ipc-contracts/bridge';
import { Effect } from 'effect';

import type { TileborneIpcTransport } from '../../shared/ipc-transport';

const toContractTransport = (transport: TileborneIpcTransport): IpcClientTransport => ({
  invoke: (channel, payload) =>
    Effect.tryPromise({
      try: () => transport.invoke(channel, payload),
      catch: (error) => error,
    }) as IpcClientTransport['invoke'] extends (channel: string, payload: unknown) => infer Result
      ? Result
      : never,
  subscribe: (channel, onPayload) => transport.subscribe(channel, onPayload),
});

/**
 * Build the typed `window.tileborne` bridge IN THE RENDERER REALM on top of
 * the raw preload transport. Decoding here (instead of in the preload) is
 * what keeps schema class instances and `Option` identity intact — anything
 * decoded on the preload side would be structured-cloned (and stripped) by
 * `contextBridge`. Per-channel timeouts are owned by each contract's
 * `meta.timeoutMs` and applied inside the client.
 */
export const buildTileborneRendererBridge = (
  transport: TileborneIpcTransport,
): MainTileborneBridge =>
  buildTileborneBridge(
    MainIpcRegistry,
    MainEventRegistry,
    toContractTransport(transport),
    Effect.runPromise,
  );

/** Install the typed bridge as `window.tileborne`. Call once at app bootstrap. */
export const installTileborneBridge = (): void => {
  Object.defineProperty(window, 'tileborne', {
    value: buildTileborneRendererBridge(window.tileborneIpc),
    configurable: true,
  });
};

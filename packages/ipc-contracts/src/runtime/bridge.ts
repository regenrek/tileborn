import type { Effect } from "effect";

import {
  TILEBORNE_IPC_DOMAIN_PREFIXES,
  type EventSubscribersOf,
  type IpcBridgeOf,
  type IpcClientOf,
  type Unsubscribe,
} from "../codegen-shape.js";
import type { IpcEventRegistry } from "../events-core.js";
import type { IpcRegistry } from "../registry.js";
import { createIpcClient } from "./client.js";
import { createEventSubscriber, type IpcEventSubscriberOf } from "./events.js";
import type { IpcClientTransport } from "./transport.js";

const capitalizeKebab = (segment: string): string =>
  segment
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`))
    .join("");

/**
 * Type-level twin: `EventHandlerName<Channel>` in `codegen-shape.ts`. Any change here must mirror
 * there so `EventSubscribersOf<R>` and `buildEventBridge` stay in lockstep.
 */
export const toEventHandlerName = (channel: string): string => {
  const match = /^tileborne:([a-z][a-z0-9-]*):([a-z][a-zA-Z0-9-]*)$/.exec(channel);
  if (!match) {
    throw new Error(`Unknown IPC event channel: ${channel}`);
  }
  return `on${capitalizeKebab(match[1]!)}${capitalizeKebab(match[2]!)}`;
};

const bindDomainMethods = <Client extends IpcClientOf<IpcRegistry>>(
  client: Client,
  prefix: string,
  run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
): Record<string, (...args: never[]) => Promise<unknown>> => {
  const domain: Record<string, (...args: never[]) => Promise<unknown>> = {};
  const channelPrefix = `${prefix}:`;

  for (const channel of Object.keys(client)) {
    if (!channel.startsWith(channelPrefix)) {
      continue;
    }

    const method = channel.slice(channelPrefix.length);
    const invoke = client[channel as keyof Client & string];
    if (typeof invoke !== "function") {
      continue;
    }

    domain[method] = (request: never) =>
      run((invoke as (input: never) => Effect.Effect<unknown, unknown>)(request));
  }

  return domain;
};

export const buildIpcBridge = <Registry extends IpcRegistry>(
  client: IpcClientOf<Registry>,
  run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
): IpcBridgeOf<Registry> => {
  const bridge = {} as Record<string, Record<string, (...args: never[]) => Promise<unknown>>>;

  for (const [domain, prefix] of Object.entries(TILEBORNE_IPC_DOMAIN_PREFIXES)) {
    bridge[domain] = bindDomainMethods(client, prefix, run);
  }

  return bridge as IpcBridgeOf<Registry>;
};

export const buildEventBridge = <Registry extends IpcEventRegistry>(
  subscriber: IpcEventSubscriberOf<Registry>,
): EventSubscribersOf<Registry> => {
  const bridge = {} as Record<
    string,
    (handler: (payload: unknown) => void) => Unsubscribe
  >;

  for (const channel of Object.keys(subscriber)) {
    const subscribe = subscriber[channel as keyof IpcEventSubscriberOf<Registry>];
    if (subscribe === undefined) {
      continue;
    }

    bridge[toEventHandlerName(channel)] = (handler) => subscribe(handler);
  }

  return bridge as EventSubscribersOf<Registry>;
};

export const buildTileborneBridge = <
  IpcReg extends IpcRegistry,
  EventReg extends IpcEventRegistry,
>(
  ipcRegistry: IpcReg,
  eventRegistry: EventReg,
  transport: IpcClientTransport,
  run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
): IpcBridgeOf<IpcReg> & { readonly events: EventSubscribersOf<EventReg> } => {
  const client = createIpcClient(ipcRegistry, transport);
  const subscriber = createEventSubscriber(eventRegistry, transport);

  return {
    ...buildIpcBridge(client, run),
    events: buildEventBridge(subscriber),
  };
};

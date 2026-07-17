import { Schema } from 'effect';

import { IpcChannel, makeIpcChannel } from './channel.js';

export class IpcEvent<Payload, Channel extends IpcChannel = IpcChannel> extends Schema.Class<
  IpcEvent<unknown, IpcChannel>
>('IpcEvent')({
  channel: IpcChannel,
  payload: Schema.Any,
}) {
  declare readonly channel: Channel;
  declare readonly payload: Schema.Schema<Payload>;
}

export type AnyIpcEvent = IpcEvent<unknown, IpcChannel>;

export type EventPayloadOf<Event> =
  Event extends IpcEvent<infer Payload, IpcChannel> ? Payload : never;

export type EventChannelOf<Event> =
  Event extends IpcEvent<unknown, infer Channel> ? Channel : never;

type ChannelKey<Channel> = Channel extends infer Key & IpcChannel
  ? Key extends string
    ? Key
    : never
  : never;

export type IpcEventDefinition<
  Channel extends `tileborne:${string}`,
  PayloadSchema extends Schema.Top,
> = {
  readonly channel: Channel;
  readonly payload: PayloadSchema;
};

export const defineEvent = <
  const Channel extends `tileborne:${string}`,
  PayloadSchema extends Schema.Top,
>(
  definition: IpcEventDefinition<Channel, PayloadSchema>,
): IpcEvent<PayloadSchema['Type'], Channel & IpcChannel> & { readonly payload: PayloadSchema } =>
  new IpcEvent({
    channel: makeIpcChannel(definition.channel),
    payload: definition.payload,
  }) as IpcEvent<PayloadSchema['Type'], Channel & IpcChannel> & { readonly payload: PayloadSchema };

export type EventByChannel<Events extends readonly AnyIpcEvent[]> = {
  readonly [Event in Events[number] as ChannelKey<EventChannelOf<Event>>]: Event;
};

export type IpcEventRegistry<Events extends readonly AnyIpcEvent[] = readonly AnyIpcEvent[]> = {
  readonly events: Events;
  readonly byChannel: EventByChannel<Events>;
};

export const createEventRegistry = <const Events extends readonly AnyIpcEvent[]>(
  events: Events,
): IpcEventRegistry<Events> => {
  const byChannel = new Map<string, AnyIpcEvent>();

  for (const event of events) {
    if (byChannel.has(event.channel)) {
      throw new Error(`Duplicate IPC event channel: ${event.channel}`);
    }
    byChannel.set(event.channel, event);
  }

  return {
    events,
    byChannel: Object.fromEntries(byChannel) as EventByChannel<Events>,
  };
};

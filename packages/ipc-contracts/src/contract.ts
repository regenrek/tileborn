import { Schema } from 'effect';

import { IpcChannel, makeIpcChannel } from './channel.js';

export const IpcContractMeta = Schema.Struct({
  timeoutMs: Schema.optionalKey(Schema.Number),
  requiresApproval: Schema.optionalKey(Schema.Boolean),
});

export type IpcContractMeta = typeof IpcContractMeta.Type;

export class IpcContract<
  Req,
  Res,
  Err,
  Channel extends IpcChannel = IpcChannel,
> extends Schema.Class<IpcContract<unknown, unknown, unknown, IpcChannel>>('IpcContract')({
  channel: IpcChannel,
  request: Schema.Any,
  response: Schema.Any,
  errors: Schema.Any,
  meta: Schema.optionalKey(IpcContractMeta),
}) {
  declare readonly channel: Channel;
  declare readonly request: Schema.Schema<Req>;
  declare readonly response: Schema.Schema<Res>;
  declare readonly errors: Schema.Schema<Err>;
  declare readonly meta?: IpcContractMeta;
}

export type AnyIpcContract = IpcContract<unknown, unknown, unknown, IpcChannel>;

export type RequestOf<Contract> =
  Contract extends IpcContract<infer Req, unknown, unknown, IpcChannel> ? Req : never;

export type ResponseOf<Contract> =
  Contract extends IpcContract<unknown, infer Res, unknown, IpcChannel> ? Res : never;

export type ErrorOf<Contract> =
  Contract extends IpcContract<unknown, unknown, infer Err, IpcChannel> ? Err : never;

export type ChannelOf<Contract> =
  Contract extends IpcContract<unknown, unknown, unknown, infer Channel> ? Channel : never;

export type IpcContractDefinition<
  Channel extends `tileborne:${string}`,
  RequestSchema extends Schema.Top,
  ResponseSchema extends Schema.Top,
  ErrorSchema extends Schema.Top,
> = {
  readonly channel: Channel;
  readonly request: RequestSchema;
  readonly response: ResponseSchema;
  readonly errors: ErrorSchema;
  readonly meta?: {
    readonly timeoutMs?: number;
    readonly requiresApproval?: boolean;
  };
};

export const defineContract = <
  const Channel extends `tileborne:${string}`,
  RequestSchema extends Schema.Top,
  ResponseSchema extends Schema.Top,
  ErrorSchema extends Schema.Top,
>(
  definition: IpcContractDefinition<Channel, RequestSchema, ResponseSchema, ErrorSchema>,
): IpcContract<
  RequestSchema['Type'],
  ResponseSchema['Type'],
  ErrorSchema['Type'],
  Channel & IpcChannel
> & {
  readonly request: RequestSchema;
  readonly response: ResponseSchema;
  readonly errors: ErrorSchema;
} =>
  new IpcContract({
    channel: makeIpcChannel(definition.channel),
    request: definition.request,
    response: definition.response,
    errors: definition.errors,
    ...(definition.meta !== undefined ? { meta: definition.meta } : {}),
  }) as IpcContract<
    RequestSchema['Type'],
    ResponseSchema['Type'],
    ErrorSchema['Type'],
    Channel & IpcChannel
  > & {
    readonly request: RequestSchema;
    readonly response: ResponseSchema;
    readonly errors: ErrorSchema;
  };

import type { Effect, Schema } from 'effect';

import type { ErrorOf, RequestOf, ResponseOf } from './contract.js';
import type {
  IpcDecodeError,
  IpcSerializationError,
  IpcTimeoutError,
  IpcTransportError,
  IpcValidationError,
} from './errors.js';
import type { IpcEventRegistry } from './events-core.js';
import type { IpcRegistry } from './registry.js';

export type IpcClientRuntimeError =
  | IpcSerializationError
  | IpcTimeoutError
  | IpcTransportError
  | IpcValidationError
  | IpcDecodeError;

export type Unsubscribe = () => void;

type DecodedRequestOf<Contract> = Contract extends {
  readonly request: infer RequestSchema extends Schema.Top;
}
  ? Schema.Schema.Type<RequestSchema>
  : never;

type DecodedResponseOf<Contract> = Contract extends {
  readonly response: infer ResponseSchema extends Schema.Top;
}
  ? Schema.Schema.Type<ResponseSchema>
  : never;

type RegistryChannels<Registry extends IpcRegistry> = keyof Registry['byChannel'] & string;

type EventChannels<Registry extends IpcEventRegistry> = keyof Registry['byChannel'] & string;

type ContractAtChannel<
  Registry extends IpcRegistry,
  Channel extends RegistryChannels<Registry>,
> = NonNullable<Registry['byChannel'][Channel]>;

export type IpcClientOf<Registry extends IpcRegistry> = {
  readonly [Channel in RegistryChannels<Registry>]: (
    request: DecodedRequestOf<ContractAtChannel<Registry, Channel>>,
  ) => Effect.Effect<
    DecodedResponseOf<ContractAtChannel<Registry, Channel>>,
    ErrorOf<ContractAtChannel<Registry, Channel>> | IpcClientRuntimeError
  >;
};

type HandlerContractAtChannel<
  Registry extends IpcRegistry,
  Channel extends RegistryChannels<Registry>,
> = Channel extends RegistryChannels<Registry> ? ContractAtChannel<Registry, Channel> : never;

export type IpcHandlerAtChannel<
  Registry extends IpcRegistry,
  Channel extends RegistryChannels<Registry>,
> = (
  request: RequestOf<HandlerContractAtChannel<Registry, Channel>>,
) => Effect.Effect<
  ResponseOf<HandlerContractAtChannel<Registry, Channel>>,
  ErrorOf<HandlerContractAtChannel<Registry, Channel>>
>;

export type IpcHandlersOf<Registry extends IpcRegistry> = {
  [Channel in keyof Registry['byChannel'] & string]: IpcHandlerAtChannel<Registry, Channel>;
};

export type IpcHandlerGroupOf<
  Registry extends IpcRegistry,
  Channels extends keyof IpcHandlersOf<Registry> & string,
> = Pick<IpcHandlersOf<Registry>, Channels>;

type ChannelMethodName<
  Channel extends string,
  Prefix extends string,
> = Channel extends `${Prefix}:${infer Method}` ? Method : never;

type ChannelsForPrefix<Prefix extends string, Registry extends IpcRegistry> = Extract<
  RegistryChannels<Registry>,
  `${Prefix}:${string}`
>;

type UnionToIntersection<U> = (U extends unknown ? (argument: U) => void : never) extends (
  argument: infer I,
) => void
  ? I
  : never;

type ChannelBridgeEntry<
  Prefix extends string,
  Registry extends IpcRegistry,
  Channel extends RegistryChannels<Registry>,
> = Channel extends `${Prefix}:${string}`
  ? {
      readonly [Method in ChannelMethodName<Channel, Prefix>]: (
        request: DecodedRequestOf<ContractAtChannel<Registry, Channel>>,
      ) => Promise<DecodedResponseOf<ContractAtChannel<Registry, Channel>>>;
    }
  : never;

type ChannelBridgeEntryUnion<Prefix extends string, Registry extends IpcRegistry> =
  ChannelsForPrefix<Prefix, Registry> extends infer Channel
    ? Channel extends RegistryChannels<Registry>
      ? ChannelBridgeEntry<Prefix, Registry, Channel>
      : never
    : never;

type IpcDomainBridge<Prefix extends string, Registry extends IpcRegistry> = UnionToIntersection<
  ChannelBridgeEntryUnion<Prefix, Registry>
>;

export const TILEBORNE_IPC_DOMAIN_PREFIXES = {
  projects: 'tileborne:projects',
  behaviors: 'tileborne:behaviors',
  maps: 'tileborne:maps',
  assets: 'tileborne:assets',
  audio: 'tileborne:audio',
  gameShell: 'tileborne:game-shell',
  assetLibrary: 'tileborne:asset-library',
  workingPalettes: 'tileborne:working-palettes',
  catalog: 'tileborne:catalog',
  readiness: 'tileborne:readiness',
  plugins: 'tileborne:plugins',
  jobs: 'tileborne:jobs',
  logs: 'tileborne:logs',
  tiledImport: 'tileborne:tiled-import',
  builds: 'tileborne:builds',
  exports: 'tileborne:exports',
  tiledSourceRules: 'tileborne:tiled-source-rules',
  playtest: 'tileborne:playtest',
  runtime: 'tileborne:runtime',
  runtimeDeploy: 'tileborne:runtime-deploy',
  ship: 'tileborne:ship',
  support: 'tileborne:support',
  system: 'tileborne:system',
} as const;

export type TileborneIpcDomainPrefixes = typeof TILEBORNE_IPC_DOMAIN_PREFIXES;

export type IpcBridgeOf<Registry extends IpcRegistry> = {
  readonly [Domain in keyof TileborneIpcDomainPrefixes]: IpcDomainBridge<
    TileborneIpcDomainPrefixes[Domain],
    Registry
  >;
};

type CapitalizeKebab<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Capitalize<Head>}${CapitalizeKebab<Tail>}`
  : Capitalize<S>;

type EventHandlerName<Channel extends string> =
  Channel extends `tileborne:${infer Domain}:${infer Verb}`
    ? `on${CapitalizeKebab<Domain>}${CapitalizeKebab<Verb>}`
    : never;

type EventAtChannel<
  Registry extends IpcEventRegistry,
  Channel extends EventChannels<Registry>,
> = NonNullable<Registry['byChannel'][Channel]>;

type EventPayloadTypeAtChannel<
  Registry extends IpcEventRegistry,
  Channel extends EventChannels<Registry>,
> =
  EventAtChannel<Registry, Channel> extends {
    readonly payload: infer PayloadSchema extends Schema.Top;
  }
    ? Schema.Schema.Type<PayloadSchema>
    : never;

type EventBridgeEntry<
  Registry extends IpcEventRegistry,
  Channel extends EventChannels<Registry>,
> = {
  readonly [Handler in EventHandlerName<Channel>]: (
    handler: (payload: EventPayloadTypeAtChannel<Registry, Channel>) => void,
  ) => Unsubscribe;
};

type EventBridgeEntryUnion<Registry extends IpcEventRegistry> =
  EventChannels<Registry> extends infer Channel
    ? Channel extends EventChannels<Registry>
      ? EventBridgeEntry<Registry, Channel>
      : never
    : never;

export type EventSubscribersOf<Registry extends IpcEventRegistry> = UnionToIntersection<
  EventBridgeEntryUnion<Registry>
>;

export type IpcEventBridgeOf<Registry extends IpcEventRegistry> = EventSubscribersOf<Registry>;

export type TileborneBridgeOf<
  IpcReg extends IpcRegistry,
  EventReg extends IpcEventRegistry,
> = IpcBridgeOf<IpcReg> & {
  readonly events: EventSubscribersOf<EventReg>;
};

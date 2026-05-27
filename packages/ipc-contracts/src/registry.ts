import type { AnyIpcContract, ChannelOf } from "./contract.js";

type ChannelKey<Channel> = Channel extends infer Key & ChannelOf<AnyIpcContract>
  ? Key extends string
    ? Key
    : never
  : never;

export type ContractByChannel<Contracts extends readonly AnyIpcContract[]> = {
  readonly [Contract in Contracts[number] as ChannelKey<ChannelOf<Contract>>]: Contract;
};

export type IpcRegistry<Contracts extends readonly AnyIpcContract[] = readonly AnyIpcContract[]> = {
  readonly contracts: Contracts;
  readonly byChannel: ContractByChannel<Contracts>;
};

export const createRegistry = <const Contracts extends readonly AnyIpcContract[]>(
  contracts: Contracts,
): IpcRegistry<Contracts> => {
  const byChannel = new Map<string, AnyIpcContract>();

  for (const contract of contracts) {
    if (byChannel.has(contract.channel)) {
      throw new Error(`Duplicate IPC channel: ${contract.channel}`);
    }
    byChannel.set(contract.channel, contract);
  }

  return {
    contracts,
    byChannel: Object.fromEntries(byChannel) as ContractByChannel<Contracts>,
  };
};

export const getContract = <
  Registry extends IpcRegistry,
  Channel extends keyof Registry["byChannel"] & string,
>(
  registry: Registry,
  channel: Channel,
): Registry["byChannel"][Channel] =>
  (registry.byChannel as Record<Channel, Registry["byChannel"][Channel]>)[channel];

import { Option, Result, Schema } from 'effect';

const CHANNEL_PREFIX = 'tileborne:';

export const IpcChannel = Schema.String.check(
  Schema.isPattern(/^tileborne:[a-z][a-z0-9-]*(?::[a-z][a-zA-Z0-9-]*)+$/),
).pipe(Schema.brand('IpcChannel'));

export type IpcChannel = typeof IpcChannel.Type;

export const isIpcChannel = (input: unknown): input is IpcChannel =>
  Option.isSome(Schema.decodeUnknownOption(IpcChannel)(input));

export const parseIpcChannel = (input: unknown): Result.Result<IpcChannel, string> => {
  const decoded = Schema.decodeUnknownOption(IpcChannel)(input);
  return Option.match(decoded, {
    onNone: () => Result.fail(`IPC channel must be a ${CHANNEL_PREFIX} namespaced string`),
    onSome: Result.succeed,
  });
};

export const makeIpcChannel = <const Channel extends `tileborne:${string}`>(
  channel: Channel,
): Channel & IpcChannel => Schema.decodeUnknownSync(IpcChannel)(channel) as Channel & IpcChannel;

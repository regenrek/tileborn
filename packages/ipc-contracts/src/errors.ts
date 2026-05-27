import { Schema } from "effect";

import { IpcChannel } from "./channel.js";

export class IpcChannelNotFoundError extends Schema.TaggedErrorClass<IpcChannelNotFoundError>()(
  "IpcChannelNotFoundError",
  {
    channel: Schema.String,
    message: Schema.String,
  },
) {}

export class IpcValidationError extends Schema.TaggedErrorClass<IpcValidationError>()(
  "IpcValidationError",
  {
    channel: Schema.OptionFromUndefinedOr(IpcChannel),
    message: Schema.String,
    issues: Schema.Array(Schema.String),
  },
) {}

export class IpcTimeoutError extends Schema.TaggedErrorClass<IpcTimeoutError>()("IpcTimeoutError", {
  channel: IpcChannel,
  timeoutMs: Schema.Number,
  message: Schema.String,
}) {}

export class IpcHandlerThrewError extends Schema.TaggedErrorClass<IpcHandlerThrewError>()(
  "IpcHandlerThrewError",
  {
    channel: IpcChannel,
    message: Schema.String,
    cause: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export class IpcPermissionDeniedError extends Schema.TaggedErrorClass<IpcPermissionDeniedError>()(
  "IpcPermissionDeniedError",
  {
    channel: IpcChannel,
    message: Schema.String,
    reason: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export class IpcSerializationError extends Schema.TaggedErrorClass<IpcSerializationError>()(
  "IpcSerializationError",
  {
    channel: Schema.OptionFromUndefinedOr(IpcChannel),
    message: Schema.String,
  },
) {}

export class IpcTransportError extends Schema.TaggedErrorClass<IpcTransportError>()(
  "IpcTransportError",
  {
    channel: Schema.OptionFromUndefinedOr(IpcChannel),
    message: Schema.String,
    cause: Schema.OptionFromUndefinedOr(Schema.String),
  },
) {}

export class IpcDecodeError extends Schema.TaggedErrorClass<IpcDecodeError>()("IpcDecodeError", {
  channel: Schema.OptionFromUndefinedOr(IpcChannel),
  message: Schema.String,
  issues: Schema.Array(Schema.String),
}) {}

export class IpcContractError extends Error {
  readonly _tag: string;

  constructor(error: Readonly<{ readonly _tag: string; readonly message?: string }>) {
    super(error.message ?? error._tag);
    this.name = "IpcContractError";
    this._tag = error._tag;
    Object.assign(this, error);
  }
}

export const IpcError = Schema.Union([
  IpcChannelNotFoundError,
  IpcValidationError,
  IpcTimeoutError,
  IpcHandlerThrewError,
  IpcPermissionDeniedError,
  IpcSerializationError,
  IpcTransportError,
  IpcDecodeError,
]);

export type IpcError = typeof IpcError.Type;

export const IPC_ERROR_COUNT = 8;

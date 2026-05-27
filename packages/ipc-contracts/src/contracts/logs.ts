import { Schema } from "effect";

import { defineContract } from "../contract.js";
import { createRegistry } from "../registry.js";
import { IpcContractErrors } from "./common.js";

export const LogEntryView = Schema.Struct({
  ts: Schema.String,
  level: Schema.String,
  msg: Schema.String,
});

export const LogsListRecentRequest = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

export const LogsListRecentResponse = Schema.Struct({
  entries: Schema.Array(LogEntryView),
});

export const LogsListRecentContract = defineContract({
  channel: "tileborne:logs:listRecent",
  request: LogsListRecentRequest,
  response: LogsListRecentResponse,
  errors: IpcContractErrors,
});

export const LogsContracts = [LogsListRecentContract] as const;

export const LogsIpcRegistry = createRegistry(LogsContracts);

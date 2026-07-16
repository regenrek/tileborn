import { Schema } from 'effect';

import { IpcError } from '../errors.js';

export const IpcContractErrors = IpcError;

export const EmptyRequest = Schema.Struct({});

export const EmptyResponse = Schema.Struct({});

export const FilePickerMode = Schema.Union([
  Schema.Literal('file'),
  Schema.Literal('directory'),
  Schema.Literal('either'),
]);

export const IsoDateTimeString = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/),
);

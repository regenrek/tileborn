import { Schema } from 'effect';

/** Trigger-only event payload: renderer refetches via canonical query channels. */
export type TriggerEventPayloadType = Record<string, never>;

/** Trigger-only event payload: renderer refetches via canonical query channels. */
export const TriggerEventPayload: Schema.Schema<TriggerEventPayloadType> = Schema.Struct({});

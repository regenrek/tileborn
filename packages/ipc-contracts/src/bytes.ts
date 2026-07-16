import { Schema } from 'effect';

export const Uint8ArraySchema: Schema.Schema<Uint8Array> = Schema.declare<Uint8Array>(
  (value): value is Uint8Array => value instanceof Uint8Array,
  { title: 'Uint8Array' },
);

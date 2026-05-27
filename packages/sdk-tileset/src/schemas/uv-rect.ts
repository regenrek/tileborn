import { Schema } from "effect";

/** Integer pixel rectangle inside an atlas image. */
export class UVRect extends Schema.Class<UVRect>("UVRect")({
  x: Schema.Int,
  y: Schema.Int,
  w: Schema.Int,
  h: Schema.Int,
}) {}

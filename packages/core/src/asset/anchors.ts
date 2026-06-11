import { Effect, Schema } from 'effect';

const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Open, branded attachment-anchor name ("hand", "muzzle", "grip", …).
 * Names stay open strings so plugins introduce anchors without engine edits.
 */
export const AttachmentAnchorName = Schema.String.check(Schema.isPattern(slugPattern)).pipe(
  Schema.brand('AttachmentAnchorName'),
);
export type AttachmentAnchorName = typeof AttachmentAnchorName.Type;

export const makeAttachmentAnchorName = (value: string): AttachmentAnchorName =>
  Schema.decodeUnknownSync(AttachmentAnchorName)(value);

export const WELL_KNOWN_ATTACHMENT_ANCHORS = {
  hand: makeAttachmentAnchorName('hand'),
  grip: makeAttachmentAnchorName('grip'),
  muzzle: makeAttachmentAnchorName('muzzle'),
  head: makeAttachmentAnchorName('head'),
  back: makeAttachmentAnchorName('back'),
} as const;

/** A normalized (0..1) point in sprite/model-local space, origin top-left. */
export class VisualAnchorPoint extends Schema.Class<VisualAnchorPoint>('VisualAnchorPoint')({
  x: Schema.Number,
  y: Schema.Number,
}) {}

/**
 * The single anchor contract (ADR-0028): a normalized attachment point plus
 * rotation and z-ordering metadata. Used by visual roles, catalog entity
 * components (`visual-ref`), and player models alike — there is deliberately
 * no second anchor shape.
 */
export class AttachmentAnchor extends Schema.Class<AttachmentAnchor>('AttachmentAnchor')({
  point: VisualAnchorPoint,
  rotationDeg: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0)),
  ),
  zOffset: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0)),
  ),
}) {}

/** Open map of named attachment anchors. */
export const AttachmentAnchorMap = Schema.Record(Schema.String, AttachmentAnchor);
export type AttachmentAnchorMap = typeof AttachmentAnchorMap.Type;

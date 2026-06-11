import { Effect, Schema } from 'effect';

import { VisualAnchorPoint } from './anchors.js';

/** Normalized (0..1) sprite-local sub-rectangle a visual occupies. */
export class VisualFootprint extends Schema.Class<VisualFootprint>('VisualFootprint')({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {}

export class RenderNameplateProfile extends Schema.Class<RenderNameplateProfile>(
  'RenderNameplateProfile',
)({
  visible: Schema.Boolean.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(true)),
    Schema.withConstructorDefault(Effect.succeed(true)),
  ),
  offsetY: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(-20)),
    Schema.withConstructorDefault(Effect.succeed(-20)),
  ),
}) {}

export class RenderShadowProfile extends Schema.Class<RenderShadowProfile>(
  'RenderShadowProfile',
)({
  visible: Schema.Boolean.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(true)),
    Schema.withConstructorDefault(Effect.succeed(true)),
  ),
  scale: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1)),
    Schema.withConstructorDefault(Effect.succeed(1)),
  ),
  opacity: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0.45)),
    Schema.withConstructorDefault(Effect.succeed(0.45)),
  ),
  offset: VisualAnchorPoint.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new VisualAnchorPoint({ x: 0, y: 0 }))),
    Schema.withConstructorDefault(Effect.succeed(new VisualAnchorPoint({ x: 0, y: 0 }))),
  ),
}) {}

/**
 * How a visual renders: scale, footprint, pivot and presentation sub-profiles.
 * Carried by catalog `visual-ref` components (and their derived projections);
 * deliberately role-free — the entity that owns the visual gives it meaning.
 */
export class RenderProfile extends Schema.Class<RenderProfile>('RenderProfile')({
  scale: Schema.Number.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1)),
    Schema.withConstructorDefault(Effect.succeed(1)),
  ),
  footprint: VisualFootprint.pipe(
    Schema.withDecodingDefaultTypeKey(
      Effect.succeed(new VisualFootprint({ x: 0, y: 0, width: 1, height: 1 })),
    ),
    Schema.withConstructorDefault(
      Effect.succeed(new VisualFootprint({ x: 0, y: 0, width: 1, height: 1 })),
    ),
  ),
  pivot: VisualAnchorPoint.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new VisualAnchorPoint({ x: 0.5, y: 1 }))),
    Schema.withConstructorDefault(Effect.succeed(new VisualAnchorPoint({ x: 0.5, y: 1 }))),
  ),
  nameplate: RenderNameplateProfile.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new RenderNameplateProfile({}))),
    Schema.withConstructorDefault(Effect.succeed(new RenderNameplateProfile({}))),
  ),
  shadow: RenderShadowProfile.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(new RenderShadowProfile({}))),
    Schema.withConstructorDefault(Effect.succeed(new RenderShadowProfile({}))),
  ),
}) {}

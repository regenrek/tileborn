import { Schema } from "effect";

export type ComponentFieldType = "f32" | "f64" | "i32" | "u32" | "i8" | "u8";

export type ComponentFields<T extends object> = {
  readonly [K in keyof T]: ComponentFieldType;
};

export class Position extends Schema.Class<Position>("Position")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

export class Velocity extends Schema.Class<Velocity>("Velocity")({
  x: Schema.Number,
  y: Schema.Number,
}) {}

export class Health extends Schema.Class<Health>("Health")({
  current: Schema.Number,
  max: Schema.Number,
}) {}

export class Transform extends Schema.Class<Transform>("Transform")({
  x: Schema.Number,
  y: Schema.Number,
  rotation: Schema.Number,
  scaleX: Schema.Number,
  scaleY: Schema.Number,
}) {}

export class Renderable extends Schema.Class<Renderable>("Renderable")({
  assetId: Schema.Number,
  layerIndex: Schema.Number,
}) {}

export type ComponentValue = Position | Velocity | Health | Transform | Renderable;

export interface ComponentDefinition<T extends object> {
  readonly name: string;
  readonly schema: Schema.Schema<T>;
  readonly fields: ComponentFields<T>;
  readonly defaults: () => T;
}

export const defineComponent = <T extends object>(
  name: string,
  schema: Schema.Schema<T>,
  fields: ComponentFields<T>,
  defaults: () => T,
): ComponentDefinition<T> => ({ name, schema, fields, defaults });

export const PositionComponent = defineComponent(
  "Position",
  Position,
  { x: "f32", y: "f32" },
  () => new Position({ x: 0, y: 0 }),
);

export const VelocityComponent = defineComponent(
  "Velocity",
  Velocity,
  { x: "f32", y: "f32" },
  () => new Velocity({ x: 0, y: 0 }),
);

export const HealthComponent = defineComponent(
  "Health",
  Health,
  { current: "i32", max: "i32" },
  () => new Health({ current: 1, max: 1 }),
);

export const TransformComponent = defineComponent(
  "Transform",
  Transform,
  { x: "f32", y: "f32", rotation: "f32", scaleX: "f32", scaleY: "f32" },
  () => new Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
);

export const RenderableComponent = defineComponent(
  "Renderable",
  Renderable,
  { assetId: "u32", layerIndex: "u8" },
  () => new Renderable({ assetId: 0, layerIndex: 0 }),
);

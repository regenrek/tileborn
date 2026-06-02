import { describe, expect, it } from "vitest";

import { interpolateRenderableEntities } from "./interpolate-entities.js";
import type { RenderableEntity } from "../plugin/renderable-entity.js";

const entity = (id: string, x: number, y: number, extra: Partial<RenderableEntity> = {}): RenderableEntity => ({
  id,
  assetId: "asset",
  x,
  y,
  ...extra,
});

describe("interpolateRenderableEntities", () => {
  it("lerps world position between previous and current by alpha", () => {
    const previous = [entity("a", 0, 0)];
    const current = [entity("a", 10, 20)];

    expect(interpolateRenderableEntities(current, previous, 0.5)).toEqual([entity("a", 5, 10)]);
    expect(interpolateRenderableEntities(current, previous, 0.25)).toEqual([entity("a", 2.5, 5)]);
  });

  it("advances continuously toward current as alpha increases (no boundary jump)", () => {
    const previous = [entity("a", 0, 0)];
    const current = [entity("a", 30, 0)];

    const xs = [0, 0.25, 0.5, 0.75, 1].map(
      (alpha) => interpolateRenderableEntities(current, previous, alpha)[0]!.x,
    );

    expect(xs).toEqual([0, 7.5, 15, 22.5, 30]);
    // Monotonic, evenly spaced => a follow-camera tracking this position scrolls smoothly.
    const deltas = xs.slice(1).map((value, index) => value - xs[index]!);
    expect(deltas.every((delta) => delta === deltas[0])).toBe(true);
  });

  it("renders an entity with no previous match at its current position", () => {
    const previous = [entity("a", 0, 0)];
    const current = [entity("a", 10, 0), entity("spawned", 99, 99)];

    const result = interpolateRenderableEntities(current, previous, 0.5);

    expect(result).toEqual([entity("a", 5, 0), entity("spawned", 99, 99)]);
  });

  it("returns current positions verbatim when there is no previous snapshot", () => {
    const current = [entity("a", 10, 20)];

    expect(interpolateRenderableEntities(current, [], 0.5)).toEqual(current);
  });

  it("clamps alpha and keeps non-positional fields from the current entity", () => {
    const previous = [entity("a", 0, 0, { rotation: 0, scale: 1 })];
    const current = [entity("a", 10, 0, { rotation: 1.5, scale: 2, layerIndex: 10 })];

    // alpha >= 1 (and out-of-range) collapses to the current snapshot.
    expect(interpolateRenderableEntities(current, previous, 5)).toEqual(current);
    expect(interpolateRenderableEntities(current, previous, Number.NaN)).toEqual(current);

    // Mid-interpolation still carries rotation/scale/layer from current.
    expect(interpolateRenderableEntities(current, previous, 0.5)).toEqual([
      entity("a", 5, 0, { rotation: 1.5, scale: 2, layerIndex: 10 }),
    ]);

    // alpha <= 0 sits at the previous position but keeps current's other fields.
    expect(interpolateRenderableEntities(current, previous, -1)).toEqual([
      entity("a", 0, 0, { rotation: 1.5, scale: 2, layerIndex: 10 }),
    ]);
  });

  it("does not mutate the previous or current input arrays/entities", () => {
    const previous = [entity("a", 0, 0)];
    const current = [entity("a", 10, 20)];
    const previousSnapshot = structuredClone(previous);
    const currentSnapshot = structuredClone(current);

    interpolateRenderableEntities(current, previous, 0.5);

    expect(previous).toEqual(previousSnapshot);
    expect(current).toEqual(currentSnapshot);
  });

  it("is stable when previous === current positions (output equals current)", () => {
    const previous = [entity("a", 7, 9), entity("b", 1, 2)];
    const current = [entity("a", 7, 9), entity("b", 1, 2)];

    const result = interpolateRenderableEntities(current, previous, 0.5);

    expect(result).toEqual(current);
    expect(result.map((value) => [value.x, value.y])).toEqual([
      [7, 9],
      [1, 2],
    ]);
  });

  it("drops a previous-only entity: output maps over current ids only", () => {
    const previous = [entity("a", 0, 0), entity("gone", 5, 5)];
    const current = [entity("a", 10, 0)];

    const result = interpolateRenderableEntities(current, previous, 0.5);

    expect(result).toEqual([entity("a", 5, 0)]);
    expect(result.some((value) => value.id === "gone")).toBe(false);
  });

  it("returns an empty list when current is empty", () => {
    const previous = [entity("a", 0, 0)];

    expect(interpolateRenderableEntities([], previous, 0.5)).toEqual([]);
    expect(interpolateRenderableEntities([], [], 0.5)).toEqual([]);
  });
});

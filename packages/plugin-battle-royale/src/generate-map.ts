import { Option } from "effect";
import {
  MapObject,
  ObjectLayer,
  TileChunk,
  TileLayer,
  makeTileborneMap,
  type MapObject as MapObjectType,
  type TileborneMap,
} from "@tileborne/core";

import { LOOT_CRATE_KIND, SHRINK_ZONE_ANCHOR_KIND, SPAWN_POINT_KIND } from "./constants.js";
import { layerIdFromSeed, mapIdFromSeed, objectIdFromSeed } from "./id-utils.js";
import type { GenerateMapOptions } from "./types/artifact.js";
import { SeededRng } from "./rng.js";

const makeMapObject = (input: {
  readonly id: MapObjectType["id"];
  readonly kind: MapObjectType["kind"];
  readonly x: number;
  readonly y: number;
  readonly layerId: MapObjectType["layerId"];
  readonly properties: MapObjectType["properties"];
}): MapObject =>
  new MapObject({
    ...input,
    width: Option.none(),
    height: Option.none(),
  });

const buildGroundLayer = (seed: string | number, width: number, height: number, rng: SeededRng): TileLayer => {
  const tiles: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles.push(rng.nextFloat() < 0.82 ? 0 : 1);
    }
  }
  return new TileLayer({
    id: layerIdFromSeed(`${width}x${height}`, "ground"),
    name: "Ground",
    visible: true,
    opacity: 1,
    chunks: [new TileChunk({ x: 0, y: 0, width, height, tiles })],
  });
};

const perimeterSpawn = (
  index: number,
  total: number,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } => {
  const margin = 2;
  const perimeter = 2 * (width + height - 4);
  const step = Math.floor((index / total) * perimeter);
  if (step < width - 2 * margin) {
    return { x: margin + step, y: margin };
  }
  const rightOffset = step - (width - 2 * margin);
  if (rightOffset < height - 2 * margin) {
    return { x: width - margin, y: margin + rightOffset };
  }
  const bottomOffset = rightOffset - (height - 2 * margin);
  if (bottomOffset < width - 2 * margin) {
    return { x: width - margin - bottomOffset, y: height - margin };
  }
  const leftOffset = bottomOffset - (width - 2 * margin);
  return { x: margin, y: height - margin - leftOffset };
};

const poissonLikePoints = (
  rng: SeededRng,
  count: number,
  width: number,
  height: number,
  minDistance: number,
): Array<{ readonly x: number; readonly y: number }> => {
  const points: Array<{ readonly x: number; readonly y: number }> = [];
  const maxAttempts = count * 40;
  let attempts = 0;
  while (points.length < count && attempts < maxAttempts) {
    attempts += 1;
    const candidate = {
      x: rng.nextInt(3, width - 4),
      y: rng.nextInt(3, height - 4),
    };
    const tooClose = points.some((point) => {
      const dx = point.x - candidate.x;
      const dy = point.y - candidate.y;
      return Math.hypot(dx, dy) < minDistance;
    });
    if (!tooClose) {
      points.push(candidate);
    }
  }
  return points;
};

export const generateMap = (seed: string | number, opts: GenerateMapOptions): TileborneMap => {
  const rng = new SeededRng(seed);
  const { width, height, spawnCount, lootDensity } = opts;
  const objectLayerId = layerIdFromSeed(seed, "objects");
  const objects: MapObject[] = [];

  for (let index = 0; index < spawnCount; index += 1) {
    const position = perimeterSpawn(index, spawnCount, width, height);
    objects.push(
      makeMapObject({
        id: objectIdFromSeed(seed, `spawn-${index}`),
        kind: SPAWN_POINT_KIND,
        x: position.x,
        y: position.y,
        layerId: objectLayerId,
        properties: { team: "solo", weight: 1 },
      }),
    );
  }

  objects.push(
    makeMapObject({
      id: objectIdFromSeed(seed, "shrink-anchor"),
      kind: SHRINK_ZONE_ANCHOR_KIND,
      x: width / 2,
      y: height / 2,
      layerId: objectLayerId,
      properties: {
        initialRadiusTiles: Math.max(width, height) / 2,
        finalRadiusTiles: 4,
      },
    }),
  );

  const lootCount = Math.max(1, Math.round((width * height * lootDensity) / 100));
  const lootPoints = poissonLikePoints(rng, lootCount, width, height, 4);
  for (const [index, point] of lootPoints.entries()) {
    const tierRoll = rng.nextFloat();
    const tier = tierRoll < 0.7 ? "common" : tierRoll < 0.9 ? "rare" : "epic";
    objects.push(
      makeMapObject({
        id: objectIdFromSeed(seed, `loot-${index}`),
        kind: LOOT_CRATE_KIND,
        x: point.x,
        y: point.y,
        layerId: objectLayerId,
        properties: { tier, respawnSeconds: 0 },
      }),
    );
  }

  const objectLayer = new ObjectLayer({
    id: objectLayerId,
    name: "Objects",
    visible: true,
    opacity: 1,
    objectIds: objects.map((object) => object.id),
  });

  return makeTileborneMap({
    id: mapIdFromSeed(seed),
    width,
    height,
    tileWidth: 32,
    tileHeight: 32,
    layers: [buildGroundLayer(seed, width, height, rng), objectLayer],
    objects,
    properties: { generatorSeed: String(seed) },
  });
};

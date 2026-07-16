import { readFile } from 'node:fs/promises';

import { decodePersistedTileborneMapJson, type TileborneMap } from '@tileborne/core';

import { CliValidationError } from '../render/errors.js';

export const readMapFile = async (filePath: string): Promise<TileborneMap> => {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return decodePersistedTileborneMapJson(parsed);
  } catch (cause) {
    throw new CliValidationError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

export const mapToPersistedJson = (map: TileborneMap): unknown => ({
  id: map.id,
  schemaVersion: map.schemaVersion,
  size: { width: map.size.width, height: map.size.height },
  tileSize: { width: map.tileSize.width, height: map.tileSize.height },
  layers: map.layers.map((layer) => {
    switch (layer._tag) {
      case 'tile':
        return {
          kind: 'tile',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks: layer.chunks.map((chunk) => ({
            x: chunk.x,
            y: chunk.y,
            width: chunk.width,
            height: chunk.height,
            tiles: [...chunk.tiles],
          })),
        };
      case 'object':
        return {
          kind: 'object',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          objectIds: [...layer.objectIds],
        };
      case 'image':
        return {
          kind: 'image',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          assetId: layer.assetId,
          x: layer.x,
          y: layer.y,
        };
      case 'collision':
        return {
          kind: 'collision',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          chunks: layer.chunks.map((chunk) => ({
            x: chunk.x,
            y: chunk.y,
            width: chunk.width,
            height: chunk.height,
            tiles: [...chunk.tiles],
          })),
        };
    }
  }),
  objects: map.objects.map((object) => ({
    id: object.id,
    kind: object.kind,
    x: object.x,
    y: object.y,
    layerId: object.layerId,
    properties: object.properties,
  })),
  properties: map.properties,
});

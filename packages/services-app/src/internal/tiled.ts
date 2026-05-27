import {
  MapObject,
  TileborneMap,
} from "@tileborne/core";

const optionValue = <A>(
  value: A | { readonly _tag: string; readonly value?: A } | undefined,
): A | undefined => {
  if (typeof value === "object" && value !== null && "_tag" in value) {
    return value._tag === "Some" ? value.value : undefined;
  }
  return value;
};

const objectPlacementToTiled = (placement: MapObject["placement"] | undefined): unknown => {
  if (placement === undefined) {
    return undefined;
  }
  return {
    placeableId: placement.placeableId,
    source: placement.source,
    assetId: optionValue(placement.assetId),
    tileId: optionValue(placement.tileId),
    gid: optionValue(placement.gid),
  };
};

export const exportMapToTiled = (map: TileborneMap): Record<string, unknown> => ({
  compressionlevel: -1,
  height: map.size.height,
  infinite: false,
  layers: map.layers.reduce<Array<Record<string, unknown>>>((acc, layer) => {
    switch (layer._tag) {
      case "tile":
      case "collision": {
        const tiles = layer.chunks.flatMap((chunk) => chunk.tiles);
        acc.push({
          id: 1,
          name: layer.name,
          type: "tilelayer",
          visible: layer.visible,
          opacity: layer.opacity,
          width: map.size.width,
          height: map.size.height,
          x: 0,
          y: 0,
          data: tiles,
        });
        return acc;
      }
      case "object":
        acc.push({
          id: 2,
          name: layer.name,
          type: "objectgroup",
          visible: layer.visible,
          opacity: layer.opacity,
          objects: map.objects
            .filter((object) => object.layerId === layer.id)
            .map((object) => ({
              id: 1,
              name: object.kind,
              type: object.kind,
              x: object.x,
              y: object.y,
              width: optionValue(object.width),
              height: optionValue(object.height),
              placement: objectPlacementToTiled(object.placement),
            })),
        });
        return acc;
      case "image":
        return acc;
    }
  }, []),
  nextlayerid: 3,
  nextobjectid: 1,
  orientation: "orthogonal",
  renderorder: "right-down",
  tiledversion: "1.10.2",
  tileheight: map.tileSize.height,
  tilewidth: map.tileSize.width,
  type: "map",
  version: "1.10",
  width: map.size.width,
});

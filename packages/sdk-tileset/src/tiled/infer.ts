import type {
  TiledImportPlanSuggestion,
  TiledImportScan,
  TiledScanAmbiguousAtlasObject,
  TiledScanObjectLayer,
  TiledScanTileset,
} from './types.js';

const suggestionId = (parts: readonly string[]): string =>
  parts
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-');

const inferTilesetCategory = (tileset: TiledScanTileset): TiledImportPlanSuggestion[] =>
  tileset.categories.length > 0
    ? []
    : [
        {
          id: suggestionId(['tileset-category', tileset.name]),
          block: 'category',
          target: tileset.name,
          action: `Create category from tileset "${tileset.name}"`,
          reason:
            'Tileset names often describe the palette group when no class/type/category hint exists.',
          confidence: 0.6,
          source: 'assistive-infer',
        },
      ];

const inferAmbiguousPlaceable = (
  entry: TiledScanAmbiguousAtlasObject,
): TiledImportPlanSuggestion => ({
  id: suggestionId(['placeable', entry.tilesetName, String(entry.localTileId)]),
  block: 'placeable',
  target: `${entry.tilesetName}:${entry.localTileId}`,
  action: 'Treat atlas tile object as a placeable candidate',
  reason: entry.message,
  confidence: 0.55,
  source: 'assistive-infer',
});

const inferObjectLayerCategory = (layer: TiledScanObjectLayer): TiledImportPlanSuggestion[] =>
  layer.categories.length > 0
    ? []
    : [
        {
          id: suggestionId(['object-layer-category', layer.name]),
          block: 'object-layer',
          target: layer.name,
          action: `Create object category from layer "${layer.name}"`,
          reason: 'Object layer names often describe the placed object group.',
          confidence: 0.5,
          source: 'assistive-infer',
        },
      ];

export const inferTiledImportSuggestions = (
  scan: TiledImportScan,
): readonly TiledImportPlanSuggestion[] =>
  [
    ...scan.tilesets.flatMap(inferTilesetCategory),
    ...scan.ambiguousAtlasObjects.map(inferAmbiguousPlaceable),
    ...scan.objectLayers.flatMap(inferObjectLayerCategory),
  ].sort((left, right) => left.id.localeCompare(right.id));

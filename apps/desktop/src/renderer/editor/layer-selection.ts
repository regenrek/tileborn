import type { LayerId, TileborneMap } from '@tileborne/core';
import type { BrushIntent, EditorTool } from '@/stores/editor-ui-store';

export const resolveActiveLayerId = (
  map: TileborneMap,
  activeLayerId: LayerId | null | undefined,
): LayerId | null => {
  if (activeLayerId !== null && activeLayerId !== undefined) {
    const layer = map.layers.find((entry) => entry.id === activeLayerId);
    if (layer !== undefined) {
      return layer.id;
    }
  }
  return map.layers[0]?.id ?? null;
};

const layerKindForTool = (
  tool: EditorTool,
  brushIntent?: BrushIntent | undefined,
): TileborneMap['layers'][number]['_tag'] | null => {
  switch (tool) {
    case 'tileBrush':
      return brushIntent?.kind === 'placeable' ? 'object' : 'tile';
    case 'rectangleFill':
    case 'eraser':
      return 'tile';
    case 'objectPlace':
    case 'regionMark':
      return 'object';
    case 'collisionPaint':
      return 'collision';
    case 'select':
    case 'pan':
    case 'objectMove':
      return null;
  }
};

export const resolveToolActiveLayerId = (
  map: TileborneMap,
  activeLayerId: LayerId | null | undefined,
  tool: EditorTool,
  brushIntent?: BrushIntent | undefined,
): LayerId | null => {
  const requiredKind = layerKindForTool(tool, brushIntent);
  if (requiredKind === null) {
    return resolveActiveLayerId(map, activeLayerId);
  }
  if (activeLayerId !== null && activeLayerId !== undefined) {
    const activeLayer = map.layers.find((entry) => entry.id === activeLayerId);
    if (activeLayer?._tag === requiredKind) {
      return activeLayer.id;
    }
  }
  return map.layers.find((entry) => entry._tag === requiredKind)?.id ?? null;
};

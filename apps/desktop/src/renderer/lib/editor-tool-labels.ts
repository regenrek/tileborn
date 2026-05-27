import type { EditorTool } from '@/stores/editor-ui-store';
import { TOOL_KEY_BINDINGS } from '@/editor/viewport/tool-state';

export const TOOL_LABELS: Record<EditorTool, string> = {
  select: 'Select',
  pan: 'Pan',
  tileBrush: 'Tile brush',
  rectangleFill: 'Rectangle fill',
  eraser: 'Eraser',
  objectPlace: 'Place object',
  objectMove: 'Move object',
  collisionPaint: 'Collision paint',
  regionMark: 'Region mark',
};

export function toolShortcut(tool: EditorTool): string {
  return TOOL_KEY_BINDINGS[tool];
}

export function formatToolLabel(tool: EditorTool): string {
  return TOOL_LABELS[tool];
}

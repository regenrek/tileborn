import type { LucideIcon } from 'lucide-react';
import {
  EraserIcon,
  MousePointer2Icon,
  PaintBucketIcon,
  PaintbrushIcon,
  ScanIcon,
  ShieldIcon,
} from 'lucide-react';

import { TOOL_KEY_BINDINGS } from '@/editor/viewport/tool-state';
import { TOOL_LABELS } from '@/lib/editor-tool-labels';
import type { EditorTool } from '@/stores/editor-ui-store';

export interface MapEditorToolbarTool {
  readonly id: EditorTool;
  readonly label: string;
  readonly shortcut: string;
  readonly icon: LucideIcon;
}

/** Primary map-editor tools shown in the in-viewport toolbar dock. */
export const MAP_EDITOR_TOOLBAR_TOOLS: readonly MapEditorToolbarTool[] = [
  {
    id: 'select',
    label: TOOL_LABELS.select,
    shortcut: TOOL_KEY_BINDINGS.select,
    icon: MousePointer2Icon,
  },
  {
    id: 'tileBrush',
    label: TOOL_LABELS.tileBrush,
    shortcut: TOOL_KEY_BINDINGS.tileBrush,
    icon: PaintbrushIcon,
  },
  {
    id: 'rectangleFill',
    label: TOOL_LABELS.rectangleFill,
    shortcut: TOOL_KEY_BINDINGS.rectangleFill,
    icon: PaintBucketIcon,
  },
  {
    id: 'eraser',
    label: TOOL_LABELS.eraser,
    shortcut: TOOL_KEY_BINDINGS.eraser,
    icon: EraserIcon,
  },
  {
    id: 'collisionPaint',
    label: TOOL_LABELS.collisionPaint,
    shortcut: TOOL_KEY_BINDINGS.collisionPaint,
    icon: ShieldIcon,
  },
  {
    id: 'regionMark',
    label: TOOL_LABELS.regionMark,
    shortcut: TOOL_KEY_BINDINGS.regionMark,
    icon: ScanIcon,
  },
] as const;

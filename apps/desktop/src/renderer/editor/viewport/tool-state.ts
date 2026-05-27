import {
  MapObjectPlacement,
  type AssetId,
  type LayerId,
  type ObjectId,
  type PlaceableId,
  type TileId,
  type TileborneMap,
} from '@tileborne/core';
import { Option } from 'effect';

import type { EditorCommand } from '../editor-commands.js';
import {
  createCollisionPaintCommand,
  createStrokeTileCommand,
  createObjectMoveCommand,
  createObjectPlaceCommand,
  createRectangleFillCommand,
  createRegionMarkCommand,
} from '../editor-commands.js';
import { findTileLayer, getTileIndex } from '../map-utils.js';
import type { BrushIntent, EditorTool } from '@/stores/editor-ui-store';
import {
  autotileCellsToRefresh,
  resolveAutotileTileIndex,
  type AutotilePaintBrush,
  type AutotilePaintResolver,
} from './autotile-paint.js';

export interface PointerPoint {
  readonly tileX: number;
  readonly tileY: number;
  readonly clientX: number;
  readonly clientY: number;
}

export interface ToolContext {
  readonly map: TileborneMap;
  readonly activeTool: EditorTool;
  readonly brushIntent: BrushIntent;
  readonly resolvedBrush?: ResolvedBrush | undefined;
  readonly autotileResolver?: AutotilePaintResolver | undefined;
  readonly stagedObjectKind: string;
  readonly activeLayerId?: LayerId | undefined;
  readonly selection: ReadonlySet<string>;
  readonly shiftKey: boolean;
}

export interface ToolDispatchResult {
  readonly command?: EditorCommand;
  readonly historyCommand?: EditorCommand;
  readonly historyMode?: 'push' | 'replace' | 'skip';
  readonly selection?: Set<string>;
  readonly clearSelection?: boolean;
  readonly panDelta?: { dx: number; dy: number };
  readonly brushPreview?: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    tileIndex?: number;
  } | null;
}

export interface ToolSession {
  readonly origin?: PointerPoint;
  readonly dragging?: boolean;
  readonly objectId?: ObjectId;
  readonly lastPaintedCell?: {
    readonly layerId: LayerId;
    readonly tileX: number;
    readonly tileY: number;
    readonly tileIndex: number;
  };
  readonly strokeTileChanges?: StrokeTileChangeState | undefined;
}

interface StrokeTileChangeState {
  readonly layerId: LayerId;
  readonly cells: readonly {
    readonly tileX: number;
    readonly tileY: number;
    readonly oldIndex: number;
    readonly newIndex: number;
  }[];
}

export type ResolvedBrush =
  | { readonly kind: 'paintTile'; readonly tileIndex: number }
  | AutotilePaintBrush
  | {
      readonly kind: 'placeObject';
      readonly placeableId: PlaceableId;
      readonly width: number;
      readonly height: number;
      readonly frame: {
        readonly assetId: AssetId;
        readonly tileId: TileId;
        readonly uv: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
      };
    };

export const TOOL_KEY_BINDINGS: Record<EditorTool, string> = {
  select: 'V',
  pan: 'H',
  tileBrush: 'B',
  rectangleFill: 'R',
  eraser: 'E',
  objectPlace: 'O',
  objectMove: 'M',
  collisionPaint: 'C',
  regionMark: 'T',
};

const optionValue = <A>(
  value: A | { readonly _tag: string; readonly value?: A } | undefined,
): A | undefined => {
  if (typeof value === 'object' && value !== null && '_tag' in value) {
    return value._tag === 'Some' ? value.value : undefined;
  }
  return value;
};

export const resolveLayerId = (map: TileborneMap, activeLayerId?: LayerId): LayerId | undefined => {
  return findTileLayer(map, activeLayerId)?.id ?? findTileLayer(map)?.id;
};

export const dispatchPointerDown = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  switch (context.activeTool) {
    case 'select':
      return handleSelectDown(context, point, session);
    case 'pan':
      return { session: { ...session, origin: point, dragging: true }, result: {} };
    case 'tileBrush':
      return applyTileCommand(context, point, { ...session, dragging: true });
    case 'rectangleFill':
      return {
        session: { origin: point, dragging: true },
        result: { brushPreview: previewRect(point, point) },
      };
    case 'eraser':
      return applyEraseCommand(context, point, { ...session, dragging: true });
    case 'objectPlace':
      return applyObjectPlace(context, point);
    case 'objectMove':
      return handleObjectMoveDown(context, point, session);
    case 'collisionPaint':
      return applyCollisionPaint(context, point);
    case 'regionMark':
      return {
        session: { origin: point, dragging: true },
        result: { brushPreview: previewRect(point, point) },
      };
    default:
      return { session, result: {} };
  }
};

export const dispatchPointerMove = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  if (context.activeTool === 'pan' && session.dragging && session.origin) {
    return {
      session,
      result: {
        panDelta: {
          dx: point.clientX - session.origin.clientX,
          dy: point.clientY - session.origin.clientY,
        },
      },
    };
  }
  if (
    (context.activeTool === 'rectangleFill' || context.activeTool === 'regionMark') &&
    session.dragging &&
    session.origin
  ) {
    return {
      session,
      result: {
        brushPreview: previewRect(session.origin, point),
      },
    };
  }
  if (context.activeTool === 'objectMove' && session.dragging && session.objectId) {
    return {
      session,
      result: {
        brushPreview: {
          x: point.tileX,
          y: point.tileY,
          w: 1,
          h: 1,
          tileIndex: 0,
        },
      },
    };
  }
  if (context.activeTool === 'tileBrush' && session.dragging) {
    return applyTileCommand(context, point, session);
  }
  if (context.activeTool === 'eraser' && session.dragging) {
    return applyEraseCommand(context, point, session);
  }
  return {
    session,
    result: {
      brushPreview: brushPreviewForTool(context, point),
    },
  };
};

export const dispatchPointerUp = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  if (context.activeTool === 'rectangleFill' && session.origin) {
    const layerId = resolveLayerId(context.map, context.activeLayerId);
    if (!layerId || context.resolvedBrush?.kind !== 'paintTile') {
      return { session: {}, result: { brushPreview: null } };
    }
    const command = createRectangleFillCommand(
      context.map,
      layerId,
      session.origin.tileX,
      session.origin.tileY,
      point.tileX,
      point.tileY,
      context.resolvedBrush.tileIndex,
    );
    return { session: {}, result: { command, brushPreview: null } };
  }
  if (context.activeTool === 'regionMark' && session.origin) {
    const command = createRegionMarkCommand(
      context.map,
      session.origin.tileX,
      session.origin.tileY,
      point.tileX,
      point.tileY,
    );
    return { session: {}, result: { command, brushPreview: null } };
  }
  if (context.activeTool === 'objectMove' && session.objectId) {
    const tileSize = context.map.tileSize.width;
    const command = createObjectMoveCommand(
      context.map,
      session.objectId,
      point.tileX * tileSize,
      point.tileY * tileSize,
    );
    return { session: {}, result: { command, brushPreview: null } };
  }
  if (
    (context.activeTool === 'tileBrush' || context.activeTool === 'eraser') &&
    session.dragging
  ) {
    const next =
      context.activeTool === 'tileBrush'
        ? applyTileCommand(context, point, session)
        : applyEraseCommand(context, point, session);
    return {
      session: {},
      result: {
        ...(next.result.command === undefined
          ? {}
          : {
              command: next.result.command,
              historyCommand: next.result.historyCommand,
              historyMode: next.result.historyMode,
            }),
        brushPreview: null,
      },
    };
  }
  if (context.activeTool === 'select' && session.origin && session.dragging) {
    const selection = rectSelection(session.origin, point);
    return { session: {}, result: { selection } };
  }
  return { session: {}, result: { brushPreview: null } };
};

const handleSelectDown = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  void session;
  const hitObject = context.map.objects.find((object) => objectContainsPoint(context.map, object, point));
  if (hitObject) {
    const next = new Set(context.selection);
    if (context.shiftKey) {
      if (next.has(hitObject.id)) {
        next.delete(hitObject.id);
      } else {
        next.add(hitObject.id);
      }
    } else {
      next.clear();
      next.add(hitObject.id);
    }
    return { session: { origin: point }, result: { selection: next } };
  }
  const tileId = `${point.tileX}:${point.tileY}`;
  const next = context.shiftKey ? new Set(context.selection) : new Set<string>();
  if (context.shiftKey && next.has(tileId)) {
    next.delete(tileId);
  } else {
    next.add(tileId);
  }
  return { session: { origin: point, dragging: true }, result: { selection: next } };
};

const handleObjectMoveDown = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  const hit = context.map.objects.find((object) => objectContainsPoint(context.map, object, point));
  if (!hit) {
    return { session, result: {} };
  }
  return {
    session: { origin: point, dragging: true, objectId: hit.id },
    result: { selection: new Set([hit.id]) },
  };
};

const objectContainsPoint = (
  map: TileborneMap,
  object: {
    readonly x: number;
    readonly y: number;
    readonly width: unknown;
    readonly height: unknown;
    readonly properties: Record<string, unknown>;
  },
  point: PointerPoint,
): boolean => {
  const tileW = map.tileSize.width;
  const tileH = map.tileSize.height;
  const width =
    optionValue(object.width as number | { readonly _tag: string; readonly value?: number } | undefined) ??
    (typeof object.properties.tileWidth === 'number' ? object.properties.tileWidth * tileW : tileW);
  const height =
    optionValue(object.height as number | { readonly _tag: string; readonly value?: number } | undefined) ??
    (typeof object.properties.tileHeight === 'number' ? object.properties.tileHeight * tileH : tileH);
  const x = point.tileX * tileW;
  const y = point.tileY * tileH;
  return x >= object.x && x < object.x + width && y >= object.y && y < object.y + height;
};

const applyTileCommand = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  const layerId = resolveLayerId(context.map, context.activeLayerId);
  if (!layerId) {
    return { session, result: {} };
  }
  if (context.resolvedBrush?.kind === 'paintAutotile') {
    return applyAutotilePaintCommand(context, layerId, point, session, context.resolvedBrush);
  }
  if (context.resolvedBrush?.kind !== 'paintTile') {
    return { session, result: {} };
  }
  return applyDirectTileCommand(context, layerId, point, session, context.resolvedBrush.tileIndex);
};

const applyDirectTileCommand = (
  context: ToolContext,
  layerId: LayerId,
  point: PointerPoint,
  session: ToolSession,
  tileIndex: number,
): { session: ToolSession; result: ToolDispatchResult } => {
  const paintSession = paintedSession(session, layerId, point, tileIndex);
  const preview = {
    x: point.tileX,
    y: point.tileY,
    w: 1,
    h: 1,
    tileIndex,
  };
  if (isSamePaintedCell(session, layerId, point, tileIndex)) {
    return { session: paintSession, result: { brushPreview: preview } };
  }
  const currentIndex = tileIndexWithStroke(context, layerId, session, point.tileX, point.tileY);
  if (currentIndex === tileIndex) {
    return { session: paintSession, result: { brushPreview: preview } };
  }
  const nextSession = appendStrokeTileChange(
    paintSession,
    layerId,
    point,
    tileIndex,
    getTileIndex(context.map, layerId, point.tileX, point.tileY),
  );
  return liveStrokeResult(context, layerId, session, nextSession, preview);
};

const applyAutotilePaintCommand = (
  context: ToolContext,
  layerId: LayerId,
  point: PointerPoint,
  session: ToolSession,
  brush: AutotilePaintBrush,
): { session: ToolSession; result: ToolDispatchResult } => {
  const paintSession = paintedSession(session, layerId, point, brush.previewTileIndex);
  const tileIndexAt = (x: number, y: number): number => {
    if (x === point.tileX && y === point.tileY) {
      return brush.previewTileIndex;
    }
    return tileIndexWithStroke(context, layerId, session, x, y);
  };
  const isBrushCell = (x: number, y: number): boolean =>
    (x === point.tileX && y === point.tileY) || brush.tileIndexes.has(tileIndexAt(x, y));
  let nextSession = paintSession;
  let previewTileIndex = brush.previewTileIndex;

  if (isSamePaintedCell(session, layerId, point, brush.previewTileIndex)) {
    return {
      session: paintSession,
      result: { brushPreview: { x: point.tileX, y: point.tileY, w: 1, h: 1, tileIndex: previewTileIndex } },
    };
  }

  for (const cell of autotileCellsToRefresh({ x: point.tileX, y: point.tileY }, brush)) {
    if (!insideMap(context.map, cell.x, cell.y) || !isBrushCell(cell.x, cell.y)) {
      continue;
    }
    const nextTileIndex = resolveAutotileTileIndex(brush, cell, tileIndexAt);
    if (nextTileIndex === undefined) {
      continue;
    }
    if (cell.x === point.tileX && cell.y === point.tileY) {
      previewTileIndex = nextTileIndex;
    }
    nextSession = appendStrokeTileChange(
      nextSession,
      layerId,
      { ...point, tileX: cell.x, tileY: cell.y },
      nextTileIndex,
      getTileIndex(context.map, layerId, cell.x, cell.y),
    );
  }

  return liveStrokeResult(context, layerId, session, nextSession, {
    x: point.tileX,
    y: point.tileY,
    w: 1,
    h: 1,
    tileIndex: previewTileIndex,
  });
};

const applyEraseCommand = (
  context: ToolContext,
  point: PointerPoint,
  session: ToolSession,
): { session: ToolSession; result: ToolDispatchResult } => {
  const layerId = resolveLayerId(context.map, context.activeLayerId);
  if (!layerId) {
    return { session, result: {} };
  }
  const paintSession = paintedSession(session, layerId, point, 0);
  const preview = { x: point.tileX, y: point.tileY, w: 1, h: 1, tileIndex: 0 };
  if (isSamePaintedCell(session, layerId, point, 0)) {
    return { session: paintSession, result: { brushPreview: preview } };
  }
  const currentIndex = tileIndexWithStroke(context, layerId, session, point.tileX, point.tileY);
  if (currentIndex === 0) {
    return { session: paintSession, result: { brushPreview: preview } };
  }
  const brush = context.autotileResolver?.brushForTileIndex(currentIndex);
  if (brush !== undefined) {
    let nextSession = appendStrokeTileChange(
      paintSession,
      layerId,
      point,
      0,
      getTileIndex(context.map, layerId, point.tileX, point.tileY),
    );
    const tileIndexAt = (x: number, y: number): number => {
      if (x === point.tileX && y === point.tileY) {
        return 0;
      }
      return tileIndexWithStroke(context, layerId, nextSession, x, y);
    };
    for (const cell of autotileCellsToRefresh({ x: point.tileX, y: point.tileY }, brush)) {
      if (
        (cell.x === point.tileX && cell.y === point.tileY) ||
        !insideMap(context.map, cell.x, cell.y) ||
        !brush.tileIndexes.has(tileIndexAt(cell.x, cell.y))
      ) {
        continue;
      }
      const nextTileIndex = resolveAutotileTileIndex(brush, cell, tileIndexAt);
      if (nextTileIndex === undefined) {
        continue;
      }
      nextSession = appendStrokeTileChange(
        nextSession,
        layerId,
        { ...point, tileX: cell.x, tileY: cell.y },
        nextTileIndex,
        getTileIndex(context.map, layerId, cell.x, cell.y),
      );
    }
    return liveStrokeResult(context, layerId, session, nextSession, preview);
  }
  const nextSession = appendStrokeTileChange(
    paintSession,
    layerId,
    point,
    0,
    getTileIndex(context.map, layerId, point.tileX, point.tileY),
  );
  return liveStrokeResult(context, layerId, session, nextSession, preview);
};

const liveStrokeResult = (
  context: ToolContext,
  layerId: LayerId,
  previousSession: ToolSession,
  nextSession: ToolSession,
  brushPreview: NonNullable<ToolDispatchResult['brushPreview']>,
): { session: ToolSession; result: ToolDispatchResult } => {
  const command = commandForLiveStrokeDelta(context, layerId, previousSession, nextSession);
  const historyCommand = commandForStroke(nextSession);
  if (command === undefined || historyCommand === undefined) {
    return { session: nextSession, result: { brushPreview } };
  }
  return {
    session: nextSession,
    result: {
      command,
      historyCommand,
      historyMode: hasStrokeChanges(previousSession, layerId) ? 'replace' : 'push',
      brushPreview,
    },
  };
};

const appendStrokeTileChange = (
  session: ToolSession,
  layerId: LayerId,
  point: PointerPoint,
  tileIndex: number,
  oldIndex: number,
): ToolSession => {
  const previous = session.strokeTileChanges;
  const cells = previous?.layerId === layerId ? previous.cells : [];
  const key = `${point.tileX}:${point.tileY}`;
  const existing = cells.find((cell) => `${cell.tileX}:${cell.tileY}` === key);
  const nextCells = cells.filter((cell) => `${cell.tileX}:${cell.tileY}` !== key);
  return {
    ...session,
    strokeTileChanges: {
      layerId,
      cells: [...nextCells, { tileX: point.tileX, tileY: point.tileY, oldIndex: existing?.oldIndex ?? oldIndex, newIndex: tileIndex }],
    },
  };
};

const commandForStroke = (session: ToolSession): EditorCommand | undefined => {
  const stroke = session.strokeTileChanges;
  if (stroke === undefined || stroke.cells.length === 0) {
    return undefined;
  }
  return createStrokeTileCommand(
    stroke.layerId,
    stroke.cells.map((cell) => ({
      tileX: cell.tileX,
      tileY: cell.tileY,
      oldIndex: cell.oldIndex,
      newIndex: cell.newIndex,
    })),
  );
};

const commandForLiveStrokeDelta = (
  context: ToolContext,
  layerId: LayerId,
  previousSession: ToolSession,
  nextSession: ToolSession,
): EditorCommand | undefined => {
  const stroke = nextSession.strokeTileChanges;
  if (stroke?.layerId !== layerId) {
    return undefined;
  }
  const cells = stroke.cells.flatMap((cell) => {
    const previousIndex = tileIndexWithStroke(
      context,
      layerId,
      previousSession,
      cell.tileX,
      cell.tileY,
    );
    if (previousIndex === cell.newIndex) {
      return [];
    }
    return [
      {
        tileX: cell.tileX,
        tileY: cell.tileY,
        oldIndex: previousIndex,
        newIndex: cell.newIndex,
      },
    ];
  });
  return cells.length === 0 ? undefined : createStrokeTileCommand(layerId, cells);
};

const hasStrokeChanges = (session: ToolSession, layerId: LayerId): boolean =>
  session.strokeTileChanges?.layerId === layerId && session.strokeTileChanges.cells.length > 0;

const tileIndexWithStroke = (
  context: ToolContext,
  layerId: LayerId,
  session: ToolSession,
  tileX: number,
  tileY: number,
): number => {
  const stroke = session.strokeTileChanges;
  if (stroke?.layerId === layerId) {
    const cell = stroke.cells.find((candidate) => candidate.tileX === tileX && candidate.tileY === tileY);
    if (cell !== undefined) {
      return cell.newIndex;
    }
  }
  return getTileIndex(context.map, layerId, tileX, tileY);
};

const insideMap = (map: TileborneMap, tileX: number, tileY: number): boolean =>
  tileX >= 0 && tileY >= 0 && tileX < map.size.width && tileY < map.size.height;

const paintedSession = (
  session: ToolSession,
  layerId: LayerId,
  point: PointerPoint,
  tileIndex: number,
): ToolSession => ({
  ...session,
  dragging: true,
  lastPaintedCell: {
    layerId,
    tileX: point.tileX,
    tileY: point.tileY,
    tileIndex,
  },
});

const isSamePaintedCell = (
  session: ToolSession,
  layerId: LayerId,
  point: PointerPoint,
  tileIndex: number,
): boolean => {
  const last = session.lastPaintedCell;
  return (
    last !== undefined &&
    last.layerId === layerId &&
    last.tileX === point.tileX &&
    last.tileY === point.tileY &&
    last.tileIndex === tileIndex
  );
};

const applyObjectPlace = (
  context: ToolContext,
  point: PointerPoint,
): { session: ToolSession; result: ToolDispatchResult } => {
  const tileSize = context.map.tileSize.width;
  if (context.brushIntent.kind === 'placeable' && context.resolvedBrush?.kind === 'placeObject') {
    const command = createObjectPlaceCommand(context.map, {
      kind: 'placeable',
      x: point.tileX * tileSize,
      y: point.tileY * tileSize,
      width: context.resolvedBrush.width,
      height: context.resolvedBrush.height,
      placement: new MapObjectPlacement({
        placeableId: context.resolvedBrush.placeableId,
        source: 'manual',
        assetId: Option.some(context.resolvedBrush.frame.assetId),
        tileId: Option.some(context.resolvedBrush.frame.tileId),
        gid: Option.none(),
      }),
    });
    return { session: {}, result: { command } };
  }
  const command = createObjectPlaceCommand(context.map, {
    kind: context.stagedObjectKind,
    x: point.tileX * tileSize,
    y: point.tileY * tileSize,
  });
  return { session: {}, result: { command } };
};

const applyCollisionPaint = (
  context: ToolContext,
  point: PointerPoint,
): { session: ToolSession; result: ToolDispatchResult } => {
  const command = createCollisionPaintCommand(context.map, point.tileX, point.tileY);
  return {
    session: {},
    result: {
      command,
      brushPreview: { x: point.tileX, y: point.tileY, w: 1, h: 1, tileIndex: 1 },
    },
  };
};

const previewRect = (origin: PointerPoint, point: PointerPoint) => ({
  x: Math.min(origin.tileX, point.tileX),
  y: Math.min(origin.tileY, point.tileY),
  w: Math.abs(point.tileX - origin.tileX) + 1,
  h: Math.abs(point.tileY - origin.tileY) + 1,
  tileIndex: 1,
});

const rectSelection = (origin: PointerPoint, point: PointerPoint): Set<string> => {
  const selection = new Set<string>();
  const minX = Math.min(origin.tileX, point.tileX);
  const maxX = Math.max(origin.tileX, point.tileX);
  const minY = Math.min(origin.tileY, point.tileY);
  const maxY = Math.max(origin.tileY, point.tileY);
  for (let tileY = minY; tileY <= maxY; tileY += 1) {
    for (let tileX = minX; tileX <= maxX; tileX += 1) {
      selection.add(`${tileX}:${tileY}`);
    }
  }
  return selection;
};

const brushPreviewForTool = (context: ToolContext, point: PointerPoint) => {
  if (context.activeTool === 'tileBrush' || context.activeTool === 'collisionPaint') {
    return {
      x: point.tileX,
      y: point.tileY,
      w: 1,
      h: 1,
      tileIndex:
        context.activeTool === 'collisionPaint'
          ? 1
          : context.resolvedBrush?.kind === 'paintTile'
            ? context.resolvedBrush.tileIndex
            : context.resolvedBrush?.kind === 'paintAutotile'
              ? context.resolvedBrush.previewTileIndex
              : 1,
    };
  }
  if (context.activeTool === 'objectPlace' && context.resolvedBrush?.kind === 'placeObject') {
    const tileW = context.map.tileSize.width;
    const tileH = context.map.tileSize.height;
    return {
      x: point.tileX,
      y: point.tileY,
      w: Math.max(1, Math.ceil(context.resolvedBrush.width / tileW)),
      h: Math.max(1, Math.ceil(context.resolvedBrush.height / tileH)),
      tileIndex: 1,
    };
  }
  return null;
};

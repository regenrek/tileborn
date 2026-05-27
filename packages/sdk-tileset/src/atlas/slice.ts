import type { ParseDiagnostic, ParseResult } from "../diagnostics.js";
import type { UVRect } from "../schemas/uv-rect.js";

export type SliceAtlasParams = {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly margin: number;
  readonly spacing: number;
  readonly columns?: number;
  readonly tileCount?: number;
  readonly firstGid?: number;
};

export type SliceAtlasSuccess = {
  readonly tiles: readonly UVRect[];
  readonly columns: number;
  readonly rows: number;
  readonly totalTiles: number;
  readonly firstGid?: number;
};

export type SliceAtlasResult = ParseResult<SliceAtlasSuccess> & {
  readonly diagnostics: readonly ParseDiagnostic[];
};

const ATLAS_PATH = "/atlas";

const computeColumns = (
  imageWidth: number,
  cellWidth: number,
  margin: number,
  spacing: number,
): number => {
  const step = cellWidth + spacing;
  if (step <= 0) return 0;
  return Math.floor((imageWidth - margin * 2 + spacing) / step);
};

const computeRows = (
  imageHeight: number,
  cellHeight: number,
  margin: number,
  spacing: number,
): number => {
  const step = cellHeight + spacing;
  if (step <= 0) return 0;
  return Math.floor((imageHeight - margin * 2 + spacing) / step);
};

const tileFits = (
  rect: UVRect,
  imageWidth: number,
  imageHeight: number,
  margin: number,
): boolean =>
  rect.x >= margin &&
  rect.y >= margin &&
  rect.x + rect.w <= imageWidth - margin &&
  rect.y + rect.h <= imageHeight - margin;

const invalidAtlasGrid = (
  message: string,
  fields: Omit<Extract<ParseDiagnostic, { _tag: "InvalidAtlasGrid" }>, "_tag" | "path" | "message" | "severity">,
): ParseDiagnostic => ({
  _tag: "InvalidAtlasGrid",
  path: ATLAS_PATH,
  message,
  severity: "error",
  ...fields,
});

/** Slice an atlas image into per-tile UV rectangles using Tiled margin/spacing rules. */
export const sliceAtlas = (params: SliceAtlasParams): SliceAtlasResult => {
  const {
    imageWidth,
    imageHeight,
    cellWidth,
    cellHeight,
    margin,
    spacing,
    columns: declaredColumns,
    tileCount,
    firstGid,
  } = params;

  const diagnostics: ParseDiagnostic[] = [];

  if (cellWidth <= 0 || cellHeight <= 0) {
    diagnostics.push({
      _tag: "InvalidCellSize",
      path: `${ATLAS_PATH}/cellSize`,
      message: "Cell size must be positive",
      severity: "error",
      width: cellWidth,
      height: cellHeight,
    });
    return { diagnostics };
  }

  if (margin < 0 || spacing < 0) {
    diagnostics.push({
      _tag: "InvalidMarginSpacing",
      path: ATLAS_PATH,
      message: "Margin and spacing must be non-negative",
      severity: "error",
      margin,
      spacing,
    });
    return { diagnostics };
  }

  const derivedColumns = computeColumns(imageWidth, cellWidth, margin, spacing);
  const columns = declaredColumns ?? derivedColumns;

  if (columns <= 0) {
    diagnostics.push(
      invalidAtlasGrid("Atlas image is too small to fit any tile columns", {
        imageWidth,
        imageHeight,
        cellWidth,
        cellHeight,
        margin,
        spacing,
        columns,
        rows: 0,
      }),
    );
    return { diagnostics };
  }

  if (declaredColumns !== undefined && declaredColumns !== derivedColumns) {
    const requiredWidth =
      margin * 2 + declaredColumns * cellWidth + Math.max(0, declaredColumns - 1) * spacing;
    if (requiredWidth > imageWidth) {
      diagnostics.push(
        invalidAtlasGrid("Atlas image is too small for the declared column count", {
          imageWidth,
          imageHeight,
          cellWidth,
          cellHeight,
          margin,
          spacing,
          columns: declaredColumns,
          rows: computeRows(imageHeight, cellHeight, margin, spacing),
        }),
      );
      return { diagnostics };
    }
  }

  const maxRows = computeRows(imageHeight, cellHeight, margin, spacing);

  if (maxRows <= 0) {
    diagnostics.push(
      invalidAtlasGrid("Atlas image is too small to fit any tile rows", {
        imageWidth,
        imageHeight,
        cellWidth,
        cellHeight,
        margin,
        spacing,
        columns,
        rows: 0,
      }),
    );
    return { diagnostics };
  }

  const capacity = columns * maxRows;
  const totalTiles = tileCount ?? capacity;

  if (totalTiles <= 0) {
    diagnostics.push(
      invalidAtlasGrid("Tile count must be positive", {
        imageWidth,
        imageHeight,
        cellWidth,
        cellHeight,
        margin,
        spacing,
        columns,
        rows: 0,
      }),
    );
    return { diagnostics };
  }

  if (totalTiles > capacity) {
    diagnostics.push(
      invalidAtlasGrid("Atlas image is too small for the declared tile count", {
        imageWidth,
        imageHeight,
        cellWidth,
        cellHeight,
        margin,
        spacing,
        columns,
        rows: maxRows,
      }),
    );
    return { diagnostics };
  }

  const tiles: UVRect[] = [];
  for (let tileIndex = 0; tileIndex < totalTiles; tileIndex += 1) {
    const column = tileIndex % columns;
    const row = Math.floor(tileIndex / columns);
    const rect: UVRect = {
      x: margin + column * (cellWidth + spacing),
      y: margin + row * (cellHeight + spacing),
      w: cellWidth,
      h: cellHeight,
    };

    if (!tileFits(rect, imageWidth, imageHeight, margin)) {
      diagnostics.push(
        invalidAtlasGrid("Atlas tile UV rect extends outside the image bounds", {
          imageWidth,
          imageHeight,
          cellWidth,
          cellHeight,
          margin,
          spacing,
          columns,
          rows: row + 1,
        }),
      );
      return { diagnostics };
    }

    tiles.push(rect);
  }

  return {
    value: {
      tiles,
      columns,
      rows: Math.ceil(totalTiles / columns),
      totalTiles,
      ...(firstGid === undefined ? {} : { firstGid }),
    },
    diagnostics,
  };
};

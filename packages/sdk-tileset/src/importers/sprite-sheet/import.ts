import { Option } from "effect";

import { sliceAtlas } from "../../atlas/slice.js";
import type { ParseDiagnostic, ParseResult } from "../../diagnostics.js";
import { createManifestProvenance, type ManifestProvenance } from "../../manifest/index.js";
import { CellSize, Tileset } from "../../schemas/tileset.js";
import { Tile } from "../../schemas/tile.js";
import { UVRect } from "../../schemas/uv-rect.js";
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  SpriteClip,
  TiledPlaceableSource,
} from "../../schemas/placeable.js";
import { TilesetPack, TilesetPackAsset, TilesetPackLicense } from "../../schemas/tileset-pack.js";
import {
  deterministicAssetId,
  deterministicClipId,
  deterministicPackId,
  deterministicPlaceableId,
  deterministicTileId,
  deterministicTilesetId,
} from "../../tiled/deterministic-ids.js";
import { parseAsepriteSheet, type ParsedAsepriteSheet } from "./aseprite.js";

const PACK_SEED = "sprite-sheet";

/**
 * Named sprite anchor (pivot). Matches the vocabulary understood by the Tiled
 * importer + `tileborne.anchor` map-object property so the value round-trips.
 */
export type SpriteAnchorName = "top-left" | "center" | "bottom-left";

/** Normalized pivot (0..1, origin top-left) for a named anchor. */
export const anchorNameToPivot = (
  anchor: SpriteAnchorName,
): { readonly x: number; readonly y: number } => {
  switch (anchor) {
    case "center":
      return { x: 0.5, y: 0.5 };
    case "bottom-left":
      return { x: 0, y: 1 };
    case "top-left":
      return { x: 0, y: 0 };
  }
};

/** Grid slicing configuration for a sprite sheet (ignored when Aseprite frames are supplied). */
export interface SpriteSheetSliceConfig {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
  readonly margin?: number | undefined;
  readonly spacing?: number | undefined;
}

/** One named clip authored against the sliced grid (frame indices are 0-based). */
export interface SpriteSheetClipInput {
  readonly name: string;
  readonly frameIndices: readonly number[];
  readonly loop?: boolean | undefined;
  readonly defaultDurationMs?: number | undefined;
  /** Optional per-frame durations, aligned with `frameIndices`. */
  readonly frameDurationsMs?: readonly number[] | undefined;
}

export interface SpriteSheetPlayerModelMetadata {
  readonly renderScale?: number | undefined;
  readonly hitbox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Model-local "hand" attachment anchor where equipped entities mount (ADR-0028). */
  readonly hand: {
    readonly x: number;
    readonly y: number;
  };
}

export interface ImportSpriteSheetInput {
  readonly imagePath: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly mime?: string;
  readonly slice: SpriteSheetSliceConfig;
  readonly spriteName?: string;
  /** Sprite anchor/pivot recorded on the placeable (defaults to top-left). */
  readonly anchor?: SpriteAnchorName;
  readonly packName?: string;
  readonly packVersion?: string;
  readonly clips?: readonly SpriteSheetClipInput[];
  /** Optional production player-model geometry persisted onto the placeable. */
  readonly playerModel?: SpriteSheetPlayerModelMetadata | undefined;
  /** Pre-decoded Aseprite JSON sidecar; when present it drives slicing + clips. */
  readonly aseprite?: unknown;
  readonly importedAt?: string;
  /** Override the deterministic-id seed (defaults to the image path). */
  readonly seed?: string;
}

export interface SpriteSheetImportResult {
  readonly pack: TilesetPack;
  readonly provenance: ManifestProvenance;
  /** Number of frames the sheet was sliced into. */
  readonly frameCount: number;
  /** Names of the clips materialized onto the placeable. */
  readonly clipNames: readonly string[];
}

const DEFAULT_FRAME_DURATION_MS = 100;

const invalidConfig = (message: string): ParseDiagnostic => ({
  _tag: "InvalidAtlasGrid",
  path: "/spriteSheet",
  message,
  severity: "error",
  imageWidth: 0,
  imageHeight: 0,
  cellWidth: 0,
  cellHeight: 0,
  margin: 0,
  spacing: 0,
  columns: 0,
  rows: 0,
});

const clipNameToSeed = (name: string): string => name.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase();

type FrameRect = { readonly uv: UVRect; readonly durationMs: number | undefined };

const normalizedNumber = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

const validatePlayerModelMetadata = (
  metadata: SpriteSheetPlayerModelMetadata | undefined,
): readonly ParseDiagnostic[] => {
  if (metadata === undefined) {
    return [];
  }
  const diagnostics: ParseDiagnostic[] = [];
  if (
    !normalizedNumber(metadata.hitbox.x) ||
    !normalizedNumber(metadata.hitbox.y) ||
    !normalizedNumber(metadata.hitbox.width) ||
    !normalizedNumber(metadata.hitbox.height) ||
    metadata.hitbox.width <= 0 ||
    metadata.hitbox.height <= 0 ||
    metadata.hitbox.x + metadata.hitbox.width > 1 ||
    metadata.hitbox.y + metadata.hitbox.height > 1
  ) {
    diagnostics.push(invalidConfig("Player model hitbox must stay inside normalized 0..1 bounds"));
  }
  if (!normalizedNumber(metadata.hand.x) || !normalizedNumber(metadata.hand.y)) {
    diagnostics.push(invalidConfig("Player model hand anchor must use normalized 0..1 coordinates"));
  }
  if (
    metadata.renderScale !== undefined &&
    (!Number.isFinite(metadata.renderScale) || metadata.renderScale <= 0 || metadata.renderScale > 8)
  ) {
    diagnostics.push(invalidConfig("Player model render scale must be greater than 0 and at most 8"));
  }
  return diagnostics;
};

const playerModelProperties = (
  metadata: SpriteSheetPlayerModelMetadata | undefined,
): Record<string, boolean | number> =>
  metadata === undefined
    ? {}
    : {
        "tileborne.playerModel": true,
        ...(metadata.renderScale === undefined
          ? {}
          : { "tileborne.player.renderScale": metadata.renderScale }),
        "tileborne.player.hitboxX": metadata.hitbox.x,
        "tileborne.player.hitboxY": metadata.hitbox.y,
        "tileborne.player.hitboxW": metadata.hitbox.width,
        "tileborne.player.hitboxH": metadata.hitbox.height,
        "tileborne.player.handX": metadata.hand.x,
        "tileborne.player.handY": metadata.hand.y,
      };

/** Derive frame rects from Aseprite frames (each frame keeps its own duration). */
const framesFromAseprite = (sheet: ParsedAsepriteSheet): readonly FrameRect[] =>
  sheet.frames.map((frame) => ({
    uv: new UVRect({ x: frame.x, y: frame.y, w: frame.w, h: frame.h }),
    durationMs: frame.durationMs,
  }));

/** Derive frame rects from the grid slicer. */
const framesFromGrid = (
  input: ImportSpriteSheetInput,
): ParseResult<readonly FrameRect[]> & { readonly diagnostics: readonly ParseDiagnostic[] } => {
  const { slice } = input;
  const tileCount =
    slice.columns !== undefined && slice.rows !== undefined
      ? slice.columns * slice.rows
      : undefined;
  const sliced = sliceAtlas({
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    cellWidth: slice.cellWidth,
    cellHeight: slice.cellHeight,
    margin: slice.margin ?? 0,
    spacing: slice.spacing ?? 0,
    ...(slice.columns === undefined ? {} : { columns: slice.columns }),
    ...(tileCount === undefined ? {} : { tileCount }),
  });
  if (sliced.value === undefined) {
    return { diagnostics: sliced.diagnostics };
  }
  return {
    value: sliced.value.tiles.map((uv) => ({ uv: new UVRect(uv), durationMs: undefined })),
    diagnostics: sliced.diagnostics,
  };
};

const clipsFromAsepriteTags = (
  sheet: ParsedAsepriteSheet,
): readonly SpriteSheetClipInput[] =>
  sheet.tags.map((tag) => {
    const frameIndices: number[] = [];
    const frameDurationsMs: number[] = [];
    for (let index = tag.from; index <= tag.to; index += 1) {
      frameIndices.push(index);
      frameDurationsMs.push(sheet.frames[index]?.durationMs ?? DEFAULT_FRAME_DURATION_MS);
    }
    return { name: tag.name, frameIndices, loop: true, frameDurationsMs };
  });

/**
 * Import a single sprite-sheet image into a content-addressed {@link TilesetPack}
 * (one atlas asset + sliced `Tile[]` + a `Placeable` with named animation clips).
 * Pure and deterministic: identical input yields identical pack/tile/clip ids so
 * re-slicing re-materializes without breaking existing map references.
 */
export const importSpriteSheet = (
  input: ImportSpriteSheetInput,
): ParseResult<SpriteSheetImportResult> & { readonly diagnostics: readonly ParseDiagnostic[] } => {
  const diagnostics: ParseDiagnostic[] = [];
  const seed = input.seed ?? input.imagePath;
  const tilesetSeed = `${seed}/sheet`;
  const anchor: SpriteAnchorName = input.anchor ?? "top-left";
  const anchorPivot = anchorNameToPivot(anchor);
  diagnostics.push(...validatePlayerModelMetadata(input.playerModel));
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  const aseprite = input.aseprite === undefined ? undefined : parseAsepriteSheet(input.aseprite);
  if (input.aseprite !== undefined && aseprite === undefined) {
    diagnostics.push(invalidConfig("Aseprite sidecar JSON is not a recognizable sprite sheet"));
  }

  let frames: readonly FrameRect[];
  if (aseprite !== undefined) {
    frames = framesFromAseprite(aseprite);
  } else {
    const gridFrames = framesFromGrid(input);
    diagnostics.push(...gridFrames.diagnostics);
    if (gridFrames.value === undefined) {
      return { diagnostics };
    }
    frames = gridFrames.value;
  }

  if (frames.length === 0) {
    diagnostics.push(invalidConfig("Sprite sheet produced no frames"));
    return { diagnostics };
  }

  const atlasAssetId = deterministicAssetId(`${seed}/${input.imagePath}`);
  const atlasAsset = new TilesetPackAsset({
    id: atlasAssetId,
    path: input.imagePath,
    mime: input.mime ?? "image/png",
  });

  const tileIds = frames.map((_, index) => deterministicTileId(`${tilesetSeed}/tile/${index}`));
  const tiles = frames.map(
    (frame, index) =>
      new Tile({
        id: tileIds[index]!,
        uv: frame.uv,
        tags: [],
        terrainClass: Option.none(),
        collisionMask: Option.none(),
        animation: Option.none(),
      }),
  );

  const cellWidth = aseprite === undefined ? input.slice.cellWidth : (frames[0]!.uv.w);
  const cellHeight = aseprite === undefined ? input.slice.cellHeight : (frames[0]!.uv.h);

  const frameRefFor = (index: number, durationMs: number | undefined): PlaceableFrameRef =>
    new PlaceableFrameRef({
      assetId: atlasAssetId,
      tileId: tileIds[index]!,
      uv: frames[index]!.uv,
      durationMs: durationMs === undefined ? Option.none() : Option.some(durationMs),
    });

  const requestedClips =
    aseprite !== undefined
      ? clipsFromAsepriteTags(aseprite)
      : (input.clips ?? []);

  // Always guarantee at least one clip ("default" = the full sheet in order) so a
  // freshly imported sheet animates without further authoring.
  const effectiveClips: readonly SpriteSheetClipInput[] =
    requestedClips.length > 0
      ? requestedClips
      : [
          {
            name: "default",
            frameIndices: frames.map((_, index) => index),
            loop: true,
          },
        ];

  const clips: SpriteClip[] = effectiveClips
    .map((clipInput) => {
      const validIndices = clipInput.frameIndices.filter(
        (index) => index >= 0 && index < frames.length,
      );
      if (validIndices.length === 0) {
        diagnostics.push(invalidConfig(`Clip "${clipInput.name}" has no valid frame indices`));
        return undefined;
      }
      const defaultDurationMs = clipInput.defaultDurationMs ?? DEFAULT_FRAME_DURATION_MS;
      const clipFrames = validIndices.map((index, position) => {
        const fromFrame = frames[index]!.durationMs;
        const perFrame = clipInput.frameDurationsMs?.[position];
        return frameRefFor(index, perFrame ?? fromFrame);
      });
      return new SpriteClip({
        id: deterministicClipId(`${tilesetSeed}/clip/${clipNameToSeed(clipInput.name)}`),
        name: clipInput.name,
        frames: clipFrames as [PlaceableFrameRef, ...PlaceableFrameRef[]],
        loop: clipInput.loop ?? true,
        defaultDurationMs,
      });
    })
    .filter((clip): clip is SpriteClip => clip !== undefined);

  if (clips.length === 0) {
    diagnostics.push(invalidConfig("Sprite sheet produced no valid clips"));
    return { diagnostics };
  }

  const placeable = new Placeable({
    id: deterministicPlaceableId(`${tilesetSeed}/placeable`),
    name: input.spriteName ?? input.packName ?? "Sprite",
    size: new PlaceableSize({ width: cellWidth, height: cellHeight }),
    // The first clip's frames double as the implicit default clip for back-compat.
    frames: clips[0]!.frames,
    clips,
    tags: ["sprite"],
    placementMode: "object",
    source: new TiledPlaceableSource({
      format: "tiled",
      tilesetName: input.spriteName ?? "Sprite",
      localTileId: 0,
      image: Option.some(input.imagePath),
      imageWidth: Option.some(input.imageWidth),
      imageHeight: Option.some(input.imageHeight),
      objectType: Option.none(),
      objectClass: Option.none(),
      properties: {
        "tileborne.anchor": anchor,
        "tileborne.anchorX": anchorPivot.x,
        "tileborne.anchorY": anchorPivot.y,
        "tileborne.sprite": true,
        ...playerModelProperties(input.playerModel),
      },
    }),
  });

  const tileset = new Tileset({
    id: deterministicTilesetId(`${seed}/${tilesetSeed}`),
    name: input.spriteName ?? "Sprite",
    atlasAssetId,
    cellSize: new CellSize({ width: cellWidth, height: cellHeight }),
    margin: input.slice.margin ?? 0,
    spacing: input.slice.spacing ?? 0,
    tiles,
    autotileRules: [],
    variantFilters: [],
    terrainTransitions: [],
  });

  const pack = new TilesetPack({
    schemaVersion: 1,
    id: deterministicPackId(`${PACK_SEED}/${seed}`),
    name: input.packName ?? input.spriteName ?? "Sprite Pack",
    version: input.packVersion ?? "1.0.0",
    license: new TilesetPackLicense({
      spdxId: "UNKNOWN",
      attribution: Option.none(),
      sourceUrl: Option.none(),
      notes: Option.some(input.imagePath),
      redistributable: false,
    }),
    tilesets: [tileset],
    assets: [atlasAsset],
    placeables: [placeable],
  });

  return {
    value: {
      pack,
      provenance: createManifestProvenance({
        sourcePath: input.imagePath,
        originTool: "tileborne-sprite-sheet-importer",
        ...(input.importedAt === undefined ? {} : { importedAt: input.importedAt }),
      }),
      frameCount: frames.length,
      clipNames: clips.map((clip) => clip.name),
    },
    diagnostics,
  };
};

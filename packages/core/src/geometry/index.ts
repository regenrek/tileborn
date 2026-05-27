import { Schema } from "effect";

/** Immutable 2D vector. */
export class Vec2 extends Schema.Class<Vec2>("Vec2")({
  x: Schema.Number,
  y: Schema.Number,
}) {
  /** Component-wise addition. */
  add(other: Vec2): Vec2 {
    return createVec2(this.x + other.x, this.y + other.y);
  }

  /** Translate by delta. */
  translate(dx: number, dy: number): Vec2 {
    return createVec2(this.x + dx, this.y + dy);
  }

  /** Exact component equality. */
  equals(other: Vec2): boolean {
    return this.x === other.x && this.y === other.y;
  }
}

/** Create a vector from components. */
export const createVec2 = (x: number, y: number): Vec2 => new Vec2({ x, y });

/** Axis-aligned rectangle in tile or pixel space. */
export class Rect extends Schema.Class<Rect>("Rect")({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {
  /** Right edge (exclusive). */
  get right(): number {
    return this.x + this.width;
  }

  /** Bottom edge (exclusive). */
  get bottom(): number {
    return this.y + this.height;
  }

  /** Translate rectangle by delta. */
  translate(dx: number, dy: number): Rect {
    return createRect(this.x + dx, this.y + dy, this.width, this.height);
  }

  /** Whether this rectangle intersects another (edge-touch counts). */
  intersects(other: Rect): boolean {
    return (
      this.x < other.right &&
      this.right > other.x &&
      this.y < other.bottom &&
      this.bottom > other.y
    );
  }

  /** Exact bounds equality. */
  equals(other: Rect): boolean {
    return (
      this.x === other.x &&
      this.y === other.y &&
      this.width === other.width &&
      this.height === other.height
    );
  }
}

/** Create a rectangle from bounds. */
export const createRect = (x: number, y: number, width: number, height: number): Rect =>
  new Rect({ x, y, width, height });

/** Integer tile coordinate in map space. */
export class TileCoord extends Schema.Class<TileCoord>("TileCoord")({
  x: Schema.Int,
  y: Schema.Int,
}) {
  translate(dx: number, dy: number): TileCoord {
    return createTileCoord(this.x + dx, this.y + dy);
  }

  equals(other: TileCoord): boolean {
    return this.x === other.x && this.y === other.y;
  }
}

export const createTileCoord = (x: number, y: number): TileCoord => new TileCoord({ x, y });

/** Chunk coordinate for chunked tile layers. */
export class ChunkCoord extends Schema.Class<ChunkCoord>("ChunkCoord")({
  x: Schema.Int,
  y: Schema.Int,
}) {
  equals(other: ChunkCoord): boolean {
    return this.x === other.x && this.y === other.y;
  }
}

export const createChunkCoord = (x: number, y: number): ChunkCoord => new ChunkCoord({ x, y });

/** Grid helpers for tile/chunk math. */
export const grid = {
  /** Map a world tile coordinate to its containing chunk coordinate. */
  tileToChunk: (tile: TileCoord, chunkSize: number): ChunkCoord =>
    createChunkCoord(Math.floor(tile.x / chunkSize), Math.floor(tile.y / chunkSize)),

  /** Local tile offset inside a chunk. */
  tileInChunk: (tile: TileCoord, chunkSize: number): TileCoord =>
    createTileCoord(
      ((tile.x % chunkSize) + chunkSize) % chunkSize,
      ((tile.y % chunkSize) + chunkSize) % chunkSize,
    ),
} as const;

export const Vec2Schema = Vec2;
export const RectSchema = Rect;
export const TileCoordSchema = TileCoord;
export const ChunkCoordSchema = ChunkCoord;

/**
 * Minimal, tolerant parser for Aseprite JSON sprite-sheet sidecars. Supports
 * both the "Array" (`frames: []`) and "Hash" (`frames: {}`) export layouts and
 * extracts per-frame rectangles/durations plus `meta.frameTags` (used to derive
 * named animation clips). We intentionally avoid Effect-Schema here because the
 * Aseprite format is loosely specified across versions; callers receive
 * `undefined` for anything that does not look like an Aseprite sheet.
 */

export interface AsepriteFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Frame display duration in milliseconds (Aseprite default is 100). */
  readonly durationMs: number;
}

export interface AsepriteTag {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

export interface ParsedAsepriteSheet {
  readonly frames: readonly AsepriteFrame[];
  readonly tags: readonly AsepriteTag[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toFiniteInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;

const parseFrameRect = (entry: unknown): AsepriteFrame | undefined => {
  if (!isRecord(entry)) return undefined;
  const rect = entry['frame'];
  if (!isRecord(rect)) return undefined;
  const x = toFiniteInt(rect['x']);
  const y = toFiniteInt(rect['y']);
  const w = toFiniteInt(rect['w']);
  const h = toFiniteInt(rect['h']);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  if (w <= 0 || h <= 0) return undefined;
  const duration = toFiniteInt(entry['duration']);
  return { x, y, w, h, durationMs: duration === undefined || duration <= 0 ? 100 : duration };
};

const parseFrames = (frames: unknown): readonly AsepriteFrame[] | undefined => {
  const entries = Array.isArray(frames)
    ? frames
    : isRecord(frames)
      ? Object.values(frames)
      : undefined;
  if (entries === undefined) return undefined;
  const parsed: AsepriteFrame[] = [];
  for (const entry of entries) {
    const frame = parseFrameRect(entry);
    if (frame === undefined) return undefined;
    parsed.push(frame);
  }
  return parsed;
};

const parseTags = (meta: unknown, frameCount: number): readonly AsepriteTag[] => {
  if (!isRecord(meta)) return [];
  const rawTags = meta['frameTags'];
  if (!Array.isArray(rawTags)) return [];
  const tags: AsepriteTag[] = [];
  for (const raw of rawTags) {
    if (!isRecord(raw)) continue;
    const name = raw['name'];
    const from = toFiniteInt(raw['from']);
    const to = toFiniteInt(raw['to']);
    if (typeof name !== 'string' || name.length === 0 || from === undefined || to === undefined) {
      continue;
    }
    const clampedFrom = Math.max(0, Math.min(from, frameCount - 1));
    const clampedTo = Math.max(clampedFrom, Math.min(to, frameCount - 1));
    tags.push({ name, from: clampedFrom, to: clampedTo });
  }
  return tags;
};

/** Parse an already-JSON-decoded Aseprite sidecar; returns `undefined` if invalid. */
export const parseAsepriteSheet = (json: unknown): ParsedAsepriteSheet | undefined => {
  if (!isRecord(json)) return undefined;
  const frames = parseFrames(json['frames']);
  if (frames === undefined || frames.length === 0) return undefined;
  return { frames, tags: parseTags(json['meta'], frames.length) };
};
